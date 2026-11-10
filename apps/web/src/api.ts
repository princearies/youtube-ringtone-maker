import type { Format, Job } from './types'

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string }
}

export interface ConvertInput {
  /** One-shot mode: the worker/engine resolves and downloads the track. */
  url?: string
  /** Editor mode: reuse an already prepared track (skips the download). */
  sourceId?: string
  start: number
  end: number
  format: Format
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  } catch {
    throw new ApiError('NETWORK', 'Could not reach the server. Check your connection and try again.')
  }

  const payload = (await response.json().catch(() => null)) as (T & ErrorEnvelope) | null

  if (!response.ok) {
    const code = payload?.error?.code ?? `HTTP_${response.status}`
    const message = payload?.error?.message ?? 'That request failed.'
    throw new ApiError(code, message, response.status)
  }

  return payload as T
}

export const api = {
  /** Editor step: metadata + preview audio + waveform peaks. */
  prepare(url: string) {
    return call<{ job: Job }>('/api/prepare', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }).then((data) => data.job)
  },

  /** POST /api/convert — trim + encode, by url or by already-prepared sourceId. */
  convert(input: ConvertInput) {
    return call<{ job: Job }>('/api/convert', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((data) => data.job)
  },

  /** GET /api/status/:jobId */
  status(jobId: string) {
    return call<{ job: Job }>(`/api/status/${encodeURIComponent(jobId)}`).then((data) => data.job)
  },

  health() {
    return call<{ ok: boolean; configured?: boolean; engine?: unknown }>('/api/health')
  },

  /** GET /api/preview/:sourceId — Range-capable audio for the <audio> element. */
  previewUrl(sourceId: string) {
    return `${BASE}/api/preview/${encodeURIComponent(sourceId)}`
  },

  /** GET /api/download/:jobId — attachment, or inline for the result player. */
  downloadUrl(jobId: string, inline = false) {
    return `${BASE}/api/download/${encodeURIComponent(jobId)}${inline ? '?inline=1' : ''}`
  },
}
