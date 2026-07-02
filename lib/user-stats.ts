import { getRedis } from "./stats"

// Anonymous per-user search counters for the top-users dashboard section
// (docs/plans/top-users-stats.md). Stored per user: random client-generated
// UUID, search count, first/last seen (day granularity), platform. No IP, no
// query strings, no coordinates.
//
// Redis layout:
//   users:by_searches   ZSET   score = total searches, member = uid
//   user:<uid>          HASH   firstSeen / lastSeen (YYYY-MM-DD), platform
//
// The per-user hash expires 180 days after the last search. The sorted set is
// cumulative and cannot carry per-member TTLs, so getTopUsers() lazily prunes
// members whose hash has expired — the set stays bounded without a cron.

const TTL_SECONDS = 180 * 24 * 60 * 60
const ZSET_KEY    = "users:by_searches"

// Strict validation — these values are attacker-controlled request input and
// end up in the HTML dashboard; anything not matching is dropped silently.
const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PLATFORMS = new Set(["ios", "android", "web"])

function today(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

async function trackUserSearchInternal(uid: string, platform: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const userKey = `user:${uid}`
  await redis.pipeline()
    .zincrby(ZSET_KEY, 1, uid)
    .hsetnx(userKey, "firstSeen", today())
    .hset(userKey, { lastSeen: today(), platform })
    .expire(userKey, TTL_SECONDS)
    .exec()
}

// Fire-and-forget, same contract as trackCall()/trackError(): never throws,
// never awaited by the caller. Call ONLY from route handlers (/api/search,
// /api/nearby-parking) — never from fetchAllSources, so SEO ISR renders and
// bulk validity checks can never count as users.
export function trackUserSearch(uid: unknown, platform: unknown): void {
  if (typeof uid !== "string" || !UUID_RE.test(uid)) return
  if (typeof platform !== "string" || !PLATFORMS.has(platform)) return
  trackUserSearchInternal(uid, platform).catch(() => {/* non-fatal */})
}

export interface TopUser {
  uid:       string
  searches:  number
  firstSeen: string | null
  lastSeen:  string | null
  platform:  string | null
}

export async function getTopUsers(limit = 20): Promise<TopUser[]> {
  const redis = getRedis()
  if (!redis) return []

  // Over-fetch a little so lazy pruning of expired members still fills the top-N.
  const raw = await redis.zrange<(string | number)[]>(ZSET_KEY, 0, limit * 2 - 1, {
    rev: true,
    withScores: true,
  })

  const candidates: { uid: string; searches: number }[] = []
  for (let i = 0; i + 1 < raw.length; i += 2) {
    candidates.push({ uid: String(raw[i]), searches: Number(raw[i + 1]) || 0 })
  }
  if (candidates.length === 0) return []

  const hashes = await Promise.all(
    candidates.map((c) => redis.hgetall<Record<string, string>>(`user:${c.uid}`)),
  )

  const users: TopUser[] = []
  const expired: string[] = []
  candidates.forEach((c, i) => {
    const h = hashes[i]
    if (!h || Object.keys(h).length === 0) {
      expired.push(c.uid)  // hash TTL'd out — prune from the cumulative set
      return
    }
    users.push({
      uid:       c.uid,
      searches:  c.searches,
      firstSeen: h.firstSeen ?? null,
      lastSeen:  h.lastSeen ?? null,
      platform:  h.platform ?? null,
    })
  })

  if (expired.length > 0) {
    redis.zrem(ZSET_KEY, ...expired).catch(() => {/* prune retry next read */})
  }
  return users.slice(0, limit)
}
