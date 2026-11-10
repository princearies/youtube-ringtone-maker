/**
 * Distributed-ish rate limiting.
 *
 * With a KV binding the counter is shared across isolates (best effort: KV is
 * eventually consistent and this is get+put, not an atomic increment).
 * Without KV it degrades to a per-isolate Map, which is still enough to stop a
 * single client hammering the engine from one location.
 */
const buckets = new Map()

function sweep(now) {
  if (buckets.size < 5000) return
  for (const [key, entry] of buckets) {
    if (entry.resetAt < now) buckets.delete(key)
  }
}

export async function checkRateLimit(env, key, limit, windowSec) {
  const now = Date.now()
  const windowMs = windowSec * 1000
  const windowStart = Math.floor(now / windowMs)
  const bucketKey = `${key}:${windowStart}`

  if (env.RATE) {
    try {
      const raw = await env.RATE.get(bucketKey)
      const used = raw ? Number.parseInt(raw, 10) || 0 : 0
      if (used >= limit) return { ok: false, remaining: 0, retryAfter: Math.ceil((windowMs - (now % windowMs)) / 1000) }
      await env.RATE.put(bucketKey, String(used + 1), { expirationTtl: windowSec + 5 })
      return { ok: true, remaining: Math.max(0, limit - used - 1), retryAfter: 0 }
    } catch {
      // KV failure must not take the product down.
    }
  }

  sweep(now)
  const existing = buckets.get(bucketKey)
  if (!existing || existing.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: (windowStart + 1) * windowMs })
    return { ok: true, remaining: limit - 1, retryAfter: 0 }
  }
  if (existing.count >= limit) {
    return { ok: false, remaining: 0, retryAfter: Math.ceil((existing.resetAt - now) / 1000) }
  }
  existing.count += 1
  return { ok: true, remaining: limit - existing.count, retryAfter: 0 }
}
