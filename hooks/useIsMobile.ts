"use client"

import { useState, useLayoutEffect } from "react"

const QUERY = "(pointer: coarse), (max-width: 767px)"

// Initialize to false (SSR-safe default, matches server HTML) to avoid hydration
// mismatch. useLayoutEffect fires synchronously before the first browser paint, so
// the actual media-query value is applied without a visible flash — fixing the iOS
// bottom-nav bug that occurred with a plain useEffect (which fires after paint).
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useLayoutEffect(() => {
    const mq = window.matchMedia(QUERY)
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  return isMobile
}
