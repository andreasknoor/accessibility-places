"use client"

// Native-aware geolocation helper. In the Capacitor app (isNativePlatform()=true)
// the native @capacitor/geolocation plugin is used — it shows the OS permission
// dialog and has higher accuracy than the browser API. In a normal browser the
// standard navigator.geolocation is used unchanged.
//
// watchPosition is deliberately not wrapped here: it uses navigator.geolocation
// directly in ChatPanel and is foreground-only (correct for our use case).
// True background location would require a separate foreground service —
// see docs/capacitor-android-setup.md Appendix A.

import { Capacitor } from "@capacitor/core"

export interface GeoPosition {
  lat: number
  lon: number
}

export interface GeoOptions {
  timeout?: number
  enableHighAccuracy?: boolean
  maximumAge?: number
}

export async function getCurrentPosition(opts?: GeoOptions): Promise<GeoPosition> {
  if (Capacitor.isNativePlatform()) {
    // Dynamic import keeps the native plugin out of the web bundle's critical path
    const { Geolocation } = await import("@capacitor/geolocation")

    // Check and request permission if needed
    let perm = await Geolocation.checkPermissions()
    if (perm.location === "prompt" || perm.location === "prompt-with-rationale") {
      perm = await Geolocation.requestPermissions()
    }
    if (perm.location !== "granted") {
      throw new GeolocationPermissionError("location-permission-denied")
    }

    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: opts?.enableHighAccuracy ?? true,
      timeout:            opts?.timeout ?? 30_000,
    })
    return { lat: pos.coords.latitude, lon: pos.coords.longitude }
  }

  // Web fallback
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      reject,
      {
        enableHighAccuracy: opts?.enableHighAccuracy ?? false,
        timeout:            opts?.timeout ?? 30_000,
        maximumAge:         opts?.maximumAge ?? 60_000,
      },
    )
  })
}

export class GeolocationPermissionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GeolocationPermissionError"
  }
}

// Convenience check — same as !("geolocation" in navigator) on web,
// but works in the native context too.
export function isGeolocationAvailable(): boolean {
  if (Capacitor.isNativePlatform()) return true
  return "geolocation" in navigator
}
