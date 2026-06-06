"use client"

import { useState, useEffect } from "react"

// Full-screen overlay shown on every app start (web + native).
// Plays the wheelchair-roll animation once, then fades out.
// On native (Capacitor): the 600 ms native splash hands off to this overlay
// seamlessly — both use a white background, no visible gap.
// On web/PWA: shows on first page load only (dismissed after 1.8 s total).
export default function SplashOverlay() {
  const [phase, setPhase] = useState<"visible" | "fading" | "gone">("visible")

  useEffect(() => {
    const fadeTimer = setTimeout(() => setPhase("fading"), 1400)
    const doneTimer = setTimeout(() => setPhase("gone"),   1900)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(doneTimer)
    }
  }, [])

  if (phase === "gone") return null

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-background transition-opacity duration-500 ${
        phase === "fading" ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      aria-hidden
    >
      <img
        src="/icons/icon-preview.svg"
        className="w-20 h-20 rounded-2xl animate-wheelchair-splash"
        alt=""
      />
    </div>
  )
}
