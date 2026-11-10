import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.mjs'

export const state = {
  sources: new Map(),
  jobs: new Map(),
  clips: new Map(),
}

export function newId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 22)}`
}

/** FIFO concurrency gate so a tiny VPS never runs two ffmpeg jobs too many. */
export function createLimiter(max) {
  let active = 0
  const queue = []

  const pump = () => {
    if (active >= max || queue.length === 0) return
    const job = queue.shift()
    active += 1
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1
        pump()
      })
  }

  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject })
    pump()
  })
}

const limit = createLimiter(config.maxParallel)

export function queueDepth() {
  return 0 // exposed for symmetry; real depth is internal to the limiter
}

/** Public, leak-free view of a job. */
export function publicJob(job) {
  return {
    id: job.id,
    type: job.type,
    state: job.state,
    stage: job.stage,
    progress: job.progress,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt ?? null,
  }
}

/**
 * Register a job and run it through the limiter.
 * `runner(setPatch, job)` may report progress via setPatch.
 */
export function startJob(type, runner) {
  const now = Date.now()
  const job = {
    id: newId('job'),
    type,
    state: 'queued',
    stage: 'queued',
    progress: 0,
    result: null,
    error: null,
    createdAt: now,
    finishedAt: null,
    expiresAt: now + config.ttlMs,
  }
  state.jobs.set(job.id, job)

  limit(async () => {
    job.state = 'running'
    job.startedAt = Date.now()
    try {
      const result = await runner((patch) => Object.assign(job, patch), job)
      job.result = result
      job.state = 'done'
      job.stage = 'done'
      job.progress = 100
    } catch (err) {
      job.state = 'error'
      job.error = {
        code: err?.code && /^[A-Z0-9_]{3,40}$/.test(err.code) ? err.code : 'ENGINE_ERROR',
        message: typeof err?.message === 'string' ? err.message : 'Something went wrong.',
      }
    } finally {
      job.finishedAt = Date.now()
      job.expiresAt = Date.now() + config.ttlMs
    }
  }).catch(() => {})

  return job
}

export function getJob(id) {
  const job = state.jobs.get(id)
  if (!job) return null
  if (job.expiresAt < Date.now()) {
    state.jobs.delete(id)
    return null
  }
  return job
}

export function registerSource(record) {
  state.sources.set(record.id, record)
  return record
}

export function getSource(id) {
  const source = state.sources.get(id)
  if (!source) return null
  if (source.expiresAt < Date.now()) return null
  return source
}

export function publicSource(source) {
  return {
    id: source.id,
    video: source.video,
    duration: source.duration,
    peaks: source.peaks,
    audioUrl: `/api/sources/${source.id}/audio`,
    expiresAt: source.expiresAt,
  }
}

export function registerClip(jobId, record) {
  state.clips.set(jobId, record)
  return record
}

export function getClip(jobId) {
  const clip = state.clips.get(jobId)
  if (!clip) return null
  if (clip.expiresAt < Date.now()) return null
  return clip
}

async function removeQuietly(target) {
  try {
    await fs.rm(target, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

/** Drop expired sources, clips and jobs; delete their bytes from disk. */
export async function sweep() {
  const now = Date.now()

  for (const [id, source] of state.sources) {
    if (source.expiresAt < now) {
      state.sources.delete(id)
      await removeQuietly(source.dir)
    }
  }

  for (const [id, clip] of state.clips) {
    if (clip.expiresAt < now) {
      state.clips.delete(id)
      await removeQuietly(clip.path)
    }
  }

  for (const [id, job] of state.jobs) {
    const expiry = job.finishedAt ? job.expiresAt : job.createdAt + config.ttlMs * 2
    if (expiry < now) state.jobs.delete(id)
  }
}

export async function resetWorkDir() {
  await fs.rm(config.workDir, { recursive: true, force: true })
  await fs.mkdir(path.join(config.workDir, 'sources'), { recursive: true })
  await fs.mkdir(path.join(config.workDir, 'clips'), { recursive: true })
}
