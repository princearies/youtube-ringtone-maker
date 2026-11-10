import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.mjs'
import { run } from './proc.mjs'
import { AppError } from './security.mjs'

const BASE_ARGS = [
  '--ignore-config',
  '--no-playlist',
  '--no-warnings',
  '--no-color',
  '--no-call-home',
  '--no-check-certificates',
  '--geo-bypass',
]

function withTransport(args) {
  const out = [...BASE_ARGS, ...args]
  if (config.ytdlp.proxy) out.push('--proxy', config.ytdlp.proxy)
  if (config.ytdlp.cookies) out.push('--cookies', config.ytdlp.cookies)
  out.push(...config.ytdlp.extraArgs)
  return out
}

/** Map yt-dlp's stderr chatter onto stable, user-facing error codes. */
function classify(stderr, code) {
  const text = String(stderr || '')
  const rules = [
    [/sign in to confirm|not a bot|confirm you're not a bot/i, 'BOT_CHECK', 'YouTube asked this server to verify it is not a bot. Try again shortly.'],
    [/private video/i, 'PRIVATE_VIDEO', 'That video is private.'],
    [/members-only|join this channel/i, 'MEMBERS_ONLY', 'That video is members-only.'],
    [/age.?restricted|confirm your age/i, 'AGE_RESTRICTED', 'That video is age-restricted.'],
    [/video unavailable|removed by the uploader|no longer available/i, 'UNAVAILABLE', 'That video is unavailable.'],
    [/live event will begin|premieres in|is live/i, 'LIVE_STREAM', 'Live streams cannot be turned into ringtones.'],
    [/requested format is not available/i, 'NO_AUDIO_STREAM', 'No downloadable audio stream was found.'],
    [/unable to download|failed to resolve|http error 4\d\d/i, 'FETCH_FAILED', 'YouTube refused the download. Try another link.'],
    [/timed out|timeout/i, 'TIMEOUT', 'The download timed out. Try a shorter video.'],
    [/is not recognized|command not found|enoent/i, 'ENGINE_MISSING_YTDLP', 'The extraction engine is not installed on the server.'],
  ]
  for (const [pattern, errorCode, message] of rules) {
    if (pattern.test(text)) return { code: errorCode, message }
  }
  if (code === 'TIMEOUT') return { code: 'TIMEOUT', message: 'The download timed out.' }
  return { code: 'EXTRACT_FAILED', message: 'That link could not be processed.' }
}

/** Metadata only. Validates the video before any bandwidth is spent. */
export async function probeVideo(url) {
  let stdout
  try {
    const result = await run(
      config.bin.ytdlp,
      withTransport(['--dump-single-json', '--skip-download', '--socket-timeout', '20', '--retries', '2', url]),
      { timeout: 45_000, maxBytes: 16 << 20 },
    )
    stdout = result.stdout
  } catch (err) {
    const mapped = classify(err.stderr, err.code)
    if (err.code === 'SPAWN_FAILED') throw new AppError(mapped.code, mapped.message, 503)
    throw new AppError(mapped.code, mapped.message, 422, { cause: err })
  }

  let info
  try {
    info = JSON.parse(stdout.trim())
  } catch {
    throw new AppError('EXTRACT_FAILED', 'YouTube returned an unexpected response.', 502)
  }

  if (info._type === 'playlist') {
    throw new AppError('PLAYLIST', 'Paste one video, not a playlist.', 422)
  }
  if (info.is_live) {
    throw new AppError('LIVE_STREAM', 'Live streams cannot be turned into ringtones.', 422)
  }

  const duration = Number(info.duration || 0)
  if (duration > config.maxSourceDuration) {
    throw new AppError(
      'TOO_LONG',
      `Videos up to ${Math.round(config.maxSourceDuration / 60)} minutes are supported.`,
      422,
    )
  }

  return {
    videoId: info.id,
    title: String(info.title || 'Untitled').slice(0, 200),
    duration,
    thumbnail: typeof info.thumbnail === 'string' ? info.thumbnail : null,
    uploader: typeof info.uploader === 'string' ? info.uploader.slice(0, 120) : null,
    isLive: Boolean(info.is_live),
  }
}

const PROGRESS_RE = /\[download\]\s+(\d{1,3}(?:\.\d+)?)%/

/** Download the best audio-only stream into `dir`, reporting 0..100 progress. */
export async function downloadAudio(url, dir, onProgress) {
  const template = path.join(dir, 'source.%(ext)s')

  try {
    await run(
      config.bin.ytdlp,
      withTransport([
        '-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio/best',
        '--max-filesize', '120M',
        '--no-part',
        '--retries', '3',
        '--fragment-retries', '3',
        '--socket-timeout', '20',
        '--newline',
        '--progress',
        '-o', template,
        url,
      ]),
      {
        timeout: config.downloadTimeoutMs,
        maxBytes: 4 << 20,
        onStderr: (text) => {
          const match = PROGRESS_RE.exec(text)
          if (match) onProgress?.(Number(match[1]))
        },
      },
    )
  } catch (err) {
    const mapped = classify(err.stderr, err.code)
    const status = err.code === 'SPAWN_FAILED' ? 503 : 422
    throw new AppError(mapped.code, mapped.message, status, { cause: err })
  }

  const entries = await fs.readdir(dir)
  const found = entries.find((name) => name.startsWith('source.') && !name.endsWith('.part'))
  if (!found) throw new AppError('EXTRACT_FAILED', 'The audio file was not produced.', 502)

  return path.join(dir, found)
}

export async function ytdlpVersion() {
  try {
    const { stdout } = await run(config.bin.ytdlp, ['--version'], { timeout: 10_000, maxBytes: 1 << 20 })
    return stdout.trim()
  } catch {
    return null
  }
}
