import { createHash } from "node:crypto"
import type { NextRequest } from "next/server"
import { Ratelimit } from "@upstash/ratelimit"
import { getRedis } from "../stats"
import { ipFromRequest, isRateLimited as isRateLimitedInMemory } from "../rate-limit"
import { API_LICENSE, API_VERSION, RATE_LIMIT_PER_MINUTE } from "./constants"
import type { ApiWarning } from "./pipeline"

// ─── Responses ────────────────────────────────────────────────────────────

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age":       "86400",
}

// Complete answers are cached a day at the CDN (keyed by the full URL, token
// included), so repeated agent runs never reach Overpass. Partial answers
// (warnings) are cached only briefly — one upstream blip must not be pinned
// for 24 h. Errors are never cached.
const CACHE_FULL    = "public, s-maxage=86400, stale-while-revalidate=604800"
const CACHE_PARTIAL = "public, s-maxage=300"

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS })
}

export function apiJson(
  body: Record<string, unknown>,
  opts: { attribution: string[]; warnings?: ApiWarning[] },
): Response {
  const warnings = opts.warnings ?? []
  return Response.json({
    api_version:  API_VERSION,
    license:      API_LICENSE,
    attribution:  opts.attribution,
    generated_at: new Date().toISOString(),
    ...body,
    warnings,
  }, {
    headers: { ...CORS, "Cache-Control": warnings.length ? CACHE_PARTIAL : CACHE_FULL },
  })
}

export function apiError(status: number, code: string, message: string, extra?: Record<string, string>): Response {
  return Response.json({ error: { code, message } }, {
    status,
    headers: { ...CORS, "Cache-Control": "no-store", ...extra },
  })
}

// ─── Access token ─────────────────────────────────────────────────────────
// PUBLIC_API_TOKENS: comma-separated list, so a token can be rotated without
// downtime (add the new one, switch the consumer, remove the old one).
// Deliberately separate from HEALTH_CHECK_SECRET, which also authorises the
// destructive /api/stats DELETE — this token travels in plain URLs.

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function configuredTokens(): string[] {
  return (process.env.PUBLIC_API_TOKENS ?? "").split(",").map((t) => t.trim()).filter((t) => t.length >= 16)
}

// Query parameter ONLY — never a header. The CDN cache key is the URL: a
// header-authenticated response would be cached under a token-less URL and
// then served to anyone requesting that URL without a token.
export function requestToken(req: NextRequest): string {
  return req.nextUrl.searchParams.get("token") ?? ""
}

export function checkToken(req: NextRequest): Response | null {
  const tokens = configuredTokens()
  if (tokens.length === 0) return apiError(503, "not_configured", "The API is not enabled on this deployment.")
  const token = requestToken(req)
  if (!token) return apiError(401, "unauthorized", "Missing access token. Pass ?token=<your token>.")
  // Compare against every configured token (no early exit → no timing hint
  // about which one matched).
  let ok = false
  for (const t of tokens) ok = safeEqual(token, t) || ok
  return ok ? null : apiError(401, "unauthorized", "Invalid access token.")
}

// ─── Rate limit ───────────────────────────────────────────────────────────
// Redis-backed when Upstash is configured (durable across instances), else
// the per-instance in-memory limiter. Fails open like the search route's
// general limiter. The key is a truncated hash of the IP, so Redis never
// holds raw IP addresses; entries expire with the 1-minute window.

const redis = getRedis()
const limiter = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(RATE_LIMIT_PER_MINUTE, "1 m"), prefix: "rl:api:v1" })
  : null

function ipKey(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16)
}

export async function checkRateLimit(req: NextRequest): Promise<Response | null> {
  const key = ipKey(ipFromRequest(req))
  let limited: boolean
  if (limiter) {
    try { limited = !(await limiter.limit(key)).success } catch { limited = false }
  } else {
    limited = isRateLimitedInMemory("api-v1", key, RATE_LIMIT_PER_MINUTE)
  }
  return limited
    ? apiError(429, "rate_limited", `Rate limit exceeded (${RATE_LIMIT_PER_MINUTE} requests/minute).`, { "Retry-After": "60" })
    : null
}

/** Auth + rate limit guard shared by all data endpoints. */
export async function guard(req: NextRequest): Promise<Response | null> {
  return checkToken(req) ?? await checkRateLimit(req)
}
