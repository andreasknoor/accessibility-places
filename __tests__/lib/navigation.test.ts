import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetPlatform = vi.fn<() => string>()
vi.mock("@/lib/analytics", () => ({ getPlatform: () => mockGetPlatform() }))

import {
  universalMapsUrl,
  navAppUrl,
  startDefaultNavigation,
  startNavigationWithApp,
} from "@/lib/native/navigation"

const coords = { lat: 52.52, lon: 13.405 }

describe("universalMapsUrl", () => {
  it("builds Google's documented cross-platform directions URL", () => {
    expect(universalMapsUrl(coords)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=52.52,13.405",
    )
  })
})

describe("navAppUrl", () => {
  it("builds the Android google.navigation: intent URI (driving mode)", () => {
    expect(navAppUrl("google", coords)).toBe("google.navigation:q=52.52,13.405")
  })

  it("builds the Apple Maps maps:// scheme with driving directions flag", () => {
    expect(navAppUrl("apple", coords)).toBe("maps://?daddr=52.52,13.405&dirflg=d")
  })

  it("builds the Android OS-standard geo: URI", () => {
    expect(navAppUrl("geo", coords)).toBe("geo:0,0?q=52.52,13.405")
  })
})

describe("startDefaultNavigation", () => {
  let originalHref: string

  beforeEach(() => {
    originalHref = window.location.href
    vi.stubGlobal("open", vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    // jsdom allows reassigning location.href but not deleting it — restore
    // the pre-test value so later tests in this file aren't affected by a
    // navigation attempt from an earlier one.
    try { window.history.replaceState(null, "", originalHref) } catch { /* ignore */ }
  })

  it("navigates the WebView to the Android google.navigation: scheme", () => {
    mockGetPlatform.mockReturnValue("android")
    const setHref = vi.fn()
    Object.defineProperty(window, "location", {
      value: { ...window.location, set href(v: string) { setHref(v) } },
      writable: true,
    })
    startDefaultNavigation(coords)
    expect(setHref).toHaveBeenCalledWith("google.navigation:q=52.52,13.405")
  })

  it("navigates the WebView to the iOS maps:// scheme", () => {
    mockGetPlatform.mockReturnValue("ios")
    const setHref = vi.fn()
    Object.defineProperty(window, "location", {
      value: { ...window.location, set href(v: string) { setHref(v) } },
      writable: true,
    })
    startDefaultNavigation(coords)
    expect(setHref).toHaveBeenCalledWith("maps://?daddr=52.52,13.405&dirflg=d")
  })

  it("opens the universal Google Maps URL in a new tab on web (desktop or mobile browser)", () => {
    mockGetPlatform.mockReturnValue("web")
    startDefaultNavigation(coords)
    expect(window.open).toHaveBeenCalledWith(
      "https://www.google.com/maps/dir/?api=1&destination=52.52,13.405",
      "_blank",
      "noopener,noreferrer",
    )
  })
})

describe("startNavigationWithApp", () => {
  it("navigates the WebView to the requested app's scheme", () => {
    const setHref = vi.fn()
    Object.defineProperty(window, "location", {
      value: { ...window.location, set href(v: string) { setHref(v) } },
      writable: true,
    })
    startNavigationWithApp("geo", coords)
    expect(setHref).toHaveBeenCalledWith("geo:0,0?q=52.52,13.405")
  })
})
