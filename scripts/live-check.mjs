#!/usr/bin/env node
/**
 * Live end-to-end check against a running deployment (engine or Worker):
 * health → POST /api/convert → poll /api/status → GET /api/download.
 *
 *   node scripts/live-check.mjs https://ringcut.example.workers.dev [videoUrl]
 *   ENGINE_TOKEN=... node scripts/live-check.mjs http://127.0.0.1:8788
 */
const BASE = (process.argv[2] || '').replace(/\/+$/, '')
const VIDEO = process.argv[3] || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
const TOKEN = process.env.ENGINE_TOKEN || ''

if (!BASE) {
  console.error('usage: node scripts/live-check.mjs <base-url> [video-url]')
  process.exit(2)
}

const headers = TOKEN ? { 'x-engine-token': TOKEN } : {}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function json(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...headers, ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  return { status: res.status, body, text }
}

const health = await json('/api/health')
console.log(`health: ${health.status}`, JSON.stringify(health.body?.engine ?? health.body).slice(0, 240))
if (health.status !== 200) {
  console.log('Engine is not healthy — stopping.')
  process.exit(1)
}

const started = Date.now()
const created = await json('/api/convert', {
  method: 'POST',
  body: JSON.stringify({ url: VIDEO, start: 30, end: 60, format: 'mp3' }),
})

if (created.status !== 202) {
  console.error('convert rejected:', created.status, created.text.slice(0, 300))
  process.exit(1)
}

const jobId = created.body.job.id
console.log(`job ${jobId} accepted for ${VIDEO}`)

let job = null
for (let i = 0; i < 240; i += 1) {
  const polled = await json(`/api/status/${jobId}`)
  job = polled.body?.job
  if (!job) {
    console.error('status failed:', polled.status, polled.text.slice(0, 200))
    process.exit(1)
  }
  if (job.state === 'done' || job.state === 'error') break
  if (i % 3 === 0) process.stdout.write(`\r  ${job.stage} ${job.progress}%   `)
  await sleep(1000)
}
process.stdout.write('\r')

if (job.state !== 'done') {
  console.error(`job failed: ${job.error?.code} ${job.error?.message}`)
  process.exit(1)
}

console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log(JSON.stringify(job.result, null, 2))

const file = await fetch(`${BASE}${job.result.downloadUrl}`, { headers })
const bytes = Buffer.from(await file.arrayBuffer())
console.log(`download: ${file.status} ${file.headers.get('content-type')} ${bytes.length} bytes`)
console.log(`disposition: ${file.headers.get('content-disposition')}`)
console.log(`first bytes: ${bytes.subarray(0, 3).toString('hex')} (49 44 33 = ID3 mp3)`)

if (file.status !== 200 || !bytes.length.toString().startsWith('') || bytes.length < 10_000) {
  console.error('download looks wrong')
  process.exit(1)
}

console.log('LIVE CHECK PASSED')
