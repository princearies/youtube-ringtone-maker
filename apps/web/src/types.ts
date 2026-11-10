export type Format = 'mp3' | 'm4r'

export type JobState = 'queued' | 'running' | 'done' | 'error'

export type Stage =
  | 'queued'
  | 'starting'
  | 'metadata'
  | 'download'
  | 'convert'
  | 'analyze'
  | 'finalize'
  | 'render'
  | 'done'

export interface JobError {
  code: string
  message: string
}

export interface VideoMeta {
  id: string
  title: string
  duration: number
  thumbnail: string | null
  uploader: string | null
}

export interface Source {
  id: string
  video: VideoMeta
  duration: number
  peaks: number[]
  audioUrl: string
  expiresAt: number
}

export interface Clip {
  downloadUrl: string
  inlineUrl: string
  filename: string
  format: Format
  bytes: number
  duration: number
  start: number
  end: number
}

export interface Job {
  id: string
  type: 'prepare' | 'render'
  state: JobState
  stage: Stage | string
  progress: number
  result: Source | Clip | null
  error: JobError | null
  createdAt: number
  finishedAt: number | null
}

export interface Selection {
  start: number
  end: number
}

export interface UiError {
  code: string
  message: string
  hint?: string
}
