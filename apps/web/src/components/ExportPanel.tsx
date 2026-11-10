import { useEffect, useRef } from 'react'
import { api } from '../api'
import { formatBytes, formatLength } from '../lib/time'
import type { Clip, Format, Selection } from '../types'

const OPTIONS: Array<{ value: Format; title: string; subtitle: string; note: string }> = [
  { value: 'mp3', title: 'MP3', subtitle: 'Android · any player', note: 'up to 60s' },
  { value: 'm4r', title: 'M4R', subtitle: 'iPhone ringtone', note: 'max 40s' },
]

interface Props {
  format: Format
  selection: Selection
  maxLength: number
  busy: boolean
  progress: number
  clip: Clip | null
  jobId: string | null
  onFormat: (format: Format) => void
  onRender: () => void
  onDismissClip: () => void
}

export default function ExportPanel({
  format,
  selection,
  maxLength,
  busy,
  progress,
  clip,
  jobId,
  onFormat,
  onRender,
  onDismissClip,
}: Props) {
  const length = Math.max(0, selection.end - selection.start)
  const resultRef = useRef<HTMLDivElement | null>(null)

  // On phones the panel is below the editor: bring the finished file into view.
  useEffect(() => {
    if (!clip) return
    if (window.matchMedia('(max-width: 1023px)').matches) {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [clip])

  return (
    <section className="card p-4 sm:p-5" aria-label="Export">
      <h2 className="font-display text-sm font-semibold tracking-wide text-zinc-200">Export</h2>
      <p className="mt-0.5 text-[11px] text-zinc-500 sm:text-xs">Pick the format your phone wants.</p>

      <div role="radiogroup" aria-label="Ringtone format" className="mt-3 grid gap-2 sm:mt-4">
        {OPTIONS.map((option) => {
          const selected = option.value === format
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onFormat(option.value)}
              className={`flex min-h-[3.5rem] items-center justify-between rounded-2xl border px-3.5 py-3 text-left transition ${
                selected
                  ? 'border-indigo-300/50 bg-indigo-400/10'
                  : 'border-white/10 bg-white/[0.02] hover:border-white/20'
              }`}
            >
              <span>
                <span className="block text-sm font-semibold text-zinc-100">
                  {option.title}
                  <span className="ml-2 text-[11px] font-normal text-zinc-500">{option.note}</span>
                </span>
                <span className="mt-0.5 block text-[11px] text-zinc-400">{option.subtitle}</span>
              </span>
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                  selected ? 'border-indigo-300 bg-indigo-300' : 'border-white/25'
                }`}
              >
                {selected && <span className="h-1.5 w-1.5 rounded-full bg-black" />}
              </span>
            </button>
          )
        })}
      </div>

      <button type="button" className="btn-primary mt-3 w-full sm:mt-4" disabled={busy} onClick={onRender}>
        {busy ? (
          <>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/30 border-t-black" />
            Rendering… {progress}%
          </>
        ) : (
          <>Render {format.toUpperCase()} ringtone</>
        )}
      </button>

      <p className="mt-2 text-center text-[11px] text-zinc-500">
        {formatLength(length)} selected · {maxLength}s cap
      </p>

      {clip && jobId && (
        <div
          ref={resultRef}
          className="mt-4 scroll-mt-4 rounded-2xl border border-emerald-300/25 bg-emerald-400/[0.07] p-3.5 animate-fade-up"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-300/80">Ready</p>
              <p className="mt-1 truncate text-xs font-medium text-zinc-100" title={clip.filename}>
                {clip.filename}
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-400">
                {formatBytes(clip.bytes)} · {formatLength(clip.duration)}
              </p>
            </div>
            <button
              type="button"
              onClick={onDismissClip}
              className="chip min-h-8 shrink-0 px-2 py-0.5 text-[10px]"
              aria-label="Dismiss result"
            >
              ✕
            </button>
          </div>

          <a
            href={api.downloadUrl(jobId)}
            download={clip.filename}
            className="btn-primary mt-3 w-full py-3 text-sm"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
            </svg>
            Download {clip.format.toUpperCase()}
          </a>

          <details className="mt-2">
            <summary className="cursor-pointer list-none py-1 text-center text-[11px] text-zinc-400 hover:text-zinc-200">
              Listen before you download
            </summary>
            <audio controls src={api.downloadUrl(jobId, true)} className="mt-2 w-full" />
          </details>

          {clip.format === 'm4r' && (
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
              iPhone: open Finder, drag the file onto your device, then pick it in Settings → Sounds → Ringtone.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
