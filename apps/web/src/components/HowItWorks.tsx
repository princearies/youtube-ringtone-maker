const STEPS = [
  {
    title: 'Paste the link',
    body: 'Any watch, share, Shorts or youtu.be URL. We read the title and length before touching the audio.',
  },
  {
    title: 'Trim the moment',
    body: 'Drag both handles on the waveform, or type the timestamps. Loop the selection until it sounds right.',
  },
  {
    title: 'Download and set it',
    body: 'MP3 goes straight to Android. M4R drops into your iPhone’s Tones folder in Finder.',
  },
]

export default function HowItWorks() {
  return (
    <section id="how" className="mt-20 animate-fade-up">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-zinc-400">How it works</h2>
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <article key={step.title} className="card p-5">
            <span className="font-mono text-[11px] text-indigo-300/70">0{index + 1}</span>
            <h3 className="mt-2 font-display text-base font-semibold text-zinc-100">{step.title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{step.body}</p>
          </article>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
          <p className="text-xs font-medium text-zinc-300">Why MP3 vs M4R?</p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            Android reads MP3 from any file manager. iPhone only accepts AAC audio inside an .m4r container, and
            iOS caps ringtones at 40 seconds — so Ringcut enforces that for you.
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
          <p className="text-xs font-medium text-zinc-300">Files disappear on their own</p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            Rendered clips are temporary and deleted from the server after 15 minutes. Nothing is stored long-term
            and there is no account to create.
          </p>
        </div>
      </div>
    </section>
  )
}
