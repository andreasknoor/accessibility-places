// Sliding-window per-IP rate limiter. In-memory, per serverless instance —
// resets on cold start, not safe across multiple concurrent instances.
// Good enough to absorb single-client abuse of paid/quota-bound proxy routes.

import type { NextRequest } from "next/server"

type WindowMap = Map<string, number[]>

const buckets = new Map<string, WindowMap>()
let lastSweep = Date.now()

function getBucket(name: string): WindowMap {
  let m = buckets.get(name)
  if (!m) { m = new Map(); buckets.set(name, m) }
  return m
}

// Opportunistic GC every 5 minutes: drop entries whose timestamps have all aged out.
// Without this, low-traffic IPs that never return leave entries in the Map forever.
function maybeSweep(now: number, windowMs: number) {
  if (now - lastSweep < 5 * 60_000) return
  lastSweep = now
  const cutoff = now - windowMs
  for (const m of buckets.values()) {
    for (const [ip, times] of m) {
      const live = times.filter((t) => t > cutoff)
      if (live.length === 0) m.delete(ip)
      else if (live.length !== times.length) m.set(ip, live)
    }
  }
}

export function ipFromRequest(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown"
}

/**
 * Returns true if the IP has exceeded `max` requests in the last `windowMs`.
 * Each call counts as one request (the timestamp is pushed regardless of the verdict —
 * matches the existing /api/search behaviour).
 */
export function isRateLimited(bucketName: string, ip: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now()
  maybeSweep(now, windowMs)
  const m = getBucket(bucketName)
  const cutoff = now - windowMs
  const times = (m.get(ip) ?? []).filter((t) => t > cutoff)
  times.push(now)
  m.set(ip, times)
  return times.length > max
}

export function rateLimitResponse(): Response {
  return new Response(JSON.stringify({ error: "Too many requests. Please wait a minute." }), {
    status:  429,
    headers: { "Content-Type": "application/json", "Retry-After": "60" },
  })
}
