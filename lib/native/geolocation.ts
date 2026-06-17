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
      maximumAge:         opts?.maximumAge ?? 60_000,
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

export interface BestPositionOptions {
  /** Max time to wait for the FIRST fix before giving up. Default 20 s. */
  timeout?: number
  /** Keep refining for this long after the first fix arrives. Default 4 s. */
  windowMs?: number
  /** Resolve immediately once a fix is at least this accurate (metres). Default 50. */
  desiredAccuracyM?: number
}

// Robust single-shot location: a plain getCurrentPosition often returns the first
// (coarse, network-derived or last-known) fix, which lands "next to" the real
// position. Instead, watch briefly and keep the most accurate fix seen within a
// short window — resolving early once a fix is good enough. Always maximumAge:0 +
// highAccuracy so we never reuse a stale fix.
export async function getBestPosition(opts?: BestPositionOptions): Promise<GeoPosition> {
  const timeout          = opts?.timeout ?? 20_000
  const windowMs         = opts?.windowMs ?? 4_000
  const desiredAccuracyM = opts?.desiredAccuracyM ?? 50

  if (Capacitor.isNativePlatform()) {
    const { Geolocation } = await import("@capacitor/geolocation")
    let perm = await Geolocation.checkPermissions()
    if (perm.location === "prompt" || perm.location === "prompt-with-rationale") {
      perm = await Geolocation.requestPermissions()
    }
    if (perm.location !== "granted") {
      throw new GeolocationPermissionError("location-permission-denied")
    }

    return new Promise<GeoPosition>((resolve, reject) => {
      let best: { lat: number; lon: number; acc: number } | null = null
      let watchId: string | null = null
      let settled = false
      let windowTimer: ReturnType<typeof setTimeout> | null = null
      const firstFixTimer = setTimeout(() => { if (!best) finish(new Error("location-timeout")) }, timeout)

      function finish(err?: unknown) {
        if (settled) return
        settled = true
        clearTimeout(firstFixTimer)
        if (windowTimer) clearTimeout(windowTimer)
        if (watchId !== null) Geolocation.clearWatch({ id: watchId }).catch(() => {})
        if (best) resolve({ lat: best.lat, lon: best.lon })
        else reject(err ?? new Error("no-position"))
      }

      Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout, maximumAge: 0 },
        (pos, err) => {
          if (err) { if (!best) finish(err); return }
          if (!pos) return
          const acc = pos.coords.accuracy ?? Number.POSITIVE_INFINITY
          if (!best || acc < best.acc) best = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc }
          if (acc <= desiredAccuracyM) { finish(); return }
          if (windowTimer === null) windowTimer = setTimeout(() => finish(), windowMs)
        },
      ).then((id) => {
        watchId = id
        // If we already settled before the id resolved, clear it now.
        if (settled) Geolocation.clearWatch({ id }).catch(() => {})
      }).catch((e) => { if (!best) finish(e) })
    })
  }

  // Web
  return new Promise<GeoPosition>((resolve, reject) => {
    if (!("geolocation" in navigator)) { reject(new Error("no-geolocation")); return }
    let best: { lat: number; lon: number; acc: number } | null = null
    let settled = false
    let windowTimer: ReturnType<typeof setTimeout> | null = null
    const firstFixTimer = setTimeout(() => { if (!best) finish(new Error("location-timeout")) }, timeout)

    function finish(err?: unknown) {
      if (settled) return
      settled = true
      clearTimeout(firstFixTimer)
      if (windowTimer) clearTimeout(windowTimer)
      navigator.geolocation.clearWatch(id)
      if (best) resolve({ lat: best.lat, lon: best.lon })
      else reject(err ?? new Error("no-position"))
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = pos.coords.accuracy ?? Number.POSITIVE_INFINITY
        if (!best || acc < best.acc) best = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc }
        if (acc <= desiredAccuracyM) { finish(); return }
        if (windowTimer === null) windowTimer = setTimeout(() => finish(), windowMs)
      },
      (err) => { if (!best) finish(err) },
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    )
  })
}

// A watch id that works across both backends: native returns a string,
// the browser returns a number.
export type GeoWatchId = number | string

// Native-aware watchPosition. On the Capacitor app the native plugin is used —
// since the permission was already granted by getCurrentPosition/getBestPosition,
// this does NOT trigger a second OS dialog. In a browser, navigator.geolocation
// is used. Returns a Promise so both backends share one call shape; the resolved
// id must be passed to clearWatchPosition() to stop tracking.
export async function watchPosition(
  onPosition: (pos: GeoPosition) => void,
  onError?: (err: unknown) => void,
  opts?: GeoOptions,
): Promise<GeoWatchId> {
  if (Capacitor.isNativePlatform()) {
    const { Geolocation } = await import("@capacitor/geolocation")
    return Geolocation.watchPosition(
      {
        enableHighAccuracy: opts?.enableHighAccuracy ?? true,
        timeout:            opts?.timeout,
        maximumAge:         opts?.maximumAge ?? 30_000,
      },
      (pos, err) => {
        if (err) { onError?.(err); return }
        if (pos) onPosition({ lat: pos.coords.latitude, lon: pos.coords.longitude })
      },
    )
  }

  return navigator.geolocation.watchPosition(
    (pos) => onPosition({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
    (err) => onError?.(err),
    {
      enableHighAccuracy: opts?.enableHighAccuracy ?? true,
      maximumAge:         opts?.maximumAge ?? 30_000,
    },
  )
}

export function clearWatchPosition(id: GeoWatchId): void {
  if (typeof id === "string") {
    // Native watch id — clear via the plugin (dynamic import, fire-and-forget).
    import("@capacitor/geolocation")
      .then(({ Geolocation }) => Geolocation.clearWatch({ id }))
      .catch(() => {})
    return
  }
  navigator.geolocation.clearWatch(id)
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
