"use client"

import { Capacitor } from "@capacitor/core"
import { APP_VERSION } from "@/lib/config"

const PROMPTED_VERSION_KEY = "ap_review_prompt_version"

/**
 * Requests the OS-native in-app review dialog (Play In-App Review / iOS
 * SKStoreReviewController) at most once per APP_VERSION, so a qualifying
 * search doesn't re-ask on every visit. Both platforms already rate-limit
 * the dialog themselves (iOS: max ~3/year; Play Core: server-side quota) —
 * this guard exists to avoid spamming the *request* itself, not to work
 * around a missing limit. No-op on web (no equivalent surface there).
 */
export async function maybeRequestReview(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Preferences } = await import("@capacitor/preferences")
    const { value } = await Preferences.get({ key: PROMPTED_VERSION_KEY })
    if (value === APP_VERSION) return
    await Preferences.set({ key: PROMPTED_VERSION_KEY, value: APP_VERSION })

    const { InAppReview } = await import("@capacitor-community/in-app-review")
    await InAppReview.requestReview()
  } catch {
    // Plugin unavailable or the OS declined to show it — no-op either way.
  }
}
