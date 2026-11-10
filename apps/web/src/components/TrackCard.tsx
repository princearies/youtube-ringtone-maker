import { formatClock } from '../lib/time'
import type { Source } from '../types'

interface Props {
  source: Source
  onChangeLink: () => void
}

export default function TrackCard({ source, onChangeLink }: Props) {
  const { video } = source

  return (
    <section className="card flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
      <div className="relative aspect-video w-[4.5rem] shrink-0 overflow-hidden rounded-lg bg-zinc-900 sm:w-32 sm:rounded-xl">
        {video.thumbnail ? (
          <img
            src={video.thumbnail}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-zinc-600">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 3a4 4 0 0 0-4 4v4a4 4 0 0 0 8 0V7a4 4 0 0 0-4-4Zm-7 8a7 7 0 0 0 14 0h-2a5 5 0 0 1-10 0H5Zm6 7.9V22h2v-3.1a7 7 0 0 0 6-6.9h-2a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9Z" />
            </svg>
          </div>
        )}
        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 py-0.5 font-mono text-[9px] text-zinc-200 sm:bottom-1 sm:right-1 sm:text-[10px]">
          {formatClock(video.duration, 0)}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-medium uppercase tracking-[0.16em] text-emerald-300/80 sm:text-[10px]">
          Audio ready
        </p>
        <h2
          className="mt-0.5 truncate font-display text-sm font-semibold text-zinc-100 sm:mt-1 sm:text-lg"
          title={video.title}
        >
          {video.title}
        </h2>
        <p className="mt-0.5 truncate text-[11px] text-zinc-500 sm:text-xs">
          {video.uploader ?? 'Unknown channel'} · {formatClock(source.duration)}
        </p>
      </div>

      <button
        type="button"
        onClick={onChangeLink}
        className="chip min-h-9 shrink-0 self-start whitespace-nowrap px-2.5 text-[11px]"
      >
        Change
      </button>
    </section>
  )
}
