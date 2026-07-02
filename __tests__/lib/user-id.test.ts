import { describe, it, expect, beforeEach } from "vitest"
import { getUserId, clearUserStats, incrementLocalSearchCount, getLocalSearchCount } from "@/lib/user-id"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe("getUserId", () => {
  beforeEach(() => localStorage.clear())

  it("creates a UUID on first call and persists it", () => {
    const uid = getUserId(true)
    expect(uid).toMatch(UUID_RE)
    expect(localStorage.getItem("ap_uid")).toBe(uid)
  })

  it("returns the same ID on subsequent calls", () => {
    const first  = getUserId(true)
    const second = getUserId(true)
    expect(second).toBe(first)
  })

  it("returns null and creates nothing when disabled", () => {
    expect(getUserId(false)).toBeNull()
    expect(localStorage.getItem("ap_uid")).toBeNull()
  })
})

describe("clearUserStats", () => {
  beforeEach(() => localStorage.clear())

  it("removes the ID and the local counter", () => {
    getUserId(true)
    incrementLocalSearchCount()
    clearUserStats()
    expect(localStorage.getItem("ap_uid")).toBeNull()
    expect(localStorage.getItem("ap_search_count")).toBeNull()
  })

  it("a new ID is generated after opt-out and re-enable", () => {
    const before = getUserId(true)
    clearUserStats()
    const after = getUserId(true)
    expect(after).toMatch(UUID_RE)
    expect(after).not.toBe(before)
  })
})

describe("local search counter", () => {
  beforeEach(() => localStorage.clear())

  it("increments from zero", () => {
    expect(getLocalSearchCount()).toBe(0)
    expect(incrementLocalSearchCount()).toBe(1)
    expect(incrementLocalSearchCount()).toBe(2)
    expect(getLocalSearchCount()).toBe(2)
  })

  it("recovers from garbage values", () => {
    localStorage.setItem("ap_search_count", "not-a-number")
    expect(incrementLocalSearchCount()).toBe(1)
  })
})
