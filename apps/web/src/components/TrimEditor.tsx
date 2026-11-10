import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { formatClock, formatLength, parseClock } from '../lib/time'
import type { Selection, Source, UiError } from '../types'
import Waveform from './Waveform'

interface Props {
  source: Source
  selection: Selection
  maxLength: number
  disabled?: boolean
  onChange: (next: Selection) => void
  onError: (error: UiError) => void
}

interface TimeFieldProps {
  label: string
  value: number
  max: number
  onCommit: (value: number) => void
}

function TimeField({ label, value, max, onCommit }: TimeFieldProps) {
  const [text, setText] = useState(() => formatClock(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(formatClock(value))
  }, [value, focused])

  const commit = () => {
    const parsed = parseClock(text)
    if (parsed === null) {
      setText(formatClock(value))
      return
    }
    onCommit(Math.min(max, Math.max(0, parsed)))
  }

  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-none">
      <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">{label}</span>
      <input
        className="field w-full text-center font-mono text-base tabular-nums sm:w-[6.6rem] sm:text-sm"
        value={text}
        inputMode="decimal"
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          setFocused(false)
          commit()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </label>
  )
}

export default function TrimEditor({ source, selection, maxLength, disabled, onChange, onError }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const loopRef = useRef(true)
  const selectionRef = useRef(selection)

  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(true)
  const [playhead, setPlayhead] = useState(0)
  const [previewFailed, setPreviewFailed] = useState(false)

  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  useEffect(() => {
    loopRef.current = loop
  }, [loop])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTime = () => {
      const time = audio.currentTime
      setPlayhead(time)
      const { start, end } = selectionRef.current

      if (time >= end - 0.01) {
        if (loopRef.current) {
          audio.currentTime = start
        } else {
          audio.pause()
          setPlaying(false)
          audio.currentTime = start
        }
      }
    }

    const onEnded = () => {
      setPlaying(false)
      audio.currentTime = selectionRef.current.start
    }

    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
    }
  }, [])

  // Keep playback inside the window when a handle moves.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || audio.paused) return
    if (audio.currentTime < selection.start || audio.currentTime > selection.end) {
      audio.currentTime = selection.start
    }
  }, [selection.start, selection.end])

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
    }
  }, [])

  const toggle = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return

    if (!audio.paused) {
      audio.pause()
      return
    }

    if (audio.currentTime < selection.start || audio.currentTime >= selection.end) {
      audio.currentTime = selection.start
      setPlayhead(selection.start)
    }

    try {
      await audio.play()
    } catch {
      onError({
        code: 'PLAYBACK_BLOCKED',
        message: 'Playback was blocked by the browser.',
        hint: 'Press play once more, or check that the preview has not expired.',
      })
    }
  }, [selection.start, selection.end, onError])

  const seek = (handle: 'start' | 'end', time: number) => {
    if (handle === 'start') {
      onChange({ start: Math.min(time, selection.end - 0.5), end: selection.end })
    } else {
      onChange({ start: selection.start, end: Math.max(time, selection.start + 0.5) })
    }
  }

  const span = Math.min(maxLength, 30)
  const duration = source.duration
  const presets =
    duration > 5
      ? [
          { label: 'First', range: { start: 0, end: Math.min(span, duration) } },
          {
            label: 'Middle',
            range: {
              start: Math.max(0, duration / 2 - span / 2),
              end: Math.min(duration, duration / 2 + span / 2),
            },
          },
          { label: 'Last', range: { start: Math.max(0, duration - span), end: duration } },
        ]
      : []

  const length = Math.max(0, selection.end - selection.start)

  return (
    <section className="card p-4 sm:p-5" aria-label="Trim the ringtone">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold tracking-wide text-zinc-200">Trim</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500 sm:text-xs">
            Drag a handle, or type the exact start and end time.
          </p>
        </div>
        <span className="chip shrink-0 whitespace-nowrap font-mono text-[11px]">
          {formatLength(length)} / {maxLength}s
        </span>
      </div>

      <div className="mt-3 sm:mt-4">
        <Waveform
          peaks={source.peaks}
          duration={duration}
          start={selection.start}
          end={selection.end}
          playhead={playhead}
          disabled={disabled}
          onSeek={seek}
        />
      </div>

      <audio
        ref={audioRef}
        src={api.previewUrl(source.id)}
        preload="metadata"
        onError={() => setPreviewFailed(true)}
        hidden
      />

      <div className="mt-3 flex flex-col gap-3 sm:mt-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex items-end gap-2.5 sm:gap-3">
          <TimeField
            label="Start"
            value={selection.start}
            max={duration}
            onCommit={(value) => onChange({ start: value, end: Math.max(value + 0.5, selection.end) })}
          />
          <TimeField
            label="End"
            value={selection.end}
            max={duration}
            onCommit={(value) => onChange({ start: Math.min(selection.start, value - 0.5), end: value })}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            disabled={disabled}
            aria-label={playing ? 'Pause preview' : 'Play preview'}
            className="grid h-12 w-12 place-items-center rounded-full bg-white text-black transition hover:bg-zinc-200 disabled:opacity-40 sm:h-11 sm:w-11"
          >
            {playing ? (
              <svg width="14" height="14" viewBox="0 0 12 14" fill="currentColor" aria-hidden="true">
                <rect x="1" y="1" width="3.4" height="12" rx="1" />
                <rect x="7.6" y="1" width="3.4" height="12" rx="1" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 12 14" fill="currentColor" aria-hidden="true">
                <path d="M1.4 1.2a1 1 0 0 1 1.5-.86l8 5.8a1 1 0 0 1 0 1.72l-8 5.8A1 1 0 0 1 1.4 12.8Z" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={() => setLoop((value) => !value)}
            aria-pressed={loop}
            className={`chip min-h-9 px-3 text-[11px] ${loop ? 'border-indigo-300/40 bg-indigo-400/15 text-indigo-100' : ''}`}
          >
            Loop
          </button>

          <span className="font-mono text-xs tabular-nums text-zinc-500">{formatClock(playhead)}</span>
        </div>
      </div>

      {presets.length > 0 && (
        <div className="no-scrollbar -mx-1 mt-3 flex items-center gap-2 overflow-x-auto px-1 pb-0.5 sm:mt-4 sm:flex-wrap sm:overflow-visible">
          <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-zinc-600">Jump to</span>
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="chip shrink-0 whitespace-nowrap text-[11px]"
              disabled={disabled}
              onClick={() => onChange(preset.range)}
            >
              {preset.label} · {formatLength(preset.range.end - preset.range.start)}
            </button>
          ))}
        </div>
      )}

      {previewFailed && (
        <p className="mt-3 text-xs text-amber-300/90">
          Preview could not load — the audio may have expired. Paste the link again to reload it.
        </p>
      )}
    </section>
  )
}
