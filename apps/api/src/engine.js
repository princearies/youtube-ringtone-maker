import { AppError } from './errors.js'

const FORWARDED_HEADERS = [
  'content-type',
  'content-disposition',
  'content-range',
  'accept-ranges',
  'cache-control',
]

/**
 * Thin client for the self-hosted engine.
 *
 * The Worker never touches ffmpeg or yt-dlp; it authenticates, validates,
 * rate-limits, and relays bytes. Streaming responses are piped, not buffered,
 * so a 5 MB ringtone never sits in Worker memory.
 */
export class Engine {
  constructor(config) {
    this.config = config
  }

  url(path) {
    if (!this.config.engineUrl) {
      throw new AppError(500, 'ENGINE_UNCONFIGURED', 'The audio engine is not configured yet.')
    }
    return `${this.config.engineUrl}${path}`
  }

  headers(extra = {}) {
    return {
      'x-engine-token': this.config.engineToken,
      ...extra,
    }
  }

  async json(path, { method = 'GET', body, timeoutMs } = {}) {
    let upstream

    try {
      upstream = await fetch(this.url(path), {
        method,
        headers: this.headers({ 'content-type': 'application/json' }),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs ?? this.config.jsonTimeoutMs),
      })
    } catch {
      throw new AppError(503, 'ENGINE_UNAVAILABLE', 'The audio engine is unreachable. Try again in a moment.')
    }

    const text = await upstream.text()

    if (!upstream.ok) {
      let payload = null
      try {
        payload = JSON.parse(text)
      } catch {
        /* engine returned a non-JSON error */
      }
      throw new AppError(
        upstream.status,
        payload?.error?.code || 'ENGINE_ERROR',
        payload?.error?.message || 'The audio engine rejected that request.',
      )
    }

    return new Response(text, {
      status: upstream.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  /** Byte-for-byte relay with Range passthrough (audio preview + download). */
  async stream(path, range) {
    let upstream

    try {
      upstream = await fetch(this.url(path), {
        method: 'GET',
        headers: this.headers(range ? { range } : {}),
      })
    } catch {
      throw new AppError(503, 'ENGINE_UNAVAILABLE', 'The audio engine is unreachable.')
    }

    const headers = new Headers()
    for (const name of FORWARDED_HEADERS) {
      const value = upstream.headers.get(name)
      if (value) headers.set(name, value)
    }
    headers.set('x-content-type-options', 'nosniff')

    return new Response(upstream.body, { status: upstream.status, headers })
  }
}
