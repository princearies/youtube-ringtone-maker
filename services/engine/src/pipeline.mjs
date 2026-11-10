import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.mjs'
import { computePeaks, ensurePlayableAudio, probeAudio, renderClip } from './media.mjs'
import {
  AppError,
  assertFormat,
  clampRange,
  parseLocalFile,
  parseYouTubeUrl,
} from './security.mjs'
import {
  getSource,
  publicSource,
  registerClip,
  registerSource,
  startJob,
  state,
} from './store.mjs'
import { probeVideo, downloadAudio } from './ytdlp.mjs'

function slug(value, fallback = 'ringtone') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return cleaned || fallback
}

function clock(seconds) {
  const total = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}m${String(total % 60).padStart(2, '0')}s`
}

function sourceDir(key) {
  return path.join(config.workDir, 'sources', key)
}

/**
 * Resolve any supported input into a ready-to-trim source:
 * metadata → download → normalise to AAC/MP4 → duration → waveform peaks.
 *
 * `report(stage, fraction)` receives a 0..1 fraction so the caller can map it
 * onto its own progress budget (prepare uses 0..100, convert uses 0..68).
 */
async function prepareSource(input, report) {
  const localPath = parseLocalFile(input, { enabled: config.devLocalFiles })

  let key
  let video
  let origin
  let canonical = null

  if (localPath) {
    const stat = await fs.stat(localPath)
    key = `local_${crypto.createHash('sha1')
      .update(`${localPath}:${stat.size}:${stat.mtimeMs}`)
      .digest('hex')
      .slice(0, 22)}`
    origin = localPath
    report('metadata', 0.04)
    const facts = await probeAudio(localPath)
    video = {
      id: key,
      title: path.basename(localPath, path.extname(localPath)).slice(0, 200),
      duration: facts.duration,
      thumbnail: null,
      uploader: 'Local file',
    }
  } else {
    const parsed = parseYouTubeUrl(input)
    key = parsed.videoId
    canonical = parsed.canonical
    origin = canonical

    report('metadata', 0.03)
    const meta = await probeVideo(canonical)
    video = {
      id: meta.videoId,
      title: meta.title,
      duration: meta.duration,
      thumbnail: meta.thumbnail,
      uploader: meta.uploader,
    }
    if (meta.duration > config.maxSourceDuration) {
      throw new AppError('TOO_LONG', `Keep it under ${Math.round(config.maxSourceDuration / 60)} minutes.`, 422)
    }
  }

  if (video.duration > config.maxSourceDuration) {
    throw new AppError('TOO_LONG', `Keep it under ${Math.round(config.maxSourceDuration / 60)} minutes.`, 422)
  }

  const cached = state.sources.get(key)
  if (cached && cached.expiresAt > Date.now() && cached.origin === origin) {
    try {
      await fs.access(cached.file)
      return cached
    } catch {
      state.sources.delete(key)
    }
  }

  const dir = sourceDir(key)
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })

  let downloaded
  if (localPath) {
    downloaded = localPath
  } else {
    report('download', 0.1)
    downloaded = await downloadAudio(canonical, dir, (percent) => {
      report('download', 0.1 + (percent / 100) * 0.55)
    })
  }

  report('convert', 0.7)
  const playable = await ensurePlayableAudio(downloaded, dir)

  report('analyze', 0.84)
  const peaks = await computePeaks(playable.file)

  report('finalize', 0.96)

  return registerSource({
    id: key,
    origin,
    dir,
    file: playable.file,
    contentType: playable.contentType,
    video,
    duration: playable.facts.duration,
    peaks,
    expiresAt: Date.now() + config.ttlMs,
    createdAt: Date.now(),
  })
}

/** Cut the requested window and encode MP3 (Android) or M4R (iPhone). */
async function renderSource(source, { start, end, format, jobId, set, baseProgress = 70 }) {
  const chosen = assertFormat(format)
  const maxClip = chosen === 'm4r' ? config.maxM4rDuration : config.maxClipDuration
  const range = clampRange({ start, end }, source.duration, maxClip)

  if (range.duration < 1) {
    throw new AppError('CLIP_TOO_SHORT', 'Pick at least one second.', 422)
  }

  set({ stage: 'render', progress: Math.min(92, baseProgress + 12) })

  const outPath = path.join(config.workDir, 'clips', `${jobId}.${chosen}`)
  await fs.mkdir(path.dirname(outPath), { recursive: true })

  const { bytes } = await renderClip({
    input: source.file,
    output: outPath,
    start: range.start,
    end: range.end,
    format: chosen,
  })

  set({ stage: 'finalize', progress: 94 })

  const filename = `${slug(source.video.title)} ${clock(range.start)}-${clock(range.end)}.${chosen}`
  registerClip(jobId, {
    path: outPath,
    filename,
    format: chosen,
    bytes,
    duration: range.duration,
    expiresAt: Date.now() + config.ttlMs,
  })

  // Keep the source alive at least one more TTL after a successful render.
  source.expiresAt = Date.now() + config.ttlMs

  return {
    downloadUrl: `/api/download/${jobId}`,
    inlineUrl: `/api/download/${jobId}?inline=1`,
    filename,
    format: chosen,
    bytes,
    duration: range.duration,
    start: range.start,
    end: range.end,
    sourceId: source.id,
  }
}

/** Stage 1 — editor flow: return the source with waveform peaks for preview. */
export function startPrepare(input) {
  return startJob('prepare', async (set) => {
    const source = await prepareSource(input, (stage, fraction) => {
      set({ stage, progress: Math.max(2, Math.round(fraction * 96)) })
    })
    return publicSource(source)
  })
}

/** One-shot conversion used by POST /api/convert. */
export function startConvert({ input, sourceId, start, end, format }) {
  return startJob('convert', async (set, job) => {
    let source

    if (sourceId) {
      source = getSource(sourceId)
      if (!source) {
        throw new AppError('SOURCE_EXPIRED', 'That audio expired. Load the link again.', 410)
      }
      set({ stage: 'render', progress: 10 })
    } else {
      if (!input) throw new AppError('MISSING_URL', 'Paste a YouTube link first.')
      source = await prepareSource(input, (stage, fraction) => {
        set({ stage, progress: Math.max(1, Math.round(fraction * 68)) })
      })
    }

    return renderSource(source, {
      start,
      end,
      format,
      jobId: job.id,
      set,
      baseProgress: sourceId ? 10 : 68,
    })
  })
}

/** Legacy two-step flow (kept for the editor's render button). */
export function startRender({ sourceId, start, end, format }) {
  return startJob('render', async (set, job) => {
    const source = getSource(sourceId)
    if (!source) {
      throw new AppError('SOURCE_EXPIRED', 'That audio expired. Load the link again.', 410)
    }
    return renderSource(source, { start, end, format, jobId: job.id, set, baseProgress: 10 })
  })
}

export async function discardSource(id) {
  const source = state.sources.get(id)
  if (!source) return false
  state.sources.delete(id)
  try {
    await fs.rm(source.dir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
  return true
}
