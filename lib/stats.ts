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

// ─── Write path: coalesced, one Lua EVAL per source and hour ─────────────────
//
// Upstash's free tier meters *commands*, and the old write path spent 2 per
// counter (INCR + EXPIRE) and 8 per duration sample — ~70 commands for one
// ordinary search, ~97% of all Redis traffic. Two changes bring that to ~10:
//
//  1. Everything one source records in the same tick (trackCall + trackDuration
//     [+ trackError]) is coalesced in `pending` and flushed in a microtask.
//  2. The flush is a single EVAL that applies all counters and duration samples
//     at once, instead of a pipeline with one command per INCR/EXPIRE/ZADD.
//
// The key layout is unchanged (`stats:h:{calls|errors}:<src>:<hour>`,
// `stats:h:dur:{sum|cnt|min|max}:<src>:<hour>`), so getStats() and old data are
// unaffected. min/max keep their sorted-set form (ZADD LT / GT, member "v").
// An EVAL is counted by Upstash as one command (same as the rate limiter's).

interface PendingStats { calls: number; errors: number; durations: number[] }
const pending = new Map<string, PendingStats>()

const TRACK_SCRIPT = `
local ttl = tonumber(ARGV[1])
local calls = tonumber(ARGV[2])
local errors = tonumber(ARGV[3])
if calls > 0 then
  redis.call('INCRBY', KEYS[1], calls)
  redis.call('EXPIRE', KEYS[1], ttl)
end
if errors > 0 then
  redis.call('INCRBY', KEYS[2], errors)
  redis.call('EXPIRE', KEYS[2], ttl)
end
if #ARGV >= 4 then
  local sum, n = 0, 0
  local mn, mx = nil, nil
  for i = 4, #ARGV do
    local v = tonumber(ARGV[i])
    sum = sum + v
    n = n + 1
    if mn == nil or v < mn then mn = v end
    if mx == nil or v > mx then mx = v end
  end
  redis.call('INCRBY', KEYS[3], sum)
  redis.call('EXPIRE', KEYS[3], ttl)
  redis.call('INCRBY', KEYS[4], n)
  redis.call('EXPIRE', KEYS[4], ttl)
  redis.call('ZADD', KEYS[5], 'LT', mn, 'v')
  redis.call('EXPIRE', KEYS[5], ttl)
  redis.call('ZADD', KEYS[6], 'GT', mx, 'v')
  redis.call('EXPIRE', KEYS[6], ttl)
end
return 1
`

async function flushOne(redis: Redis, source: SourceId, hour: string, p: PendingStats): Promise<void> {
  const keys = [
    `stats:h:calls:${source}:${hour}`,
    `stats:h:errors:${source}:${hour}`,
    `stats:h:dur:sum:${source}:${hour}`,
    `stats:h:dur:cnt:${source}:${hour}`,
    `stats:h:dur:min:${source}:${hour}`,
    `stats:h:dur:max:${source}:${hour}`,
  ]
  await redis.eval(TRACK_SCRIPT, keys, [TTL_SECONDS, p.calls, p.errors, ...p.durations])
}

function flushPending(): void {
  const redis = getRedis()
  const batch = [...pending.entries()]
  pending.clear()
  if (!redis) return
  for (const [id, p] of batch) {
    const sep = id.indexOf("|")
    flushOne(redis, id.slice(0, sep) as SourceId, id.slice(sep + 1), p)
      .catch(() => {/* non-fatal */})
  }
}

function record(source: SourceId, patch: { call?: boolean; error?: boolean; ms?: number }): void {
  if (!getRedis()) return
  const id = `${source}|${currentHour()}`
  let p = pending.get(id)
  if (!p) {
    if (pending.size === 0) queueMicrotask(flushPending)
    p = { calls: 0, errors: 0, durations: [] }
    pending.set(id, p)
  }
  if (patch.call)  p.calls++
  if (patch.error) p.errors++
  if (patch.ms !== undefined) p.durations.push(Math.round(patch.ms))
}

export function trackCall(source: SourceId): void {
  record(source, { call: true })
}

export function trackError(source: SourceId): void {
  record(source, { error: true })
}

export function trackDuration(source: SourceId, ms: number): void {
  record(source, { ms })
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
  "search_total", "search_total_allcats", "search_total_filtered", "search_total_quickstart", "search_total_expert",
  "osm", "osm_private", "osm_public",
  "accessibility_cloud", "reisen_fuer_alle", "ginto", "google_places",
  "osm_parking", "osm_parking_private", "osm_parking_public", "nominatim", "photon",
]

// Upstash's SCAN cursor is an unsigned 64-bit integer serialised as a string —
// far beyond Number.MAX_SAFE_INTEGER (2^53). `Number(nextCursor)` silently
// rounds it, so the following scan() call resumes from a corrupted cursor the
// server has never handed out, which it treats as "no more keys" and returns
// batch:0/cursor:0 — verified live: this truncated `stats:h:*` from 16,145 real
// keys down to 1,000, and `stats:h:calls:accessibility_cloud:*` from 595 down
// to 100, deflating call totals far more than error totals (fewer keys, less
// likely to hit a large cursor) and inflating every derived error rate (17%
// apparent vs. 2.4% actual). Fix: keep the cursor as a string throughout.
export async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  let cursor = "0"
  const keys: string[] = []
  do {
    const [nextCursor, batch] = await redis.scan(cursor, { match: pattern, count: 500 })
    cursor = String(nextCursor)
    keys.push(...batch)
  } while (cursor !== "0")
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
  const keys = await scanKeys(redis, "stats:h:*")
  if (keys.length === 0) return 0
  for (let i = 0; i < keys.length; i += 100)
    await redis.del(...keys.slice(i, i + 100))
  return keys.length
}

// Clears only the "time to visible results" pseudo-sources (search_total and
// its two segments), independently of the per-adapter table `resetStats()`
// wipes. `stats:h:*` above already covers these keys too — this is a
// narrower reset for when only this section's numbers need a clean slate
// (e.g. right after a latency-affecting deploy) without losing the
// unrelated per-adapter history.
export async function resetSearchTotalStats(): Promise<number> {
  const redis = getRedis()
  if (!redis) return 0
  const patterns = ["stats:h:*:search_total:*", "stats:h:*:search_total_allcats:*", "stats:h:*:search_total_filtered:*", "stats:h:*:search_total_quickstart:*", "stats:h:*:search_total_expert:*"]
  let total = 0
  for (const pattern of patterns) {
    const keys = await scanKeys(redis, pattern)
    for (let i = 0; i < keys.length; i += 100)
      await redis.del(...keys.slice(i, i + 100))
    total += keys.length
  }
  return total
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
