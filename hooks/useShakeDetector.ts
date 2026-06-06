"use client"

import { useCallback, useEffect, useRef } from "react"

const PERM_KEY      = "ap_motion_perm"
const THRESHOLD     = 13  // m/s² — firm shake, ignore walking/commuting vibration
const COOLDOWN_MS   = 2500

// Returns a `requestPermission` function that must be called from a user gesture
// (tap/click) on iOS 13+. On Android / desktop the listener attaches immediately.
export function useShakeDetector(onShake: () => void, enabled = true) {
  const onShakeRef   = useRef(onShake)
  const lastShakeRef = useRef(0)
  onShakeRef.current = onShake

  const needsIOSPermission =
    typeof window !== "undefined" &&
    typeof (DeviceMotionEvent as { requestPermission?: unknown }).requestPermission === "function"

  function attachListener() {
    function handleMotion(e: DeviceMotionEvent) {
      const a = e.accelerationIncludingGravity
      if (!a) return
      const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2)
      if (mag < THRESHOLD) return
      const now = Date.now()
      if (now - lastShakeRef.current < COOLDOWN_MS) return
      lastShakeRef.current = now
      onShakeRef.current()
    }
    window.addEventListener("devicemotion", handleMotion)
    return () => window.removeEventListener("devicemotion", handleMotion)
  }

  // Returns true if permission was granted (or not needed)
  const requestPermission = useCallback(async (): Promise<boolean> => {
    const req = (DeviceMotionEvent as { requestPermission?: () => Promise<string> }).requestPermission
    if (typeof req !== "function") return true
    try {
      const result = await req()
      const granted = result === "granted"
      try { localStorage.setItem(PERM_KEY, granted ? "granted" : "denied") } catch { /* ignore */ }
      return granted
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return

    // iOS 13+: only attach if already granted
    if (needsIOSPermission) {
      try {
        const stored = localStorage.getItem(PERM_KEY)
        if (stored === "granted") return attachListener()
      } catch { /* ignore */ }
      return // permission not yet granted — caller handles the request flow
    }

    // Android / desktop: attach directly
    return attachListener()
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  return { needsIOSPermission, requestPermission }
}
