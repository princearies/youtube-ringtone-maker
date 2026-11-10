import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from './api'
import ErrorBanner from './components/ErrorBanner'
import ExportPanel from './components/ExportPanel'
import Footer from './components/Footer'
import Header from './components/Header'
import HowItWorks from './components/HowItWorks'
import ProgressPanel from './components/ProgressPanel'
import TrackCard from './components/TrackCard'
import TrimEditor from './components/TrimEditor'
import UrlForm from './components/UrlForm'
import { clampSelection } from './lib/selection'
import type { Clip, Format, Job, Selection, Source, UiError } from './types'

const MAX_LENGTH: Record<Format, number> = { mp3: 60, m4r: 40 }

type Phase = 'idle' | 'preparing' | 'ready' | 'rendering'

const HINTS: Record<string, string> = {
  BOT_CHECK:
    'YouTube is challenging this server. Give it a minute, or run the engine through a proxy (YTDLP_PROXY).',
  AGE_RESTRICTED: 'Age-restricted videos need cookies: set YTDLP_COOKIES on the engine host.',
  PRIVATE_VIDEO: 'Private videos cannot be extracted.',
  MEMBERS_ONLY: 'Members-only videos cannot be extracted.',
  UNAVAILABLE: 'The video may have been removed or region-locked.',
  LIVE_STREAM: 'Live streams have no fixed audio track.',
  TOO_LONG: 'Pick a video under 15 minutes.',
  PLAYLIST: 'Paste a single video, not a playlist.',
  ENGINE_UNAVAILABLE: 'Start the engine with `npm run dev`, or check ENGINE_URL on the Worker.',
  ENGINE_MISSING_YTDLP: 'Install yt-dlp on the engine host — see the README setup step.',
  RATE_LIMITED: 'You hit the per-minute limit. Wait a few seconds and retry.',
  SOURCE_EXPIRED: 'That audio expired. Paste the link again.',
  FILE_GONE: 'That file expired. Render it again.',
  NETWORK: 'Check your internet connection.',
}

function toUiError(error: unknown): UiError {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message, hint: HINTS[error.code] }
  }
  return {
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : 'Something went wrong.',
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute -top-48 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-indigo-500/20 blur-[130px]" />
      <div className="absolute -bottom-64 -right-24 h-[30rem] w-[30rem] rounded-full bg-fuchsia-500/10 blur-[130px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(99,102,241,0.14),transparent_60%)]" />
    </div>
  )
}

export default function App() {
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [job, setJob] = useState<Job | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [clip, setClip] = useState<Clip | null>(null)
  const [clipJobId, setClipJobId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 30 })
  const [format, setFormat] = useState<Format>('mp3')
  const [error, setError] = useState<UiError | null>(null)
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null)

  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    api
      .health()
      .then((result) => setEngineOnline(Boolean(result.ok)))
      .catch(() => setEngineOnline(false))
  }, [])

  /** Poll GET /api/status/:jobId until the job settles. */
  const follow = useCallback(async (created: Job, onDone: (finished: Job) => void) => {
    let current = created
    setJob(current)

    while (aliveRef.current) {
      if (current.state === 'error') {
        throw new ApiError(
          current.error?.code ?? 'JOB_FAILED',
          current.error?.message ?? 'That job failed.',
        )
      }
      if (current.state === 'done') {
        onDone(current)
        return
      }

      await sleep(600)
      if (!aliveRef.current) return

      current = await api.status(current.id)
      setJob(current)
    }
  }, [])

  const handleSubmit = useCallback(async () => {
    const value = url.trim()
    if (!value || phase === 'preparing') return

    setError(null)
    setClip(null)
    setClipJobId(null)
    setSource(null)
    setJob(null)
    setPhase('preparing')

    try {
      const created = await api.prepare(value)
      await follow(created, (finished) => {
        const next = finished.result as Source
        setSource(next)
        setSelection({
          start: 0,
          end: Math.max(1, Math.min(30, Math.round(next.duration * 10) / 10)),
        })
        setPhase('ready')
      })
    } catch (caught) {
      setError(toUiError(caught))
      setPhase('idle')
    }
  }, [url, phase, follow])

  const handleRender = useCallback(async () => {
    if (!source || phase === 'rendering') return

    setError(null)
    setClip(null)
    setClipJobId(null)
    setPhase('rendering')

    try {
      // POST /api/convert — sourceId skips the download, trim happens server-side.
      const created = await api.convert({
        sourceId: source.id,
        start: selection.start,
        end: selection.end,
        format,
      })
      await follow(created, (finished) => {
        setClip(finished.result as Clip)
        setClipJobId(finished.id)
        setPhase('ready')
      })
    } catch (caught) {
      setError(toUiError(caught))
      setPhase('ready')
    }
  }, [source, phase, selection, format, follow])

  const updateSelection = useCallback(
    (next: Selection) => {
      if (!source) return
      setClip(null)
      setClipJobId(null)
      setSelection(clampSelection(next, source.duration, MAX_LENGTH[format]))
    },
    [source, format],
  )

  const changeFormat = useCallback(
    (next: Format) => {
      setFormat(next)
      setClip(null)
      setClipJobId(null)
      if (source) {
        setSelection((previous) => clampSelection(previous, source.duration, MAX_LENGTH[next]))
      }
    },
    [source],
  )

  const reset = useCallback(() => {
    setSource(null)
    setClip(null)
    setClipJobId(null)
    setJob(null)
    setError(null)
    setPhase('idle')
  }, [])

  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <Backdrop />
      <div className="relative">
        <Header />

        <main className="mx-auto w-full max-w-5xl px-4 pb-14 sm:px-5 sm:pb-16">
          <section className={source ? 'pt-1' : 'pt-6 sm:pt-14'}>
            {!source && (
              <div className="mx-auto max-w-2xl text-center animate-fade-up">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[9px] font-medium uppercase tracking-[0.18em] text-zinc-400 sm:text-[10px]">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                  YouTube → MP3 / M4R
                </span>

                <h1 className="mt-4 font-display text-[2rem] font-bold leading-[1.08] tracking-tight text-zinc-50 sm:mt-5 sm:text-6xl">
                  Any moment,
                  <br className="hidden sm:block" />{' '}
                  <span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">
                    now your ringtone.
                  </span>
                </h1>

                <p className="mx-auto mt-3 max-w-lg text-[13px] leading-relaxed text-zinc-400 sm:mt-4 sm:text-base">
                  Paste a YouTube link, drag out the exact 30 seconds, and download it as MP3 for Android or M4R for
                  iPhone. No app, no account, no watermark.
                </p>
              </div>
            )}

            {!source && (
              <div className="mt-6 sm:mt-8">
                <UrlForm value={url} busy={phase === 'preparing'} onChange={setUrl} onSubmit={handleSubmit} />
              </div>
            )}

            {error && <ErrorBanner error={error} />}
            {phase === 'preparing' && job && <ProgressPanel job={job} />}
            {phase === 'rendering' && job && (
              <div className="lg:hidden">
                <ProgressPanel job={job} />
              </div>
            )}
          </section>

          {source && (
            <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <div className="space-y-4 sm:space-y-5">
                <TrackCard source={source} onChangeLink={reset} />
                <TrimEditor
                  source={source}
                  selection={selection}
                  maxLength={MAX_LENGTH[format]}
                  disabled={phase === 'rendering'}
                  onChange={updateSelection}
                  onError={setError}
                />
              </div>

              <ExportPanel
                format={format}
                selection={selection}
                maxLength={MAX_LENGTH[format]}
                busy={phase === 'rendering'}
                progress={job?.progress ?? 0}
                clip={clip}
                jobId={clipJobId}
                onFormat={changeFormat}
                onRender={handleRender}
                onDismissClip={() => {
                  setClip(null)
                  setClipJobId(null)
                }}
              />
            </div>
          )}

          {!source && phase !== 'preparing' && <HowItWorks />}
        </main>

        <Footer engineOnline={engineOnline} />
      </div>
    </div>
  )
}
