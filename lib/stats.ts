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

export function getRedis(): Redis | null {
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

// Track response time using per-hour sorted sets.
// min key: ZADD LT — new score replaces existing only when lower (running minimum).
// max key: ZADD GT — new score replaces existing only when higher (running maximum).
// sum/cnt keys: simple INCRBY/INCR for computing the average across all hours.
// LT/GT without NX adds the member on first write, then conditionally updates — no race.
async function trackDurationInternal(source: SourceId, ms: number): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const hour   = currentHour()
  const sumKey = `stats:h:dur:sum:${source}:${hour}`
  const cntKey = `stats:h:dur:cnt:${source}:${hour}`
  const minKey = `stats:h:dur:min:${source}:${hour}`
  const maxKey = `stats:h:dur:max:${source}:${hour}`
  await redis.pipeline()
    .incrby(sumKey, ms).expire(sumKey, TTL_SECONDS)
    .incr(cntKey).expire(cntKey, TTL_SECONDS)
    .zadd(minKey, { lt: true }, { score: ms, member: "v" }).expire(minKey, TTL_SECONDS)
    .zadd(maxKey, { gt: true }, { score: ms, member: "v" }).expire(maxKey, TTL_SECONDS)
    .exec()
}

export function trackDuration(source: SourceId, ms: number): void {
  trackDurationInternal(source, ms).catch(() => {/* non-fatal */})
}

// ─── Stats read ──────────────────────────────────────────────────────────────

export interface SourceStats {
  totalCalls:        number
  totalErrors:       number
  avgCallsPerHour:   number
  avgErrorsPerHour:  number
  hours:             number
  minMs:             number | null
  maxMs:             number | null
  avgMs:             number | null
}

export type StatsResult = Partial<Record<SourceId, SourceStats>>

const ALL_SOURCES: SourceId[] = [
  "osm", "osm_private", "osm_public",
  "accessibility_cloud", "reisen_fuer_alle", "ginto", "google_places",
  "osm_parking", "osm_parking_private", "osm_parking_public", "nominatim",
]

async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  let cursor = 0
  const keys: string[] = []
  do {
    const [nextCursor, batch] = await redis.scan(cursor, { match: pattern, count: 100 })
    cursor = Number(nextCursor)
    keys.push(...batch)
  } while (cursor !== 0)
  return keys
}

async function sumHourKeys(redis: Redis, prefix: "calls" | "errors", source: SourceId): Promise<{ total: number; hours: number; oldestHour: string | null }> {
  const keys = await scanKeys(redis, `stats:h:${prefix}:${source}:*`)
  if (keys.length === 0) return { total: 0, hours: 0, oldestHour: null }
  const values = await redis.mget<(number | null)[]>(...keys)
  const total = values.reduce<number>((sum, v) => sum + (Number(v) || 0), 0)
  // Key tail is always YYYY-MM-DDTHH (13 chars); lexicographic min = oldest hour.
  const oldestHour = keys.map(k => k.slice(-13)).sort()[0] ?? null
  return { total, hours: keys.length, oldestHour }
}

async function getDurationStats(
  redis: Redis,
  source: SourceId,
): Promise<{ minMs: number | null; maxMs: number | null; avgMs: number | null }> {
  const [sumKeys, cntKeys, minKeys, maxKeys] = await Promise.all([
    scanKeys(redis, `stats:h:dur:sum:${source}:*`),
    scanKeys(redis, `stats:h:dur:cnt:${source}:*`),
    scanKeys(redis, `stats:h:dur:min:${source}:*`),
    scanKeys(redis, `stats:h:dur:max:${source}:*`),
  ])
  if (sumKeys.length === 0 && cntKeys.length === 0) return { minMs: null, maxMs: null, avgMs: null }
  const [sumVals, cntVals, minScores, maxScores] = await Promise.all([
    sumKeys.length > 0 ? redis.mget<(number | null)[]>(...sumKeys) : Promise.resolve([] as (number | null)[]),
    cntKeys.length > 0 ? redis.mget<(number | null)[]>(...cntKeys) : Promise.resolve([] as (number | null)[]),
    Promise.all(minKeys.map(k => redis.zscore(k, "v"))),
    Promise.all(maxKeys.map(k => redis.zscore(k, "v"))),
  ])
  const totalSum = sumVals.reduce<number>((s, v) => s + (Number(v) || 0), 0)
  const totalCnt = cntVals.reduce<number>((s, v) => s + (Number(v) || 0), 0)
  const validMin = minScores.filter((s): s is number => s !== null)
  const validMax = maxScores.filter((s): s is number => s !== null)
  return {
    minMs: validMin.length > 0 ? Math.round(Math.min(...validMin)) : null,
    maxMs: validMax.length > 0 ? Math.round(Math.max(...validMax)) : null,
    avgMs: totalCnt > 0 ? Math.round(totalSum / totalCnt) : null,
  }
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
    const [calls, errors, duration] = await Promise.all([
      sumHourKeys(redis, "calls",  source),
      sumHourKeys(redis, "errors", source),
      getDurationStats(redis, source),
    ])
    if (calls.total === 0 && errors.total === 0) return
    const hours = Math.max(calls.hours, errors.hours) || 1
    sources[source] = {
      totalCalls:       calls.total,
      totalErrors:      errors.total,
      avgCallsPerHour:  Math.round((calls.total  / hours) * 10) / 10,
      avgErrorsPerHour: Math.round((errors.total / hours) * 10) / 10,
      hours,
      minMs: duration.minMs,
      maxMs: duration.maxMs,
      avgMs: duration.avgMs,
    }
    if (calls.oldestHour)  oldestHours.push(calls.oldestHour)
    if (errors.oldestHour) oldestHours.push(errors.oldestHour)
  }))

  const oldestHour = oldestHours.length > 0 ? oldestHours.sort()[0] : null
  return { sources, oldestHour }
}
