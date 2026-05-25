"use client"

import { useState, useEffect } from "react"

const QUERY = "(pointer: coarse), (max-width: 767px)"

// Synchronous read in the initialiser avoids the desktop-then-mobile remount that
// would otherwise throw away ChatPanel state restored from localStorage on first paint.
// SSR returns false (the desktop default) — the inevitable one-frame mismatch is preferable
// to a full subtree swap after mount.
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(QUERY).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    if (mq.matches !== isMobile) setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return isMobile
}
