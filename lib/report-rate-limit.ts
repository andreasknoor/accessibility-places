import { Ratelimit } from "@upstash/ratelimit"
import { getRedis } from "./stats"
import { isRateLimited as isRateLimitedInMemory } from "./rate-limit"

// Rate limiter for POST /api/report-parking — the only endpoint in the app
// that writes to an external service, opening a GitHub issue with
// GITHUB_REPORT_TOKEN.
//
// It previously used a module-level in-memory Map, i.e. exactly the
// construction lib/search-rate-limit.ts already documents as "worthless as a
// defense": it resets on every serverless cold start and is not shared across
// concurrent instances, so a nominal "5 per minute" was really "5 per
// instance per cold start". /api/search was migrated to Redis for that
// reason; this endpoint was never brought along, even though it is the one
// with an external side effect.
//
// Why it matters more here than on a read path: every issue this creates is
// authored by the token owner's own GitHub account. Abuse of it therefore
// looks like spam sent *by them*, and the consequences (token revocation,
// account flags) are GitHub's to impose and not ours to roll back.
//
// Degradation is deliberately NOT fail-closed, unlike the Google-Places
// limiters. Redis being unavailable is not hypothetical — the Upstash free
// tier ran out of commands once already (issue #54) — and killing the report
// feature outright for that window is a worse trade than falling back to the
// weak-but-still-bounded in-memory limiter. Fail-closed is the right call
// when the protected resource costs money per request; here the protected
// resource is our GitHub reputation, and a degraded bound beats no feature.
const REPORT_MAX_PER_MIN = 5

const redis = getRedis()

const reportLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(REPORT_MAX_PER_MIN, "1 m"),
      prefix:  "rl:report",
    })
  : null

export async function isReportRateLimited(ip: string): Promise<boolean> {
  if (!reportLimiter) return isRateLimitedInMemory("report-parking", ip, REPORT_MAX_PER_MIN)
  try {
    const { success } = await reportLimiter.limit(ip)
    return !success
  } catch {
    return isRateLimitedInMemory("report-parking", ip, REPORT_MAX_PER_MIN)
  }
}
