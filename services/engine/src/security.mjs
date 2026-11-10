import fs from 'node:fs'
import path from 'node:path'

const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const MAX_URL_LENGTH = 2048

export class AppError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message)
    this.code = code
    this.status = status
    Object.assign(this, extra)
  }
}

/**
 * Accepts every common YouTube shape and returns a canonical watch URL.
 * Rejects anything else, so the engine can never be pointed at an arbitrary host.
 */
export function parseYouTubeUrl(input) {
  if (typeof input !== 'string') {
    throw new AppError('INVALID_URL', 'Paste a YouTube link first.')
  }
  const raw = input.trim()
  if (!raw || raw.length > MAX_URL_LENGTH) {
    throw new AppError('INVALID_URL', 'That link looks empty or far too long.')
  }

  let url
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    throw new AppError('INVALID_URL', 'That is not a valid URL.')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AppError('INVALID_URL', 'Only http(s) links are supported.')
  }
  if (url.username || url.password) {
    throw new AppError('INVALID_URL', 'Links with embedded credentials are not allowed.')
  }

  const host = url.hostname.toLowerCase()
  if (!ALLOWED_HOSTS.has(host)) {
    throw new AppError('UNSUPPORTED_HOST', 'Only YouTube links are supported right now.')
  }

  let videoId = ''
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] || ''
  } else if (url.pathname === '/watch') {
    videoId = url.searchParams.get('v') || ''
  } else {
    const match = url.pathname.match(/^\/(?:shorts|embed|live|v|watch)\/([A-Za-z0-9_-]{11})/)
    videoId = match?.[1] || url.searchParams.get('v') || ''
  }

  if (!VIDEO_ID.test(videoId)) {
    throw new AppError('NO_VIDEO_ID', 'That link does not point at a single video.')
  }

  return { videoId, canonical: `https://www.youtube.com/watch?v=${videoId}` }
}

/**
 * Local-file escape hatch, only when DEV_ALLOW_LOCAL_FILES=1 and the path exists.
 * Never reachable in production because the flag defaults to off.
 */
export function parseLocalFile(input, { enabled }) {
  if (!enabled || typeof input !== 'string') return null
  const raw = input.trim()
  if (!raw || raw.length > MAX_URL_LENGTH) return null

  let candidate = raw
  if (raw.startsWith('file://')) {
    try {
      candidate = decodeURIComponent(new URL(raw).pathname)
      if (/^\/[A-Za-z]:/.test(candidate)) candidate = candidate.slice(1)
    } catch {
      return null
    }
  } else if (/^https?:\/\//i.test(raw)) {
    return null
  }

  const resolved = path.resolve(candidate)
  if (!fs.existsSync(resolved)) return null
  const stat = fs.statSync(resolved)
  if (!stat.isFile() || stat.size === 0) return null
  return resolved
}

/** Coerce a client-supplied timestamp to a finite, non-negative number. */
export function toSeconds(value, fallback = 0) {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback
  return Math.max(0, parsed)
}

/**
 * Clamp a requested window into the media and the plan's maximum length.
 * Returns { start, end, duration, clipped }.
 */
export function clampRange({ start, end }, duration, maxClip) {
  const total = Math.max(0.4, Number(duration) || 0)
  let from = Math.min(toSeconds(start, 0), Math.max(0, total - 0.3))
  let to = toSeconds(end, from + Math.min(maxClip, 30 - 0))

  if (!Number.isFinite(to) || to <= from) to = Math.min(total, from + 30)
  if (to - from > maxClip) to = from + maxClip
  if (to > total) {
    to = total
    if (to - from < 0.4) from = Math.max(0, to - 0.4)
  }

  // Round to 2 decimals so the same request always produces the same bytes.
  from = Math.round(from * 100) / 100
  to = Math.round(to * 100) / 100

  return { start: from, end: to, duration: Number((to - from).toFixed(2)) }
}

export function assertFormat(value) {
  if (value === 'mp3' || value === 'm4r') return value
  throw new AppError('INVALID_FORMAT', 'Choose MP3 or M4R.')
}
