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

/**
 * Drop-in replacement for @vercel/analytics' `track` that always attaches the
 * `platform` dimension. Import `track` from here instead of from the Vercel
 * package so every custom event is filterable by native platform.
 */
export function track(event: string, props?: Props): void {
  vercelTrack(event, { ...props, platform: platform() })
}
