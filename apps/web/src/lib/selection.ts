import type { Selection } from '../types'

/**
 * Keep the trim window inside the track and inside the format's length cap.
 * Every caller goes through this, so the UI can never send an invalid range.
 */
export function clampSelection(next: Selection, duration: number, maxLength: number): Selection {
  const safeDuration = Math.max(1, Number(duration) || 0)
  const limit = Math.max(1, Math.min(maxLength, safeDuration))

  let start = Number.isFinite(next.start) ? Math.max(0, next.start) : 0
  let end = Number.isFinite(next.end) ? next.end : start + limit

  start = Math.min(start, safeDuration - 0.5)
  start = Math.max(0, start)
  end = Math.min(Math.max(end, start + 0.5), safeDuration)

  if (end - start > limit) {
    end = start + limit
    if (end > safeDuration) {
      end = safeDuration
      start = Math.max(0, end - limit)
    }
  }

  return {
    start: Math.round(start * 100) / 100,
    end: Math.round(end * 100) / 100,
  }
}
