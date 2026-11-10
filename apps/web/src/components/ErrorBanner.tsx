import type { UiError } from '../types'

export default function ErrorBanner({ error }: { error: UiError }) {
  return (
    <div
      role="alert"
      className="mx-auto mt-5 w-full max-w-2xl rounded-2xl border border-rose-400/25 bg-rose-500/10 p-4 animate-fade-up"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-rose-300">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5m0 3h.01" strokeLinecap="round" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-rose-100">{error.message}</p>
          {error.hint && <p className="mt-1 text-xs leading-relaxed text-rose-200/70">{error.hint}</p>}
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-rose-300/40">{error.code}</p>
        </div>
      </div>
    </div>
  )
}
