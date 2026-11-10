import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

interface Props {
  peaks: number[]
  duration: number
  start: number
  end: number
  playhead?: number
  disabled?: boolean
  onSeek: (handle: 'start' | 'end', time: number) => void
}

export default function Waveform({ peaks, duration, start, end, playhead = 0, disabled, onSeek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<'start' | 'end' | null>(null)
  const [width, setWidth] = useState(0)

  // Shorter on phones so the editor does not push the export panel off-screen.
  const height = width > 0 && width < 430 ? 104 : 132

  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(node)
    setWidth(node.clientWidth)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0) return

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const length = Math.max(0.001, duration)
    const xOf = (time: number) => (Math.min(length, Math.max(0, time)) / length) * width
    const startX = xOf(start)
    const endX = xOf(end)
    const middle = height / 2

    ctx.fillStyle = 'rgba(129, 140, 248, 0.10)'
    ctx.fillRect(startX, 0, Math.max(2, endX - startX), height)

    const count = Math.max(40, Math.floor(width / (width < 430 ? 3.4 : 3)))
    const slot = width / count
    const gradient = ctx.createLinearGradient(0, 0, width, 0)
    gradient.addColorStop(0, '#818cf8')
    gradient.addColorStop(1, '#e879f9')

    const hasPeaks = peaks.length > 0

    for (let index = 0; index < count; index += 1) {
      const from = Math.floor((index / count) * peaks.length)
      const to = Math.max(from + 1, Math.floor(((index + 1) / count) * peaks.length))

      let value = 0.18
      if (hasPeaks) {
        value = 0
        for (let cursor = from; cursor < to; cursor += 1) value = Math.max(value, peaks[cursor] ?? 0)
      }

      const barHeight = Math.max(2, value * (height - 14))
      const barWidth = Math.max(1, slot * 0.62)
      const x = index * slot + slot * 0.19
      const centerX = x + barWidth / 2
      const selected = centerX >= startX && centerX <= endX

      ctx.fillStyle = selected ? gradient : 'rgba(255, 255, 255, 0.14)'
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, middle - barHeight / 2, barWidth, barHeight, barWidth / 2)
      } else {
        ctx.rect(x, middle - barHeight / 2, barWidth, barHeight)
      }
      ctx.fill()
    }

    // Handles: a 2px rule plus a grip dot, sized for thumbs.
    for (const [handle, x] of [['start', startX], ['end', endX]] as const) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.fillRect(x - 1, 0, 2, height)
      ctx.fillStyle = '#0b0b12'
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, handle === 'start' ? 11 : height - 11, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    if (playhead > 0.01) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
      ctx.fillRect(xOf(playhead) - 0.75, 0, 1.5, height)
    }
  }, [peaks, duration, start, end, playhead, width, height])

  const timeAt = (clientX: number) => {
    const canvas = canvasRef.current
    if (!canvas) return 0
    const rect = canvas.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return ratio * duration
  }

  const handleDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    const time = timeAt(event.clientX)
    const handle: 'start' | 'end' = Math.abs(time - start) <= Math.abs(time - end) ? 'start' : 'end'
    dragRef.current = handle
    event.currentTarget.setPointerCapture(event.pointerId)
    onSeek(handle, time)
  }

  const handleMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled || !dragRef.current) return
    onSeek(dragRef.current, timeAt(event.clientX))
  }

  const handleUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div ref={wrapRef} className="relative select-none">
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={`w-full touch-none rounded-xl bg-black/30 ${disabled ? 'cursor-default opacity-60' : 'cursor-ew-resize'}`}
        style={{ height }}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
      />
    </div>
  )
}
