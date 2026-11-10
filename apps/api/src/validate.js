/**
 * Cheap gate in front of the engine. The engine performs the authoritative
 * parse (it must, since it also builds the yt-dlp command), but rejecting junk
 * here keeps abusive traffic away from the origin entirely.
 */

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
const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/

/** Job ids and source ids are opaque, but never free-form. */
export function isId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

export function screenUrl(raw) {
  if (typeof raw !== 'string') return { ok: false, code: 'INVALID_URL', message: 'Paste a YouTube link first.' }
  const input = raw.trim()
  if (!input || input.length > 2048) {
    return { ok: false, code: 'INVALID_URL', message: 'That link looks empty or far too long.' }
  }

  let url
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`)
  } catch {
    return { ok: false, code: 'INVALID_URL', message: 'That is not a valid URL.' }
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, code: 'INVALID_URL', message: 'Only http(s) links are supported.' }
  }
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, code: 'UNSUPPORTED_HOST', message: 'Only YouTube links are supported.' }
  }

  const fromPath = url.pathname.match(/^\/(?:shorts|embed|live|v|watch)\/([A-Za-z0-9_-]{11})/)
  const videoId = url.hostname.endsWith('youtu.be')
    ? url.pathname.split('/').filter(Boolean)[0] || ''
    : url.searchParams.get('v') || fromPath?.[1] || ''

  if (!VIDEO_ID.test(videoId)) {
    return { ok: false, code: 'NO_VIDEO_ID', message: 'That link does not point at a single video.' }
  }

  return { ok: true, videoId, canonical: `https://www.youtube.com/watch?v=${videoId}` }
}

/**
 * Same gate as screenUrl, plus a dev-only escape hatch so the whole stack can be
 * exercised locally with a file instead of YouTube.
 *
 * Enabled only when the Worker runs with `DEV_LOCAL_FILES = "1"` (never in prod).
 */
export function screenInput(raw, env = {}) {
  if (env.DEV_LOCAL_FILES === '1' && typeof raw === 'string') {
    const candidate = raw.trim()
    if (candidate && !/^https?:/i.test(candidate) && /^(?:[A-Za-z]:[\\/]|\/|\\\\|file:\/\/)/.test(candidate)) {
      return { ok: true, local: true, value: candidate }
    }
  }
  return screenUrl(raw)
}

export function safeNumber(value) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

