export default function Header() {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-5 sm:py-6">
      <a href="/" className="flex items-center gap-2" aria-label="Ringcut home">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-400 to-fuchsia-400 sm:h-9 sm:w-9 sm:rounded-xl">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#0a0a10" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M4 10v4M8.5 6v12M13 3.5v17M17.5 8v8M22 10.5v3" />
          </svg>
        </span>
        <span className="font-display text-[15px] font-semibold tracking-tight text-zinc-100 sm:text-base">Ringcut</span>
      </a>

      <nav className="flex items-center gap-3 text-[11px] text-zinc-400 sm:gap-4 sm:text-xs">
        <a href="#how" className="transition hover:text-zinc-100">
          How it works
        </a>
        <span className="hidden h-3 w-px bg-white/10 sm:block" aria-hidden="true" />
        <span className="hidden font-mono text-[11px] text-zinc-500 sm:inline">mp3 · m4r</span>
      </nav>
    </header>
  )
}
