import { checkRateLimit } from './ratelimit.js'
import { AppError } from './errors.js'
import { isId, safeNumber, screenInput } from './validate.js'

const MAX_BODY_BYTES = 4 * 1024

async function readJson(c) {
  const raw = await c.req.text()
  if (raw.length > MAX_BODY_BYTES) {
    throw new AppError(413, 'BODY_TOO_LARGE', 'That request is too large.')
  }
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new AppError(400, 'INVALID_JSON', 'The request body must be JSON.')
  }
}

async function limit(c, action, [max, windowSec]) {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || 'unknown'
  const result = await checkRateLimit(c.env, `${ip}:${action}`, max, windowSec)
  if (!result.ok) {
    throw new AppError(429, 'RATE_LIMITED', `Too many requests. Try again in ${result.retryAfter}s.`)
  }
}

function clampRange(body) {
  const start = safeNumber(body.start)
  const end = safeNumber(body.end)

  if (!(end > start) || end - start < 0.5) {
    throw new AppError(400, 'INVALID_RANGE', 'Pick a start and end time at least half a second apart.')
  }
  if (end > 7200) {
    throw new AppError(400, 'INVALID_RANGE', 'That timestamp is out of range.')
  }

  return { start, end }
}

/**
 * POST /api/convert
 *   { url, start, end, format }        → one-shot: download + trim + encode
 *   { sourceId, start, end, format }   → reuse an already-prepared track
 */
export function convert(engine, config) {
  return async (c) => {
    await limit(c, 'convert', config.limits.convert)
    const body = await readJson(c)

    const format = body.format === 'm4r' ? 'm4r' : body.format === 'mp3' ? 'mp3' : null
    if (!format) throw new AppError(400, 'INVALID_FORMAT', 'Choose MP3 or M4R.')

    const { start, end } = clampRange(body)
    const payload = { start, end, format }

    if (body.sourceId) {
      if (!isId(body.sourceId)) {
        throw new AppError(400, 'INVALID_SOURCE', 'Load the track again before converting.')
      }
      payload.sourceId = body.sourceId
    } else {
      const screened = screenInput(body.url, c.env)
      if (!screened.ok) throw new AppError(400, screened.code, screened.message)
      payload.url = screened.local ? screened.value : screened.canonical
    }

    return engine.json('/api/convert', { method: 'POST', body: payload, timeoutMs: 15_000 })
  }
}

/** POST /api/prepare — editor step: metadata + preview audio + waveform peaks. */
export function prepare(engine, config) {
  return async (c) => {
    await limit(c, 'prepare', config.limits.prepare)
    const body = await readJson(c)

    const screened = screenInput(body.url, c.env)
    if (!screened.ok) throw new AppError(400, screened.code, screened.message)

    return engine.json('/api/prepare', {
      method: 'POST',
      body: { url: screened.local ? screened.value : screened.canonical },
      timeoutMs: 15_000,
    })
  }
}

/** GET /api/status/:jobId */
export function status(engine) {
  return async (c) => {
    const jobId = c.req.param('jobId')
    if (!isId(jobId)) throw new AppError(400, 'INVALID_JOB', 'Unknown job id.')
    return engine.json(`/api/status/${jobId}`, { timeoutMs: 10_000 })
  }
}

/** GET /api/download/:jobId — attachment, or inline for an <audio> preview. */
export function download(engine, config) {
  return async (c) => {
    await limit(c, 'download', config.limits.download)
    const jobId = c.req.param('jobId')
    if (!isId(jobId)) throw new AppError(400, 'INVALID_JOB', 'Unknown job id.')

    const inline = c.req.query('inline') === '1' ? '?inline=1' : ''
    return engine.stream(`/api/files/${jobId}${inline}`, c.req.header('range'))
  }
}

/** GET /api/preview/:sourceId — the full extracted track, Range-capable. */
export function preview(engine, config) {
  return async (c) => {
    await limit(c, 'preview', config.limits.preview)
    const sourceId = c.req.param('sourceId')
    if (!isId(sourceId)) throw new AppError(400, 'INVALID_SOURCE', 'Unknown source id.')

    return engine.stream(`/api/sources/${sourceId}/audio`, c.req.header('range'))
  }
}

/** DELETE /api/source/:sourceId — drop the cached download immediately. */
export function dropSource(engine) {
  return async (c) => {
    const sourceId = c.req.param('sourceId')
    if (!isId(sourceId)) throw new AppError(400, 'INVALID_SOURCE', 'Unknown source id.')
    return engine.json(`/api/sources/${sourceId}`, { method: 'DELETE', timeoutMs: 10_000 })
  }
}

/** GET /api/health — is the Worker configured and is the engine awake? */
export function health(engine, config) {
  return async (c) => {
    let engineHealth = null

    try {
      const response = await fetch(engine.url('/api/health'), {
        headers: engine.headers(),
        signal: AbortSignal.timeout(config.healthTimeoutMs),
      })
      engineHealth = await response.json().catch(() => null)
    } catch {
      engineHealth = null
    }

    return c.json(
      {
        ok: Boolean(engineHealth?.ok),
        configured: Boolean(config.engineUrl),
        engine: engineHealth,
      },
      engineHealth ? 200 : 503,
    )
  }
}
