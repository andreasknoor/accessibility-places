"use client"

// Null-rendering client component mounted once in the root layout.
// Handles native-only initialisation that must run after hydration:
//   - Hardware back button: navigate web history, exit only at the root.
// Dynamic import keeps @capacitor/app out of the browser bundle's critical path.

import { useEffect } from "react"
import { Capacitor } from "@capacitor/core"

export default function CapacitorInit() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cleanup: (() => void) | undefined

    import("@capacitor/app").then(({ App }) => {
      const handle = App.addListener("backButton", () => {
        if (window.history.length > 1) {
          window.history.back()
        } else {
          App.exitApp()
        }
      })
      cleanup = () => { handle.then((h) => h.remove()) }
    })

    return () => cleanup?.()
  }, [])

  return null
}
