#!/usr/bin/env node
/**
 * Exercises the real Hono app in Node (no workerd needed) against a running
 * engine: CORS, validation, prepare → status → convert → download.
 *
 *   node scripts/api-smoke.mjs "<path to a local audio file>"
 */
import { createApp } from '../apps/api/src/app.js'

const ENGINE = process.env.ENGINE_URL || 'http://127.0.0.1:8788'
const SOURCE = process.argv[2]

if (!SOURCE) {
  console.error('usage: node scripts/api-smoke.mjs <audio-file>')
  process.exit(2)
}

const app = createApp()
// DEV_LOCAL_FILES lets the Worker forward a local path instead of a YouTube URL.
const env = { ENGINE_URL: ENGINE, ENGINE_TOKEN: '', ALLOWED_ORIGINS: '*', DEV_LOCAL_FILES: '1' }

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function call(path, init = {}) {
  const res = await app.request(path, init, env)
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  return { res, json, text }
}

async function waitForJob(jobId, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { res, json } = await call(`/api/status/${jobId}`)
    if (res.status !== 200) throw new Error(`status ${res.status}: ${JSON.stringify(json)}`)
    if (json.job.state === 'done' || json.job.state === 'error') return json.job
    await sleep(300)
  }
  throw new Error('job timed out')
}

// 1. Health — Hono → engine round trip
const health = await call('/api/health')
check('GET /api/health reaches the engine', health.res.status === 200 && health.json?.ok === true, `status=${health.res.status}`)

// 2. CORS preflight
const preflight = await call('/api/convert', {
  method: 'OPTIONS',
  headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
})
const preflightOrigin = preflight.res.headers.get('access-control-allow-origin')
check(
  'CORS preflight allows the browser origin',
  preflight.res.status === 204 && (preflightOrigin === '*' || preflightOrigin === 'http://localhost:5173'),
  `status=${preflight.res.status} acao=${preflightOrigin}`,
)

// 3. Rejections
const notYouTube = await call('/api/convert', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: 'https://vimeo.com/123456', start: 0, end: 10, format: 'mp3' }),
})
check(
  'non-YouTube host is rejected before the engine',
  notYouTube.res.status === 400 && notYouTube.json?.error?.code === 'UNSUPPORTED_HOST',
  `${notYouTube.res.status} ${notYouTube.json?.error?.code}`,
)

const badRange = await call('/api/convert', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ', start: 10, end: 10, format: 'mp3' }),
})
check(
  'empty range is rejected',
  badRange.res.status === 400 && badRange.json?.error?.code === 'INVALID_RANGE',
  `${badRange.res.status} ${badRange.json?.error?.code}`,
)

const badFormat = await call('/api/convert', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ', start: 0, end: 10, format: 'wav' }),
})
check(
  'only mp3/m4r accepted',
  badFormat.res.status === 400 && badFormat.json?.error?.code === 'INVALID_FORMAT',
  `${badFormat.res.status} ${badFormat.json?.error?.code}`,
)

// 4. Prepare (editor step) with a local file the engine accepts in dev mode
const prep = await call('/api/prepare', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: SOURCE }),
})
check('POST /api/prepare accepted', prep.res.status === 202, `status=${prep.res.status} ${prep.text.slice(0, 120)}`)

const prepJob = await waitForJob(prep.json.job.id)
const source = prepJob.result
check('prepare job finished with peaks', prepJob.state === 'done' && Array.isArray(source.peaks) && source.peaks.length > 50,
  `peaks=${source.peaks?.length} duration=${source.duration}`)

// 5. Preview audio through the worker (Range passthrough)
const preview = await call(`/api/preview/${source.id}`, { headers: { range: 'bytes=0-1023' } })
check(
  'GET /api/preview streams audio and keeps 206 + Content-Range',
  preview.res.status === 206 && Boolean(preview.res.headers.get('content-range')),
  `status=${preview.res.status} range=${preview.res.headers.get('content-range')}`,
)

// 6. Convert (public contract) by sourceId
const convert = await call('/api/convert', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sourceId: source.id, start: 2, end: 12, format: 'm4r' }),
})
check('POST /api/convert accepted', convert.res.status === 202, `status=${convert.res.status}`)

const convertJob = await waitForJob(convert.json.job.id)
check(
  'convert finished with the requested 10s window',
  convertJob.state === 'done' && Math.abs(convertJob.result.duration - 10) < 0.01,
  `duration=${convertJob.result?.duration}`,
)

// 7. Download through the worker
const download = await call(`/api/download/${convertJob.id}`)
const disposition = download.res.headers.get('content-disposition') || ''
check(
  'GET /api/download returns an .m4r attachment',
  download.res.status === 200 &&
    download.res.headers.get('content-type') === 'audio/mp4' &&
    disposition.includes('attachment') &&
    disposition.includes('.m4r'),
  `status=${download.res.status} type=${download.res.headers.get('content-type')}`,
)

// 8. Unknown job / unknown route
const malformed = await call('/api/status/bad$id')
check(
  'malformed job id → 400 INVALID_JOB',
  malformed.res.status === 400 && malformed.json?.error?.code === 'INVALID_JOB',
  `${malformed.res.status} ${malformed.json?.error?.code}`,
)

const unknownJob = await call('/api/status/job_doesnotexist')
check(
  'well-formed unknown job → 404 JOB_NOT_FOUND from the engine',
  unknownJob.res.status === 404 && unknownJob.json?.error?.code === 'JOB_NOT_FOUND',
  `${unknownJob.res.status} ${unknownJob.json?.error?.code}`,
)

const missing = await call('/api/does-not-exist')
check('unknown route → 404 NOT_FOUND', missing.res.status === 404 && missing.json?.error?.code === 'NOT_FOUND')

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  for (const item of failed) console.log(` - ${item.name} ${item.detail}`)
  process.exit(1)
}
