"use client"

// Anonymous user identity for the top-users statistic (docs/plans/top-users-stats.md).
// The ID is a random UUID — deliberately NOT derived from device properties
// (that would be fingerprinting). It carries zero information about the person;
// recognition works only as long as the user keeps their localStorage.
//
// `ap_search_count` is a purely local counter incremented alongside the server
// stat, so a future questionnaire can trigger client-side ("after N searches")
// without any server roundtrip.

const UID_KEY   = "ap_uid"
const COUNT_KEY = "ap_search_count"

// Returns the stable anonymous ID, creating it on first call. Returns null when
// the usageStats setting is off (caller passes it in) or storage is unavailable.
export function getUserId(enabled: boolean): string | null {
  if (!enabled || typeof window === "undefined") return null
  try {
    const existing = localStorage.getItem(UID_KEY)
    if (existing) return existing
    const uid = crypto.randomUUID()
    localStorage.setItem(UID_KEY, uid)
    return uid
  } catch {
    return null
  }
}

// Opt-out: forget the identity and the local counter. A new ID is only created
// again if the user re-enables the setting and searches.
export function clearUserStats(): void {
  try {
    localStorage.removeItem(UID_KEY)
    localStorage.removeItem(COUNT_KEY)
  } catch { /* ignore */ }
}

export function incrementLocalSearchCount(): number {
  try {
    const next = (parseInt(localStorage.getItem(COUNT_KEY) ?? "0", 10) || 0) + 1
    localStorage.setItem(COUNT_KEY, String(next))
    return next
  } catch {
    return 0
  }
}

export function getLocalSearchCount(): number {
  try {
    return parseInt(localStorage.getItem(COUNT_KEY) ?? "0", 10) || 0
  } catch {
    return 0
  }
}
