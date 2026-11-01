import * as Sentry from "@sentry/nextjs"
import { trackCall, trackDuration, trackError } from "./stats"

// Availability history for the public Photon geocoder (photon.komoot.io),
// which has no status page of its own. Every Photon call site reports here:
//   - Upstash stats (source "photon"): calls, errors, latency per hour,
//     visible in /api/stats.
//   - GlitchTip: a warning per failure, throttled per instance — the suggest
//     route fires on every keystroke, so an outage would otherwise flood it.
//
// Never call this from ISR-rendered code: trackCall does an uncached Upstash
// fetch (see __tests__/lib/seo-search.test.ts).

export type PhotonCaller = "suggest" | "public-api" | "health"

const SENTRY_THROTTLE_MS = 5 * 60_000
let lastReportAt = 0

export function recordPhotonSuccess(durationMs: number): void {
  trackCall("photon")
  trackDuration("photon", durationMs)
}

export function recordPhotonFailure(caller: PhotonCaller, error: string, durationMs: number): void {
  trackCall("photon")
  trackError("photon")
  trackDuration("photon", durationMs)
  console.warn(`[photon] ${caller} call failed after ${durationMs} ms: ${error}`)

  const now = Date.now()
  if (now - lastReportAt < SENTRY_THROTTLE_MS) return
  lastReportAt = now
  Sentry.captureMessage(`Photon geocoder failed: ${error}`, {
    level: "warning",
    tags:  { area: "photon", caller },
    extra: { durationMs },
  })
}

/** Test hook: reset the per-instance GlitchTip throttle. */
export function resetPhotonMonitorForTests(): void {
  lastReportAt = 0
}
