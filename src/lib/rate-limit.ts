/**
 * Fixed-window rate limiter, in process memory.
 *
 * Scope, stated plainly: this is per Node process. It survives HMR (the map
 * hangs off globalThis) but not a restart, and it does not coordinate across
 * instances — two app servers mean two independent budgets. That is adequate
 * for the single-instance deployment this runs on, and the honest fix when
 * that changes is a shared store (Redis), not a bigger map.
 *
 * What it does buy, today, is the thing that matters most: a password endpoint
 * that cannot be dictionary-attacked at full speed from one source.
 */

interface Window {
  count: number
  resetAt: number
}

const globalForRateLimit = globalThis as unknown as { rateLimitBuckets?: Map<string, Window> }
const buckets: Map<string, Window> = globalForRateLimit.rateLimitBuckets ?? new Map()
globalForRateLimit.rateLimitBuckets = buckets

export interface RateLimitResult {
  ok: boolean
  /** Seconds until the window resets. Suitable for a Retry-After header. */
  retryAfter: number
  remaining: number
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    // Opportunistic sweep: without it the map grows once per distinct key
    // forever, which on an IP-keyed limiter is an unbounded leak.
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
    }
    return { ok: true, retryAfter: 0, remaining: limit - 1 }
  }

  existing.count += 1
  const retryAfter = Math.ceil((existing.resetAt - now) / 1000)
  return existing.count > limit
    ? { ok: false, retryAfter, remaining: 0 }
    : { ok: true, retryAfter, remaining: limit - existing.count }
}

/**
 * Best-effort client address. Behind a proxy the socket address is the proxy,
 * so the forwarded headers are what carry the real client — they are also
 * client-controlled, which is why this limiter is a speed bump on credential
 * stuffing and not an access control.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0].trim()
  return req.headers.get("x-real-ip")?.trim() || "unknown"
}
