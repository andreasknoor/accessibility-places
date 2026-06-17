"use client"

import { useState, useEffect, useLayoutEffect } from "react"

// Full-screen overlay shown on every app start — mobile/touch only.
// On native (Capacitor): the 600 ms native splash hands off to this overlay
// seamlessly — both use a white background, no visible gap.
// On web/PWA: visible for 2.7 s total (2.2 s animation + 0.5 s fade-out).
// Desktop: never shown (useLayoutEffect check before first paint, no hydration mismatch).
export default function SplashOverlay() {
  const [show,  setShow]  = useState(false)
  const [phase, setPhase] = useState<"visible" | "fading" | "gone">("visible")

  // Synchronous check before first paint — no flash, no hydration mismatch.
  // SSR and initial client render both produce nothing (show=false); mobile
  // devices flip show=true before the browser paints the first frame.
  useLayoutEffect(() => {
    if (window.innerWidth < 768 || window.matchMedia("(pointer: coarse)").matches) {
      setShow(true)
    }
  }, [])

  useEffect(() => {
    if (!show) return

    // Tell the native Capacitor splash to hide as soon as our overlay is ready.
    // Dynamic import keeps @capacitor/splash-screen out of the web bundle's
    // critical path and avoids SSR issues.
    import("@capacitor/splash-screen")
      .then(({ SplashScreen }) => SplashScreen.hide())
      .catch(() => {}) // no-op in browser / PWA

    const fadeTimer = setTimeout(() => setPhase("fading"), 2200)
    const doneTimer = setTimeout(() => setPhase("gone"),   2700)
    return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer) }
  }, [show])

  if (!show || phase === "gone") return null

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-background transition-opacity duration-500 ${
        phase === "fading" ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      aria-hidden
    >
      <div className="flex flex-col items-center gap-4">
        <p className="text-2xl font-bold tracking-tight text-foreground">Accessible Places</p>
        <img
          src="/icons/icon-preview.svg"
          className="w-20 h-20 rounded-2xl animate-wheelchair-once"
          alt=""
        />
      </div>
    </div>
  )
}
