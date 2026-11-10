import type { Job } from '../types'

const STAGE_COPY: Record<string, string> = {
  queued: 'Queued…',
  starting: 'Starting…',
  metadata: 'Reading the video…',
  download: 'Downloading the audio…',
  convert: 'Preparing the audio…',
  analyze: 'Building the waveform…',
  finalize: 'Finishing up…',
  render: 'Rendering your ringtone…',
  done: 'Done',
}

export default function ProgressPanel({ job }: { job: Job }) {
  const percent = Math.max(0, Math.min(100, Math.round(job.progress || 0)))
  const label = STAGE_COPY[job.stage] ?? 'Working…'

  return (
    <div className="mx-auto mt-6 w-full max-w-2xl" aria-live="polite">
      <div className="flex items-baseline justify-between px-1">
        <span className="text-xs text-zinc-400">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-zinc-500">{percent}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="progress-sheen h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(4, percent)}%` }}
        />
      </div>
      <p className="mt-2 px-1 text-[11px] text-zinc-600">
        First run downloads and analyses the track, so it can take 10–40 seconds.
      </p>
    </div>
  )
}
