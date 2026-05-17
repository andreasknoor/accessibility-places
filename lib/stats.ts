import { Redis } from "@upstash/redis"
import type { SourceId } from "./types"

// TTL for per-hour keys: 90 days.
// Keys use the prefix "stats:h:" to stay separate from the legacy per-day keys
// ("stats:calls:…") which still exist in Redis and expire on their own schedule.
// Mixing both sets under one scan pattern would corrupt averages.
const TTL_SECONDS = 90 * 24 * 60 * 60

function currentHour(): string {
  return new Date().toISOString().slice(0, 13) // YYYY-MM-DDTHH
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
  const key = `stats:h:${prefix}:${source}:${currentHour()}`
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
  totalCalls:        number
  totalErrors:       number
  avgCallsPerHour:   number
  avgErrorsPerHour:  number
  hours:             number
}

export type StatsResult = Partial<Record<SourceId, SourceStats>>

const ALL_SOURCES: SourceId[] = [
  "osm", "accessibility_cloud", "reisen_fuer_alle", "ginto", "google_places",
]

async function sumHourKeys(redis: Redis, prefix: "calls" | "errors", source: SourceId): Promise<{ total: number; hours: number; oldestHour: string | null }> {
  const pattern = `stats:h:${prefix}:${source}:*`
  let cursor = 0
  const keys: string[] = []
  do {
    const [nextCursor, batch] = await redis.scan(cursor, { match: pattern, count: 100 })
    cursor = Number(nextCursor)
    keys.push(...batch)
  } while (cursor !== 0)

  if (keys.length === 0) return { total: 0, hours: 0, oldestHour: null }
  const values = await redis.mget<(number | null)[]>(...keys)
  const total = values.reduce<number>((sum, v) => sum + (Number(v) || 0), 0)
  // Key tail is always YYYY-MM-DDTHH (13 chars); lexicographic min = oldest hour.
  const oldestHour = keys.map(k => k.slice(-13)).sort()[0] ?? null
  return { total, hours: keys.length, oldestHour }
}

export async function resetStats(): Promise<number> {
  const redis = getRedis()
  if (!redis) return 0
  let cursor = 0
  const keys: string[] = []
  do {
    const [nextCursor, batch] = await redis.scan(cursor, { match: "stats:h:*", count: 100 })
    cursor = Number(nextCursor)
    keys.push(...batch)
  } while (cursor !== 0)
  if (keys.length === 0) return 0
  for (let i = 0; i < keys.length; i += 100)
    await redis.del(...keys.slice(i, i + 100))
  return keys.length
}

export interface StatsResponse {
  sources:    StatsResult
  oldestHour: string | null  // YYYY-MM-DDTHH of the oldest key across all sources
}

export async function getStats(): Promise<StatsResponse> {
  const redis = getRedis()
  if (!redis) return { sources: {}, oldestHour: null }

  const sources: StatsResult = {}
  const oldestHours: string[] = []

  await Promise.all(ALL_SOURCES.map(async (source) => {
    const [calls, errors] = await Promise.all([
      sumHourKeys(redis, "calls",  source),
      sumHourKeys(redis, "errors", source),
    ])
    if (calls.total === 0 && errors.total === 0) return
    const hours = Math.max(calls.hours, errors.hours) || 1
    sources[source] = {
      totalCalls:       calls.total,
      totalErrors:      errors.total,
      avgCallsPerHour:  Math.round((calls.total  / hours) * 10) / 10,
      avgErrorsPerHour: Math.round((errors.total / hours) * 10) / 10,
      hours,
    }
    if (calls.oldestHour)  oldestHours.push(calls.oldestHour)
    if (errors.oldestHour) oldestHours.push(errors.oldestHour)
  }))

  const oldestHour = oldestHours.length > 0 ? oldestHours.sort()[0] : null
  return { sources, oldestHour }
}
