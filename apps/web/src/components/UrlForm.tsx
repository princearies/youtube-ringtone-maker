interface Props {
  value: string
  busy: boolean
  onChange: (value: string) => void
  onSubmit: () => void
}

export default function UrlForm({ value, busy, onChange, onSubmit }: Props) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
      className="mx-auto flex w-full max-w-2xl flex-col gap-2.5 sm:flex-row"
    >
      <div className="relative flex-1">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M21.6 7.2a2.8 2.8 0 0 0-1.97-1.98C17.9 4.75 12 4.75 12 4.75s-5.9 0-7.63.47A2.8 2.8 0 0 0 2.4 7.2C1.92 8.93 1.92 12 1.92 12s0 3.07.48 4.8a2.8 2.8 0 0 0 1.97 1.98c1.73.47 7.63.47 7.63.47s5.9 0 7.63-.47a2.8 2.8 0 0 0 1.97-1.98c.48-1.73.48-4.8.48-4.8s0-3.07-.48-4.8ZM10.1 15.3V8.7L15.8 12l-5.7 3.3Z" />
          </svg>
        </span>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Paste a YouTube link…"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="YouTube link"
          /* text-base on phones: iOS Safari zooms the page for inputs under 16px. */
          className="w-full rounded-2xl border border-white/10 bg-white/[0.04] py-3.5 pl-11 pr-4 text-base text-zinc-100 placeholder:text-zinc-500 transition focus:border-indigo-300/50 focus:bg-white/[0.06] focus:outline-none sm:text-sm"
        />
      </div>

      <button
        type="submit"
        className="btn-primary w-full shrink-0 px-5 py-3.5 sm:w-auto"
        disabled={busy || !value.trim()}
      >
        {busy ? (
          <>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/30 border-t-black" />
            Extracting…
          </>
        ) : (
          'Extract & Trim Audio'
        )}
      </button>
    </form>
  )
}
