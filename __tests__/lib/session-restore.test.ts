import { describe, it, expect, beforeEach } from "vitest"
import {
  markMountAndIsReturning,
  isReturningNow,
  clearReturningFlag,
  saveActiveMode,
  loadActiveMode,
  saveSearchRun,
  loadSearchRun,
  clearSearchRun,
  clearSessionSearch,
  saveNearbyLocation,
  loadNearbyLocation,
  splashAlreadyShownThisSession,
  type SearchRun,
} from "@/lib/session-restore"

beforeEach(() => {
  window.sessionStorage.clear()
})

describe("session-restore — mount / return detection", () => {
  it("first mount is not a return; the next mount is", () => {
    expect(markMountAndIsReturning()).toBe(false) // first home mount this session
    expect(isReturningNow()).toBe(false)
    expect(markMountAndIsReturning()).toBe(true)  // remount = return
    expect(isReturningNow()).toBe(true)
  })

  it("clearReturningFlag makes the one-shot return signal false (for ChatPanel-only remounts)", () => {
    markMountAndIsReturning() // first mount, sets session
    markMountAndIsReturning() // return → returning now "1"
    expect(isReturningNow()).toBe(true)
    clearReturningFlag()
    expect(isReturningNow()).toBe(false)
  })
})

describe("session-restore — active mode", () => {
  it("round-trips text/nearby and rejects junk", () => {
    expect(loadActiveMode()).toBeNull()
    saveActiveMode("text")
    expect(loadActiveMode()).toBe("text")
    saveActiveMode("nearby")
    expect(loadActiveMode()).toBe("nearby")
    window.sessionStorage.setItem("ap_active_mode", "garbage")
    expect(loadActiveMode()).toBeNull()
  })
})

describe("session-restore — search run", () => {
  const run: SearchRun = {
    chatMode: "text", query: "Cafés in Berlin", coords: null, nameHint: null, placeSearch: false,
  }

  it("round-trips a search run", () => {
    expect(loadSearchRun()).toBeNull()
    saveSearchRun(run)
    expect(loadSearchRun()).toEqual(run)
  })

  it("round-trips a place search with coords", () => {
    const placeRun: SearchRun = {
      chatMode: "text", query: "", coords: { lat: 52.5, lon: 13.4 }, nameHint: "Vapiano", placeSearch: true,
    }
    saveSearchRun(placeRun)
    expect(loadSearchRun()).toEqual(placeRun)
  })

  it("returns null on malformed JSON", () => {
    window.sessionStorage.setItem("ap_last_search_run", "{not json")
    expect(loadSearchRun()).toBeNull()
  })

  it("clearSearchRun drops the run but keeps the mode", () => {
    saveActiveMode("nearby")
    saveSearchRun(run)
    clearSearchRun()
    expect(loadSearchRun()).toBeNull()
    expect(loadActiveMode()).toBe("nearby")
  })

  it("clearSessionSearch drops mode, run and nearby location", () => {
    saveActiveMode("nearby")
    saveSearchRun(run)
    saveNearbyLocation({ district: "Berlin Mitte", lat: 52.5, lon: 13.4 })
    clearSessionSearch()
    expect(loadSearchRun()).toBeNull()
    expect(loadActiveMode()).toBeNull()
    expect(loadNearbyLocation()).toBeNull()
  })
})

describe("session-restore — nearby location", () => {
  it("round-trips the located district + coords", () => {
    expect(loadNearbyLocation()).toBeNull()
    saveNearbyLocation({ district: "Wien Landstraße", lat: 48.2, lon: 16.4 })
    expect(loadNearbyLocation()).toEqual({ district: "Wien Landstraße", lat: 48.2, lon: 16.4 })
  })

  it("survives a mode switch (clearSearchRun keeps it)", () => {
    saveNearbyLocation({ district: "X", lat: 1, lon: 2 })
    clearSearchRun()
    expect(loadNearbyLocation()).toEqual({ district: "X", lat: 1, lon: 2 })
  })
})

describe("session-restore — splash once per session", () => {
  it("first call false (and shows), subsequent calls true", () => {
    expect(splashAlreadyShownThisSession()).toBe(false)
    expect(splashAlreadyShownThisSession()).toBe(true)
    expect(splashAlreadyShownThisSession()).toBe(true)
  })
})
