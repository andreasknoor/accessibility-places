import { Ratelimit } from "@upstash/ratelimit"
import { getRedis } from "./stats"
import * as Sentry from "@sentry/nextjs"

// Redis-backed replacement for the old in-memory per-IP Maps that used to
// live in app/api/search/route.ts. Those reset on every serverless cold
// start and don't share state across concurrent instances — worthless as a
// defense on a public, unauthenticated endpoint fronting metered paid APIs
// (Google Places), where the whole point is to survive exactly that kind of
// abuse pattern (repeated cold starts, many instances, IP rotation).
//
// Same per-IP thresholds as before, now durable:
//   general        30 searches / minute / IP
//   google places   5 searches / minute / IP
//
// NEW: a cross-IP circuit breaker for Google Places specifically. A per-IP
// limit alone does nothing against IP rotation or a botnet — this caps total
// Google-enabled search volume app-wide, regardless of how many distinct IPs
// are involved.
//   global hourly  15 searches / hour  (all IPs combined) — blunts a fast burst
//   global daily   60 searches / day   (all IPs combined) — bounds the worst
//                  full day even if an attacker paces exactly under the
//                  hourly cap continuously
//
// Cost math behind those two numbers (Text Search Enterprise SKU, ≈$0.035 per
// request, up to 9 upstream Google requests per search — 3 categories × 3
// Text Search pages is the worst case; a typical single-category search is
// 1–3 requests):
//   worst case, one hour : 15 × 9 × $0.035 ≈ $4.70
//   worst case, one day  : 60 × 9 × $0.035 ≈ $18.90
// Deliberately generous relative to today's real usage (~0 Google searches/
// day per Upstash telemetry) so legitimate international-mode users are never
// affected — the goal is to flatten a sustained/distributed abuse attempt
// into a bounded, predictable cost curve, not to police normal usage.
// Google Cloud's own per-API daily quota (Console → APIs & Services →
// Quotas) remains the real hard backstop underneath this.
//
// The two families fail in opposite directions on purpose:
//  - the general limiter fails OPEN (allows the request) when Redis is
//    unreachable/unconfigured — an Upstash outage must not take the whole
//    app down over a free, non-cost-bearing concern.
//  - the Google limiters fail CLOSED (treat as rate-limited) when Redis is
//    unreachable/unconfigured — no durable counter means no cost control, so
//    the safer default is to just skip the paid source for that request.
//
// Every Google-specific trip (per-IP, global hourly, global daily) and the
// no-Redis fail-closed case is reported to GlitchTip (Sentry.captureMessage,
// "warning"/"info" — these are expected, by-design events, not bugs) so the
// actual pressure against the Google budget is visible/alertable, not just
// inferred after the fact from a cost spike.

const redis = getRedis()

const generalLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, "1 m"), prefix: "rl:search" })
  : null

const googleIpLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, "1 m"), prefix: "rl:search:gp:ip" })
  : null

const googleGlobalHourlyLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(15, "1 h"), prefix: "rl:search:gp:global:h" })
  : null

const googleGlobalDailyLimiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, "24 h"), prefix: "rl:search:gp:global:d" })
  : null

export async function isRateLimited(ip: string): Promise<boolean> {
  if (!generalLimiter) return false
  try {
    const { success } = await generalLimiter.limit(ip)
    return !success
  } catch {
    return false
  }
}

// GlitchTip reporting for tripped Google-Places limits — these are the
// self-measured thresholds this module enforces (as opposed to Google Cloud's
// own, separately-configured quota, which fails at the HTTP level inside the
// adapter and is already captured there). Reported as "warning", not "error":
// a trip is the mechanism working as designed, not a bug — but the user wants
// visibility into how often/hard it's being hit, since that's a proxy for
// abuse pressure against a metered upstream API.
function reportGoogleLimitHit(scope: "google-ip" | "google-global-hourly" | "google-global-daily", ip: string) {
  Sentry.captureMessage(`Google Places rate limit hit: ${scope}`, {
    level: "warning",
    tags:  { area: "rate-limit", scope, ip },
  })
}

// A durable counter is unavailable (Redis unset/unreachable) — fail-closed
// means Google gets skipped for this request anyway, but this is an infra
// signal distinct from an actual limit trip, so it's tagged and leveled
// separately (worth knowing about, but not "abuse pressure").
function reportGoogleRedisUnavailable(ip: string) {
  Sentry.captureMessage("Google Places skipped: rate limiter unavailable (no Redis)", {
    level: "info",
    tags:  { area: "rate-limit", scope: "google-no-redis", ip },
  })
}

export async function isGooglePlacesRateLimited(ip: string, requested: boolean): Promise<boolean> {
  if (!requested) return false
  if (!googleIpLimiter || !googleGlobalHourlyLimiter || !googleGlobalDailyLimiter) {
    reportGoogleRedisUnavailable(ip)
    return true
  }
  try {
    const perIp = await googleIpLimiter.limit(ip)
    if (!perIp.success) {
      reportGoogleLimitHit("google-ip", ip)
      return true
    }
    // Checked sequentially (not Promise.all) so a request already blocked by
    // the hourly window never consumes a daily-window slot — the daily
    // counter should track only requests that actually had a chance to hit
    // Google, keeping it an accurate reflection of real usage.
    const hourly = await googleGlobalHourlyLimiter.limit("global")
    if (!hourly.success) {
      reportGoogleLimitHit("google-global-hourly", ip)
      return true
    }
    const daily = await googleGlobalDailyLimiter.limit("global")
    if (!daily.success) {
      reportGoogleLimitHit("google-global-daily", ip)
      return true
    }
    return false
  } catch {
    return true
  }
}
