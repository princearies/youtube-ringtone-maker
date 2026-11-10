#!/usr/bin/env node
/**
 * Minimal Chrome DevTools Protocol driver used to verify the real UI in a real
 * browser (no Playwright dependency). REA's Playwright scenario provider hit a
 * protocol_error on this Chrome build, so this covers the interaction half.
 *
 *   node scripts/cdp-drive.mjs prepare "<absolute source path>"
 *   node scripts/cdp-drive.mjs render
 *   node scripts/cdp-drive.mjs shot "<out.png>"
 *   node scripts/cdp-drive.mjs mobile "<out.png>" ["<source path>"]
 *
 * `mobile` sets a 390x844@3x touch viewport, then — when a source is given —
 * runs paste → extract → render and screenshots the finished state.
 * Emulation is per CDP session, so the whole flow must stay in one connection.
 */
import { writeFileSync } from 'node:fs'

const ENDPOINT = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222'
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173'

const step = process.argv[2]
const argument = process.argv[3]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const targets = await (await fetch(`${ENDPOINT}/json/list`)).json()
const page = targets.find((target) => target.type === 'page' && target.url.startsWith(APP_URL))
if (!page) {
  console.error(`No page target at ${APP_URL} — open the app in that Chrome instance first.`)
  process.exit(1)
}

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = () => reject(new Error('CDP socket failed'))
})

let nextId = 0
const pending = new Map()

socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(JSON.stringify(message.error)))
    else resolve(message.result)
  }
}

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = (nextId += 1)
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(`page threw: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ''}`)
  }
  return result.result.value
}

async function waitFor(expression, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return
    await sleep(350)
  }
  throw new Error(`timeout waiting for ${label}`)
}

const INPUT = `input[aria-label="YouTube link"]`
const TRIM = `section[aria-label="Trim the ringtone"]`

async function pasteLink(source) {
  // The URL form is hidden once a track is loaded, so reset with "Change" first.
  if (!(await evaluate(`Boolean(document.querySelector('${INPUT}'))`))) {
    const reset = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Change')
      if (!button) return false
      button.click()
      return true
    })()`)
    if (reset) await waitFor(`Boolean(document.querySelector('${INPUT}'))`, 'the URL input', 8000)
  }

  await waitFor(`Boolean(document.querySelector('${INPUT}'))`, 'the URL input')
  const typed = await evaluate(`(() => {
    const input = document.querySelector('${INPUT}')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(source)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return input.value
  })()`)
  if (typed !== source) throw new Error(`input value mismatch: ${typed}`)

  const clicked = await evaluate(`(() => {
    const button = document.querySelector('form button[type="submit"]')
    if (!button) return 'missing'
    if (button.disabled) return 'disabled'
    button.click()
    return 'clicked'
  })()`)
  if (clicked !== 'clicked') throw new Error(`submit button ${clicked}`)
}

async function clickRender() {
  const clicked = await evaluate(`(() => {
    const button = document.querySelector('button.btn-primary[type="button"]')
    if (!button) return 'missing'
    if (button.disabled) return 'disabled'
    button.click()
    return 'clicked'
  })()`)
  if (clicked !== 'clicked') throw new Error(`render button ${clicked}`)
}

async function capture(outputPath) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const bytes = Buffer.from(shot.data, 'base64')
  writeFileSync(outputPath, bytes)
  return bytes.length
}

async function pageFacts() {
  return evaluate(`(() => {
    const canvas = document.querySelector('${TRIM} canvas')
    const fields = [...document.querySelectorAll('${TRIM} input')].map((el) => el.value)
    const link = document.querySelector('a[download]')
    return {
      title: document.querySelector('section h2')?.textContent ?? '',
      canvas: canvas ? { css: canvas.clientWidth, backing: canvas.width } : null,
      timeFields: fields,
      downloadHref: link?.getAttribute('href') ?? null,
      downloadName: link?.getAttribute('download') ?? null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
    }
  })()`)
}

if (step === 'prepare') {
  if (!argument) throw new Error('prepare needs a source path')
  await pasteLink(argument)
  await waitFor(`Boolean(document.querySelector('${TRIM}'))`, 'the trim editor', 120_000)
  await sleep(900)
  console.log(JSON.stringify({ step: 'prepare', facts: await pageFacts() }, null, 2))
} else if (step === 'render') {
  await clickRender()
  await waitFor(`Boolean(document.querySelector('a[download]'))`, 'the download link', 60_000)
  await sleep(600)
  console.log(JSON.stringify({ step: 'render', facts: await pageFacts() }, null, 2))
} else if (step === 'shot') {
  if (!argument) throw new Error('shot needs an output path')
  console.log(JSON.stringify({ step: 'shot', bytes: await capture(argument) }))
} else if (step === 'mobile') {
  const outputPath = argument
  const flowSource = process.argv[4]

  // NO_EMULATION=1 trusts an already phone-sized browser window, which keeps the
  // layout viewport and the captured viewport in sync on real remote sites.
  if (process.env.NO_EMULATION !== '1') {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
    })
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  }
  await send('Page.navigate', { url: APP_URL })
  await sleep(2200)

  if (flowSource) {
    await pasteLink(flowSource)
    await waitFor(`Boolean(document.querySelector('${TRIM}'))`, 'the trim editor', 120_000)
    await sleep(800)

    // Snapshot the editor before rendering, then the finished result.
    if (outputPath) {
      await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`)
      await sleep(300)
      await capture(outputPath.replace(/\.png$/i, '-editor.png'))
    }

    await clickRender()
    await waitFor(`Boolean(document.querySelector('a[download]'))`, 'the download link', 60_000)
    await sleep(900)
  }

  const facts = await pageFacts()
  const bytes = outputPath ? await capture(outputPath) : 0
  console.log(JSON.stringify({ step: 'mobile', bytes, facts }, null, 2))
} else {
  throw new Error('step must be one of: prepare, render, shot, mobile')
}

socket.close()
