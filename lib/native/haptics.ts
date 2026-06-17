"use client"

// Native-aware haptic feedback. In the Capacitor app the @capacitor/haptics
// plugin fires the Taptic Engine (iOS) / vibration motor (Android). In a browser
// it is a no-op (iOS Safari has no haptics API; we deliberately do NOT fall back
// to navigator.vibrate, which is unsupported on iOS and buzzy on Android).
//
// All helpers are fire-and-forget and never throw — a missing plugin or an
// unsupported platform must never break the calling interaction.

import { Capacitor } from "@capacitor/core"

async function run(fn: (h: typeof import("@capacitor/haptics")) => Promise<void>): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const mod = await import("@capacitor/haptics")
    await fn(mod)
  } catch {
    // plugin missing (old build) or platform error — ignore
  }
}

/** Light tap — for ordinary button presses. */
export function hapticLight(): void {
  void run(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }))
}

/** Medium tap — for more significant actions (e.g. triggering a search). */
export function hapticMedium(): void {
  void run(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Medium }))
}

/** Success notification — for completed actions (e.g. link copied / shared). */
export function hapticSuccess(): void {
  void run(({ Haptics, NotificationType }) => Haptics.notification({ type: NotificationType.Success }))
}

/** Error notification — for failed actions. */
export function hapticError(): void {
  void run(({ Haptics, NotificationType }) => Haptics.notification({ type: NotificationType.Error }))
}
