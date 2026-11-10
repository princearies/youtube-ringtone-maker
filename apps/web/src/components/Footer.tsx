interface Props {
  engineOnline: boolean | null
}

export default function Footer({ engineOnline }: Props) {
  const dot = engineOnline === null ? 'bg-zinc-500' : engineOnline ? 'bg-emerald-400' : 'bg-amber-400'
  const label = engineOnline === null ? 'Checking engine…' : engineOnline ? 'Engine online' : 'Engine offline'

  return (
    <footer
      className="mx-auto w-full max-w-5xl px-4 pt-4 sm:px-5 sm:pt-6"
      style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex flex-col gap-2 border-t border-white/[0.07] pt-4 text-[11px] text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:pt-5">
        <p className="leading-relaxed">Ringcut · Cloudflare Worker + ffmpeg engine · clips deleted after 15 minutes.</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
            {label}
          </span>
          <span className="text-zinc-600">Only download audio you have the rights to use.</span>
        </div>
      </div>
    </footer>
  )
}
