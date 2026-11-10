#!/usr/bin/env node
/**
 * End-to-end engine smoke test.
 *
 * It synthesises a 14-second stereo track with ffmpeg (no network, no YouTube),
 * then drives the real HTTP API: prepare → render MP3 → render M4R → download.
 * Every artefact is verified with ffprobe (codec, container, duration, trim).
 *
 *   node scripts/selftest.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 8799
const BASE = `http://127.0.0.1:${PORT}`
const TOKEN = 'selftest-token'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
}

function sh(bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...options })
    const out = []
    const err = []
    child.stdout.on('data', (c) => out.push(c))
    child.stderr.on('data', (c) => err.push(c))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`${bin} failed: ${Buffer.concat(err).toString().slice(0, 400)}`))
      else resolve(Buffer.concat(out).toString())
    })
  })
}

async function ffprobeJson(file) {
  const out = await sh('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])
  return JSON.parse(out)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function request(pathname, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-engine-token': TOKEN,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))
  return { status: response.status, payload }
}

async function waitForSettled(id, { timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { status, payload } = await request(`/api/jobs/${id}`)
    if (status !== 200) throw new Error(`job poll failed (${status}): ${JSON.stringify(payload)}`)
    const job = payload.job
    if (job.state === 'done' || job.state === 'error') return job
    await sleep(250)
  }
  throw new Error('job timed out')
}

async function waitForJob(id, options) {
  const job = await waitForSettled(id, options)
  if (job.state === 'error') throw new Error(`job error ${job.error?.code}: ${job.error?.message}`)
  return job
}

async function main() {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'ringtone-selftest-'))
  const input = path.join(work, 'tone.m4a')

  // 14 s of a moving tone, AAC/m4a — the same container YouTube usually serves.
  await sh('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=14:sample_rate=44100',
    '-f', 'lavfi', '-i', 'sine=frequency=660:duration=14:sample_rate=44100',
    '-filter_complex', '[0:a][1:a]amerge=inputs=2[a]',
    '-map', '[a]', '-c:a', 'aac', '-b:a', '128k', '-f', 'ipod', input,
  ])

  const server = spawn(process.execPath, [path.join(ROOT, 'services/engine/server.mjs')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      ENGINE_TOKEN: TOKEN,
      DEV_ALLOW_LOCAL_FILES: '1',
      WORK_DIR: path.join(work, 'engine'),
      LOG_LEVEL: 'silent',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const serverLog = []
  server.stdout.on('data', (c) => serverLog.push(c.toString()))
  server.stderr.on('data', (c) => serverLog.push(c.toString()))

  try {
    // Wait for /api/health
    let health = null
    for (let i = 0; i < 60; i += 1) {
      try {
        const res = await fetch(`${BASE}/api/health`)
        if (res.ok) { health = await res.json(); break }
      } catch { /* not up yet */ }
      await sleep(250)
    }
    if (!health) throw new Error(`engine did not start:\n${serverLog.join('')}`)

    check('health reports ffmpeg + ffprobe', health.capabilities.ffmpeg && health.capabilities.ffprobe)

    // Auth guard
    const unauth = await fetch(`${BASE}/api/prepare`, { method: 'POST' })
    check('engine rejects a request without token', unauth.status === 401, `status=${unauth.status}`)

    // Prepare
    const prep = await request('/api/prepare', { method: 'POST', body: { url: input } })
    check('prepare accepted', prep.status === 202, `status=${prep.status}`)
    const prepJob = await waitForJob(prep.payload.job.id)
    const source = prepJob.result

    check('duration detected (~14s)', Math.abs(source.duration - 14) < 0.6, `duration=${source.duration}`)
    check('waveform peaks computed', Array.isArray(source.peaks) && source.peaks.length > 100, `peaks=${source.peaks?.length}`)
    check('peaks are normalised 0..1', source.peaks.every((p) => p >= 0 && p <= 1))

    // Preview stream + Range support
    const full = await fetch(`${BASE}${source.audioUrl}`, { headers: { 'x-engine-token': TOKEN } })
    const bytes = Buffer.from(await full.arrayBuffer())
    check('preview audio streams', full.status === 200 && bytes.length > 1000, `${bytes.length} bytes`)
    check('preview content-type is audio/mp4', full.headers.get('content-type') === 'audio/mp4')

    const ranged = await fetch(`${BASE}${source.audioUrl}`, {
      headers: { 'x-engine-token': TOKEN, range: 'bytes=0-1023' },
    })
    check('preview honours HTTP Range (206)', ranged.status === 206 && ranged.headers.get('content-range') !== null,
      `status=${ranged.status} range=${ranged.headers.get('content-range')}`)

    // Render MP3 3.0s → 33.0s clamped to 14s source
    const mp3Job = await waitForJob((await request('/api/render', {
      method: 'POST',
      body: { sourceId: source.id, start: 2, end: 9, format: 'mp3' },
    })).payload.job.id)
    check('mp3 render completed', mp3Job.state === 'done', JSON.stringify(mp3Job.result))

    const mp3 = mp3Job.result
    const mp3Res = await fetch(`${BASE}${mp3.downloadUrl}`, { headers: { 'x-engine-token': TOKEN } })
    const mp3Buf = Buffer.from(await mp3Res.arrayBuffer())
    const mp3Path = path.join(work, 'out.mp3')
    await fs.writeFile(mp3Path, mp3Buf)
    const mp3Info = await ffprobeJson(mp3Path)

    check('mp3 download has attachment filename', (mp3Res.headers.get('content-disposition') || '').includes('attachment'))
    check('mp3 container is mp3', /mp3/.test(mp3Info.format.format_name), mp3Info.format.format_name)
    check('mp3 codec is mp3', mp3Info.streams[0].codec_name === 'mp3')
    check('mp3 is mono 44.1k', mp3Info.streams[0].channels === 1 && Number(mp3Info.streams[0].sample_rate) === 44100)
    const mp3Duration = Number(mp3Info.format.duration)
    check('mp3 trim is exact (7s ±0.15)', Math.abs(mp3Duration - 7) < 0.15, `duration=${mp3Duration.toFixed(3)}`)

    // Render M4R 0 → 40 (clamped by source + 40s m4r cap)
    const m4rJob = await waitForJob((await request('/api/render', {
      method: 'POST',
      body: { sourceId: source.id, start: 0, end: 40, format: 'm4r' },
    })).payload.job.id)
    check('m4r render completed', m4rJob.state === 'done')

    const m4r = m4rJob.result
    const m4rRes = await fetch(`${BASE}${m4r.downloadUrl}`, { headers: { 'x-engine-token': TOKEN } })
    const m4rBuf = Buffer.from(await m4rRes.arrayBuffer())
    const m4rPath = path.join(work, 'out.m4r')
    await fs.writeFile(m4rPath, m4rBuf)
    const m4rInfo = await ffprobeJson(m4rPath)

    check('m4r filename ends with .m4r', m4r.filename.endsWith('.m4r'), m4r.filename)
    check('m4r container is ipod/mp4', /mp4|m4a|mov/.test(m4rInfo.format.format_name), m4rInfo.format.format_name)
    check('m4r codec is aac', m4rInfo.streams[0].codec_name === 'aac')
    check('m4r respects iPhone 40s cap', Number(m4rInfo.format.duration) <= 40.5, `duration=${m4rInfo.format.duration}`)
    check('m4r clips to source length (14s ±0.2)', Math.abs(Number(m4rInfo.format.duration) - 14) < 0.2,
      `duration=${m4rInfo.format.duration}`)

    // ── A long source to prove the 40 s iPhone cap actually truncates ────────
    const longInput = path.join(work, 'long.m4a')
    await sh('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=320:duration=75:sample_rate=44100',
      '-c:a', 'aac', '-b:a', '96k', '-f', 'ipod', longInput,
    ])
    const longPrep = await waitForJob((await request('/api/prepare', {
      method: 'POST', body: { url: longInput },
    })).payload.job.id)
    check('long source prepared', longPrep.result.duration > 70, `duration=${longPrep.result.duration}`)

    const capped = await waitForJob((await request('/api/render', {
      method: 'POST',
      body: { sourceId: longPrep.result.id, start: 10, end: 70, format: 'm4r' },
    })).payload.job.id)
    check('m4r request over 40s is clamped', Math.abs(capped.result.duration - 40) < 0.01,
      `requested=${capped.result.end - capped.result.start}s effective=${capped.result.duration}s`)

    const cappedRes = await fetch(`${BASE}${capped.result.downloadUrl}`, { headers: { 'x-engine-token': TOKEN } })
    const cappedPath = path.join(work, 'capped.m4r')
    await fs.writeFile(cappedPath, Buffer.from(await cappedRes.arrayBuffer()))
    const cappedInfo = await ffprobeJson(cappedPath)
    check('capped m4r is really 40s on disk (±0.2)', Math.abs(Number(cappedInfo.format.duration) - 40) < 0.2,
      `duration=${cappedInfo.format.duration}`)

    // ── One-shot POST /api/convert (the public contract) ─────────────────────
    const convertRes = await request('/api/convert', {
      method: 'POST',
      body: { url: longInput, start: 5, end: 20, format: 'mp3' },
    })
    check('convert accepts url + start + end + format', convertRes.status === 202, `status=${convertRes.status}`)
    const convertJob = await waitForJob(convertRes.payload.job.id)
    check('convert completes in one job', convertJob.state === 'done' && convertJob.type === 'convert')
    check('convert returns /api/download/:jobId',
      convertJob.result?.downloadUrl === `/api/download/${convertJob.id}`, convertJob.result?.downloadUrl)
    check('convert honours the requested 15s window', Math.abs(convertJob.result.duration - 15) < 0.01,
      `duration=${convertJob.result.duration}`)

    const converted = await fetch(`${BASE}${convertJob.result.downloadUrl}`, {
      headers: { 'x-engine-token': TOKEN },
    })
    check('GET /api/download works for a converted clip',
      converted.status === 200 && (converted.headers.get('content-type') || '').includes('audio/mpeg'),
      `status=${converted.status} type=${converted.headers.get('content-type')}`)

    const convertBySource = await request('/api/convert', {
      method: 'POST',
      body: { sourceId: longPrep.result.id, start: 0, end: 8, format: 'm4r' },
    })
    const convertBySourceJob = await waitForJob(convertBySource.payload.job.id)
    check('convert also accepts sourceId (skips download)',
      convertBySourceJob.state === 'done' && Math.abs(convertBySourceJob.result.duration - 8) < 0.01)

    // Rejections
    const badFormat = await request('/api/render', {
      method: 'POST',
      body: { sourceId: source.id, start: 0, end: 5, format: 'wav' },
    })
    check('invalid format rejected at job level', badFormat.status === 202)
    const badJob = await waitForSettled(badFormat.payload.job.id)
    check('invalid format produces INVALID_FORMAT', badJob.state === 'error' && badJob.error.code === 'INVALID_FORMAT',
      JSON.stringify(badJob.error))

    const badUrl = await request('/api/prepare', { method: 'POST', body: { url: 'https://example.com/watch?v=aaaaaaaaaaa' } })
    const badUrlJob = await waitForSettled(badUrl.payload.job.id)
    check('non-YouTube host rejected (UNSUPPORTED_HOST)',
      badUrlJob.state === 'error' && badUrlJob.error.code === 'UNSUPPORTED_HOST', JSON.stringify(badUrlJob.error))

    const noId = await request('/api/prepare', { method: 'POST', body: { url: 'https://youtube.com/feed/subscriptions' } })
    const noIdJob = await waitForSettled(noId.payload.job.id)
    check('link without a video id rejected (NO_VIDEO_ID)',
      noIdJob.state === 'error' && noIdJob.error.code === 'NO_VIDEO_ID', JSON.stringify(noIdJob.error))

    // Cleanup endpoint
    const del = await request(`/api/sources/${source.id}`, { method: 'DELETE' })
    check('source delete works', del.status === 200 && del.payload.removed === true)
    const gone = await request(`/api/sources/${source.id}/audio`)
    check('deleted source audio is gone (410)', gone.status === 410, `status=${gone.status}`)
  } finally {
    server.kill('SIGKILL')
    await fs.rm(work, { recursive: true, force: true }).catch(() => {})
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('\nFailures:')
    for (const f of failed) console.log(` - ${f.name} ${f.detail}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('\nselftest crashed:', err.message)
  process.exit(1)
})
