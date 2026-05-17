import { Redis } from "@upstash/redis"
import type { SourceId } from "./types"

// TTL for per-day keys: 90 days. Totals are computed on-the-fly from day keys
// so there is no separate total counter to reset — old data simply expires.
const TTL_SECONDS = 90 * 24 * 60 * 60

function today(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

// Redis client — lazily instantiated so the module is importable even when
// KV env vars are absent (adapters must not crash when stats are unconfigured).
let _redis: Redis | null | undefined = undefined

function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    _redis = null
    return null
  }
  _redis = new Redis({
    url:   process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  })
  return _redis
}

async function increment(prefix: "calls" | "errors", source: SourceId): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const key = `stats:${prefix}:${source}:${today()}`
  await redis.pipeline().incr(key).expire(key, TTL_SECONDS).exec()
}

export function trackCall(source: SourceId): void {
  increment("calls", source).catch(() => {/* non-fatal */})
}

export function trackError(source: SourceId): void {
  increment("errors", source).catch(() => {/* non-fatal */})
}

// ─── Stats read ──────────────────────────────────────────────────────────────

export interface SourceStats {
  totalCalls:       number
  totalErrors:      number
  avgCallsPerDay:   number
  avgErrorsPerDay:  number
  days:             number
}

export type StatsResult = Partial<Record<SourceId, SourceStats>>

const ALL_SOURCES: SourceId[] = [
  "osm", "accessibility_cloud", "reisen_fuer_alle", "ginto", "google_places",
]

async function sumDayKeys(redis: Redis, prefix: "calls" | "errors", source: SourceId): Promise<{ total: number; days: number }> {
  const pattern = `stats:${prefix}:${source}:*`
  let cursor = 0
  const keys: string[] = []
  do {
    const [nextCursor, batch] = await redis.scan(cursor, { match: pattern, count: 100 })
    cursor = Number(nextCursor)
    keys.push(...batch)
  } while (cursor !== 0)

  if (keys.length === 0) return { total: 0, days: 0 }
  const values = await redis.mget<(number | null)[]>(...keys)
  const total = values.reduce((sum, v) => sum + (Number(v) || 0), 0)
  return { total, days: keys.length }
}

export async function getStats(): Promise<StatsResult> {
  const redis = getRedis()
  if (!redis) return {}

  const result: StatsResult = {}

  await Promise.all(ALL_SOURCES.map(async (source) => {
    const [calls, errors] = await Promise.all([
      sumDayKeys(redis, "calls",  source),
      sumDayKeys(redis, "errors", source),
    ])
    if (calls.total === 0 && errors.total === 0) return
    const days = Math.max(calls.days, errors.days) || 1
    result[source] = {
      totalCalls:      calls.total,
      totalErrors:     errors.total,
      avgCallsPerDay:  Math.round((calls.total  / days) * 10) / 10,
      avgErrorsPerDay: Math.round((errors.total / days) * 10) / 10,
      days,
    }
  }))

  return result
}
