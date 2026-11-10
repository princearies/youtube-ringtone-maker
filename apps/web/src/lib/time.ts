/** 83.4 → "1:23.4" */
export function formatClock(seconds: number, decimals = 1): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const total = decimals > 0 ? Math.round(safe * 10 ** decimals) / 10 ** decimals : Math.round(safe)
  const minutes = Math.floor(total / 60)
  const rest = total - minutes * 60
  const restText = decimals > 0 ? rest.toFixed(decimals).padStart(decimals + 3, '0') : String(rest).padStart(2, '0')
  return `${minutes}:${restText}`
}

/** "1:23.4" or "83.4" or "1:23" → seconds (null when unparseable) */
export function parseClock(input: string): number | null {
  const text = input.trim().replace(',', '.')
  if (!text) return null
  if (!/^\d{1,3}(:\d{1,2}(\.\d{0,3})?)?(\.\d{0,3})?$/.test(text)) return null

  const parts = text.split(':')
  if (parts.length > 2) return null

  const numbers = parts.map((part) => Number.parseFloat(part))
  if (numbers.some((value) => !Number.isFinite(value) || value < 0)) return null

  const seconds = parts.length === 2 ? numbers[0] * 60 + numbers[1] : numbers[0]
  return Number.isFinite(seconds) ? seconds : null
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatLength(seconds: number): string {
  const value = Math.max(0, seconds)
  if (value < 10) return `${value.toFixed(1)}s`
  return `${Math.round(value)}s`
}
