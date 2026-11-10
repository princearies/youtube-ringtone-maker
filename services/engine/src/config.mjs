import os from 'node:os'
import path from 'node:path'

const isWindows = process.platform === 'win32'

function num(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function flag(value) {
  return value === '1' || value === 'true' || value === 'yes'
}

export const config = {
  version: '1.0.0',
  host: process.env.HOST || '127.0.0.1',
  port: num(process.env.PORT, 8788, 1, 65535),

  workDir: path.resolve(process.env.WORK_DIR || path.join(os.tmpdir(), 'ringtone-engine')),
  ttlMs: num(process.env.FILE_TTL_MS, 15 * 60_000, 60_000, 6 * 3600_000),

  maxSourceDuration: num(process.env.MAX_SOURCE_DURATION_SEC, 900, 10, 7200),
  maxClipDuration: num(process.env.MAX_CLIP_SEC, 60, 5, 300),
  maxM4rDuration: num(process.env.MAX_M4R_SEC, 40, 5, 45),
  maxParallel: num(process.env.MAX_PARALLEL, 2, 1, 12),

  downloadTimeoutMs: num(process.env.DOWNLOAD_TIMEOUT_MS, 180_000, 10_000, 900_000),
  renderTimeoutMs: num(process.env.RENDER_TIMEOUT_MS, 90_000, 5_000, 600_000),

  token: process.env.ENGINE_TOKEN || '',
  normalize: flag(process.env.NORMALIZE),
  devLocalFiles: flag(process.env.DEV_ALLOW_LOCAL_FILES),

  bin: {
    ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobe: process.env.FFPROBE_PATH || 'ffprobe',
    ytdlp: process.env.YTDLP_PATH || (isWindows ? 'yt-dlp.exe' : 'yt-dlp'),
  },

  ytdlp: {
    proxy: process.env.YTDLP_PROXY || '',
    cookies: process.env.YTDLP_COOKIES || '',
    extraArgs: (process.env.YTDLP_EXTRA_ARGS || '').split(/\s+/).filter(Boolean),
  },
}
