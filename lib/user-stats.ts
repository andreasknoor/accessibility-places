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

function dayBefore(day: string): string {
  const d = new Date(day + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// A streak is still "alive" if the user's last search was today or yesterday
// (UTC) — one missed day breaks it. Used at render time to zero out a stale
// curStreak for users who haven't returned since; the stored value itself
// stays frozen until their next search recomputes it.
export function isStreakActive(lastSeen: string | null): boolean {
  if (!lastSeen) return false
  const day = today()
  return lastSeen === day || lastSeen === dayBefore(day)
}

async function trackUserSearchInternal(uid: string, platform: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const userKey = `user:${uid}`
  const day = today()

  // Read-before-write: streak continuation depends on the previous lastSeen,
  // which the unconditional pipeline below is about to overwrite.
  const prev = await redis.hgetall<Record<string, string>>(userKey)
  const prevLastSeen = prev?.lastSeen ?? null
  const prevCur  = Number(prev?.curStreak) || 0
  const prevBest = Number(prev?.bestStreak) || 0

  // Same-day repeat searches don't extend the streak further; a gap of 2+
  // days resets it to 1. Two concurrent first-searches-of-the-day from the
  // same user could double-increment here — accepted as harmless and rare
  // rather than paying for a Lua script's atomicity.
  const curStreak =
    prevLastSeen === day            ? (prevCur || 1) :
    prevLastSeen === dayBefore(day) ? prevCur + 1 :
    1
  const bestStreak = Math.max(prevBest, curStreak)

  await redis.pipeline()
    .zincrby(ZSET_KEY, 1, uid)
    .hsetnx(userKey, "firstSeen", day)
    .hset(userKey, { lastSeen: day, platform, curStreak, bestStreak })
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

// Deletes all user statistics (the cumulative ranking + every per-user hash).
// Separate from resetStats() so the adapter stats and the user stats can be
// cleared independently from the dashboard.
export async function resetUserStats(): Promise<number> {
  const redis = getRedis()
  if (!redis) return 0
  let cursor = 0
  const keys: string[] = [ZSET_KEY]
  do {
    const [nextCursor, batch] = await redis.scan(cursor, { match: "user:*", count: 100 })
    cursor = Number(nextCursor)
    keys.push(...batch)
  } while (cursor !== 0)
  for (let i = 0; i < keys.length; i += 100)
    await redis.del(...keys.slice(i, i + 100))
  return keys.length
}

export const COMMENT_MAX_LENGTH = 200

// Operator-entered free-text note on a user (dashboard comment column). Unlike
// every other stored value it is NOT write-validated to a safe shape — it must
// be HTML-escaped when rendered. Stored in the user hash, so it shares the
// 180-day TTL and is deleted by resetUserStats().
// Returns false when the input is invalid or the user hash no longer exists
// (writing to an expired key would resurrect it without a TTL).
export async function setUserComment(uid: unknown, comment: unknown): Promise<boolean> {
  if (typeof uid !== "string" || !UUID_RE.test(uid)) return false
  if (typeof comment !== "string") return false
  const redis = getRedis()
  if (!redis) return false

  const userKey = `user:${uid}`
  if (!(await redis.exists(userKey))) return false

  const trimmed = comment.trim().slice(0, COMMENT_MAX_LENGTH)
  if (trimmed.length === 0) {
    await redis.hdel(userKey, "comment")
  } else {
    await redis.hset(userKey, { comment: trimmed })
    // Guard the exists→hset race: if the key expired in between, the hset
    // recreated it TTL-less — re-arm the TTL so no key can live forever.
    if ((await redis.ttl(userKey)) === -1) await redis.expire(userKey, TTL_SECONDS)
  }
  return true
}

export interface TopUser {
  uid:        string
  searches:   number
  firstSeen:  string | null
  lastSeen:   string | null
  platform:   string | null
  comment:    string | null
  curStreak:  number
  bestStreak: number
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
      uid:        c.uid,
      searches:   c.searches,
      firstSeen:  h.firstSeen ?? null,
      lastSeen:   h.lastSeen ?? null,
      platform:   h.platform ?? null,
      comment:    h.comment ?? null,
      curStreak:  Number(h.curStreak) || 0,
      bestStreak: Number(h.bestStreak) || 0,
    })
  })

  if (expired.length > 0) {
    redis.zrem(ZSET_KEY, ...expired).catch(() => {/* prune retry next read */})
  }
  return users.slice(0, limit)
}
