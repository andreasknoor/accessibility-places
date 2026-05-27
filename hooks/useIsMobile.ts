"use client"

import { useSyncExternalStore } from "react"

const QUERY = "(pointer: coarse), (max-width: 767px)"

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia(QUERY)
  mq.addEventListener("change", cb)
  return () => mq.removeEventListener("change", cb)
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches
}

// Server snapshot is always false (desktop). When the client snapshot differs
// (mobile viewport), React reconciles without throwing a hydration error —
// useSyncExternalStore is the React-endorsed pattern for this.
function getServerSnapshot(): boolean {
  return false
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
