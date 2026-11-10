/**
 * Central config reader — one place that knows every Worker binding.
 * Everything else takes this object, so tests can pass a fake env.
 */
const RATE_LIMITS = {
  convert: [10, 60],
  prepare: [10, 60],
  preview: [180, 60],
  download: [60, 60],
}

export function readConfig(env = {}) {
  return {
    engineUrl: String(env.ENGINE_URL || '').replace(/\/+$/, ''),
    engineToken: env.ENGINE_TOKEN || '',
    allowedOrigins: String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    jsonTimeoutMs: 20_000,
    healthTimeoutMs: 6_000,
    limits: RATE_LIMITS,
  }
}
