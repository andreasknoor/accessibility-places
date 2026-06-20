"use client"

import { track as vercelTrack } from "@vercel/analytics"
import { Capacitor } from "@capacitor/core"

// Vercel Analytics custom-event property shape.
type AllowedValue = string | number | boolean | null
type Props = Record<string, AllowedValue>

// Resolved once. Capacitor.getPlatform() returns "ios" | "android" | "web".
// Crucially "ios"/"android" mean the *native* Capacitor shell — Safari/Chrome and
// the installed PWA both report "web". So a `platform === "ios"` filter isolates
// the native iOS app exactly (and likewise for Android), which is what we want for
// "show me only iOS" segmentation. The WebView is same-origin web traffic, so this
// tagged dimension is the only reliable way any analytics tool can tell platforms
// apart — see docs/analytics for the rationale.
let cached: string | undefined
function platform(): string {
  if (cached === undefined) {
    try { cached = Capacitor.getPlatform() } catch { cached = "web" }
  }
  return cached
}

// Umami's global, injected by the Umami script when NEXT_PUBLIC_UMAMI_WEBSITE_ID
// is set (see components/UmamiScript.tsx). Absent when Umami is not configured or
// the script has not loaded yet — every call is guarded.
type UmamiGlobal = { track: (event: string, data?: Record<string, unknown>) => void }

/**
 * Drop-in replacement for @vercel/analytics' `track` that always attaches the
 * `platform` dimension. Import `track` from here instead of from the Vercel
 * package so every custom event is filterable by native platform.
 *
 * Dual-emit: while Umami runs in parallel for evaluation, the same event +
 * platform dimension is also sent to Umami if its script is present. Both sinks
 * are independent — failure or absence of one never affects the other.
 */
export function track(event: string, props?: Props): void {
  const enriched = { ...props, platform: platform() }
  vercelTrack(event, enriched)
  try {
    const umami = (globalThis as unknown as { umami?: UmamiGlobal }).umami
    umami?.track(event, enriched)
  } catch { /* Umami not loaded / disabled — Vercel still recorded the event */ }
}
