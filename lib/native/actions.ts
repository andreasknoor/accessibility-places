"use client"

import { Capacitor } from "@capacitor/core"

export type NativeAction = "parking" | "toilet"

/**
 * Reads and clears the pending native action stored by AppDelegate
 * (UIApplicationShortcutItem handler). Returns null when not on native
 * or when no action is pending.
 */
export async function consumePendingNativeAction(): Promise<NativeAction | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const { Preferences } = await import("@capacitor/preferences")
    const { value } = await Preferences.get({ key: "ap_pending_native_action" })
    if (value === "parking" || value === "toilet") {
      await Preferences.remove({ key: "ap_pending_native_action" })
      return value
    }
  } catch {
    // Plugin unavailable — no-op
  }
  return null
}
