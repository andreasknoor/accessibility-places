"use client"

// Native-aware external-URL opener. In the Capacitor app (isNativePlatform()=true)
// the @capacitor/browser plugin is used, which opens URLs in Chrome Custom Tabs
// (Android) or SFSafariViewController (iOS) — both provide a built-in close button.
// In a regular browser window.open() is used unchanged.
//
// If the plugin is missing (old APK without the plugin installed) the call falls
// back to window.open() gracefully — no crash, just no close button.

import { Capacitor } from "@capacitor/core"

export async function openExternalUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      // Dynamic import keeps the plugin out of the web bundle's critical path
      const { Browser } = await import("@capacitor/browser")
      await Browser.open({ url })
    } catch {
      // Old APK without the plugin, or unexpected error — fall back gracefully
      window.open(url, "_blank", "noopener,noreferrer")
    }
  } else {
    window.open(url, "_blank", "noopener,noreferrer")
  }
}
