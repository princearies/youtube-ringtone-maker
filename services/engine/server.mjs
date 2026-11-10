#!/usr/bin/env node
/**
 * Ringtone engine — the only piece that needs a real OS process, because both
 * yt-dlp and ffmpeg are native binaries. Everything else (API + UI) runs on
 * Cloudflare's free tier and proxies to this service.
 *
 *   node server.mjs            # 127.0.0.1:8788
 *   HOST=0.0.0.0 PORT=8788 ENGINE_TOKEN=... node server.mjs
 */
import crypto from 'node:crypto'
import http from 'node:http'
import path from 'node:path'
import { config } from './src/config.mjs'
import { readJsonBody, sendError, sendJson, streamFile } from './src/http.mjs'
import { discardSource, startConvert, startPrepare, startRender } from './src/pipeline.mjs'
import { AppError } from './src/security.mjs'
import { getClip, getJob, getSource, publicJob, publicSource, resetWorkDir, sweep } from './src/store.mjs'
import { available } from './src/proc.mjs'
import { ytdlpVersion } from './src/ytdlp.mjs'

const startedAt = Date.now()
const capabilities = { ffmpeg: false, ffprobe: false, ytdlp: null }

function log(...args) {
  if (config.logLevel !== 'silent') console.log(new Date().toISOString(), ...args)
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''))
  const right = Buffer.from(String(b ?? ''))
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

const index = () => ({
  name: 'ringtone-engine',
  version: config.version,
  limits: {
    maxSourceDurationSec: config.maxSourceDuration,
    maxClipSec: config.maxClipDuration,
    maxM4rSec: config.maxM4rDuration,
  },
  endpoints: [
    'GET  /api/health',
    'POST /api/convert   { url | sourceId, start, end, format }',
    'GET  /api/status/:jobId',
    'GET  /api/download/:jobId[?inline=1]',
    'POST /api/prepare   { url }',
    'POST /api/render    { sourceId, start, end, format }',
    'GET  /api/jobs/:id',
    'GET  /api/sources/:id/audio',
    'DELETE /api/sources/:id',
    'GET  /api/files/:jobId[?inline=1]',
  ],
})

const routes = [
  { method: 'GET', pattern: /^\/api\/health$/, handler: async (req, res) => sendJson(res, 200, {
    ok: capabilities.ffmpeg && capabilities.ffprobe,
    version: config.version,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    capabilities,
    limits: index().limits,
  }) },

  { method: 'GET', pattern: /^\/$/, handler: async (req, res) => sendJson(res, 200, index()) },

  { method: 'POST', pattern: /^\/api\/prepare$/, handler: async (req, res) => {
    const body = await readJsonBody(req)
    const url = typeof body.url === 'string' ? body.url : ''
    if (!url) throw new AppError('MISSING_URL', 'Paste a YouTube link first.')
    const job = startPrepare(url)
    sendJson(res, 202, { job: publicJob(job) })
  } },

  { method: 'POST', pattern: /^\/api\/convert$/, handler: async (req, res) => {
    const body = await readJsonBody(req)
    const job = startConvert({
      input: typeof body.url === 'string' ? body.url : '',
      sourceId: typeof body.sourceId === 'string' ? body.sourceId : '',
      start: body.start,
      end: body.end,
      format: body.format,
    })
    sendJson(res, 202, { job: publicJob(job) })
  } },

  { method: 'POST', pattern: /^\/api\/render$/, handler: async (req, res) => {
    const body = await readJsonBody(req)
    const job = startRender({
      sourceId: String(body.sourceId || ''),
      start: body.start,
      end: body.end,
      format: body.format,
    })
    sendJson(res, 202, { job: publicJob(job) })
  } },

  { method: 'GET', pattern: /^\/api\/status\/([A-Za-z0-9_-]{1,40})$/, handler: async (req, res, [id]) => {
    const job = getJob(id)
    if (!job) throw new AppError('JOB_NOT_FOUND', 'That job is gone.', 404)
    sendJson(res, 200, { job: publicJob(job) })
  } },

  { method: 'GET', pattern: /^\/api\/jobs\/([A-Za-z0-9_-]{1,40})$/, handler: async (req, res, [id]) => {
    const job = getJob(id)
    if (!job) throw Object.assign(new AppError('JOB_NOT_FOUND', 'That job is gone.', 404))
    sendJson(res, 200, { job: publicJob(job) })
  } },

  // Public contract alias: the engine mirrors the Worker's /api/preview path so
  // dev mode (browser → engine directly) behaves exactly like production.
  { method: 'GET', pattern: /^\/api\/preview\/([A-Za-z0-9_-]{1,40})$/, handler: async (req, res, [id]) => {
    const source = getSource(id)
    if (!source) throw new AppError('SOURCE_EXPIRED', 'That audio expired. Load the link again.', 410)
    await streamFile(req, res, {
      filePath: source.file,
      contentType: source.contentType,
      filename: `${source.video.id}.m4a`,
      inline: true,
    })
  } },

  { method: 'GET', pattern: /^\/api\/sources\/([A-Za-z0-9_-]{1,40})\/audio$/, handler: async (req, res, [id]) => {
    const source = getSource(id)
    if (!source) throw new AppError('SOURCE_EXPIRED', 'That audio expired. Load the link again.', 410)
    await streamFile(req, res, {
      filePath: source.file,
      contentType: source.contentType,
      filename: `${source.video.id}.m4a`,
      inline: true,
    })
  } },

  { method: 'DELETE', pattern: /^\/api\/sources\/([A-Za-z0-9_-]{1,40})$/, handler: async (req, res, [id]) => {
    const removed = await discardSource(id)
    sendJson(res, removed ? 200 : 404, { removed })
  } },

  { method: 'GET', pattern: /^\/api\/(?:files|download)\/([A-Za-z0-9_-]{1,40})$/, handler: async (req, res, [jobId], url) => {
    const clip = getClip(jobId)
    if (!clip) throw new AppError('FILE_GONE', 'That file expired. Render it again.', 410)
    clip.expiresAt = Date.now() + config.ttlMs
    await streamFile(req, res, {
      filePath: clip.path,
      contentType: clip.format === 'm4r' ? 'audio/mp4' : 'audio/mpeg',
      filename: clip.filename,
      inline: url.searchParams.get('inline') === '1',
    })
  } },

  { method: 'GET', pattern: /^\/api\/sources\/([A-Za-z0-9_-]{1,40})$/, handler: async (req, res, [id]) => {
    const source = getSource(id)
    if (!source) throw new AppError('SOURCE_EXPIRED', 'That audio expired.', 410)
    sendJson(res, 200, { source: publicSource(source) })
  } },
]

async function handle(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': request.headers.origin || '*',
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type,x-engine-token',
      'access-control-max-age': '86400',
    })
    return response.end()
  }

  if (url.pathname === '/api/health') {
    const route = routes[0]
    return route.handler(request, response)
  }

  if (config.token) {
    const provided = request.headers['x-engine-token']
    if (!timingSafeEqual(provided, config.token)) {
      return sendJson(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Bad engine token.' } })
    }
  }

  for (const route of routes) {
    if (route.method !== request.method) continue
    const match = route.pattern.exec(url.pathname)
    if (!match) continue
    return route.handler(request, response, match.slice(1), url)
  }

  sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'No such endpoint.' } })
}

const server = http.createServer((req, res) => {
  const started = Date.now()
  res.on('finish', () => {
    if (req.url?.startsWith('/api/health')) return
    log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`)
  })
  handle(req, res).catch((err) => {
    if (!res.headersSent) sendError(res, err)
    else res.destroy()
  })
})

server.headersTimeout = 30_000
server.requestTimeout = 240_000
server.keepAliveTimeout = 20_000

const sweeper = setInterval(() => { sweep().catch(() => {}) }, 30_000)
sweeper.unref()

async function boot() {
  if (!config.token && !['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
    console.error('Refusing to bind a public interface without ENGINE_TOKEN.')
    process.exit(1)
  }

  await resetWorkDir()

  capabilities.ffmpeg = await available(config.bin.ffmpeg, ['-hide_banner', '-version'])
  capabilities.ffprobe = await available(config.bin.ffprobe, ['-hide_banner', '-version'])
  capabilities.ytdlp = await ytdlpVersion()

  if (!capabilities.ffmpeg || !capabilities.ffprobe) {
    console.error(`ffmpeg/ffprobe not found (${config.bin.ffmpeg}). Install ffmpeg and set FFMPEG_PATH.`)
    process.exit(1)
  }
  if (!capabilities.ytdlp) {
    console.warn(`yt-dlp not found (${config.bin.ytdlp}) — YouTube links will fail until it is installed.`)
  }

  server.listen(config.port, config.host, () => {
    log(`ringtone-engine ${config.version} on http://${config.host}:${config.port}`)
    log(`ffmpeg=${config.bin.ffmpeg} yt-dlp=${capabilities.ytdlp || 'missing'} work=${config.workDir}`)
  })
}

async function shutdown(signal) {
  log(`${signal} received, shutting down`)
  clearInterval(sweeper)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5_000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

boot().catch((err) => {
  console.error(err)
  process.exit(1)
})
