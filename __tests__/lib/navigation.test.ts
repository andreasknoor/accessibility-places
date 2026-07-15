import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetPlatform = vi.fn<() => string>()
vi.mock("@/lib/analytics", () => ({ getPlatform: () => mockGetPlatform() }))

import {
  universalMapsUrl,
  navAppUrl,
  startDefaultNavigation,
  startNavigationWithApp,
  shouldShowChooser,
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
    // Returns a truthy stub window by default (the "popup succeeded" case) —
    // individual tests override this to simulate a blocked popup.
    vi.stubGlobal("open", vi.fn(() => ({}) as Window))
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

  it("does NOT also navigate the current tab when window.open succeeds on an ordinary desktop/mobile browser (regression: window.open('noopener') always returns null, so a return-value check previously fired on every call)", () => {
    mockGetPlatform.mockReturnValue("web")
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })))
    const setHref = vi.fn()
    Object.defineProperty(window, "location", {
      value: { ...window.location, set href(v: string) { setHref(v) } },
      writable: true,
    })
    startDefaultNavigation(coords)
    expect(window.open).toHaveBeenCalledWith(
      "https://www.google.com/maps/dir/?api=1&destination=52.52,13.405",
      "_blank",
      "noopener,noreferrer",
    )
    expect(setHref).not.toHaveBeenCalled()
  })

  it("routes straight to a same-tab navigation (skipping window.open entirely) when running as an installed standalone PWA", () => {
    mockGetPlatform.mockReturnValue("web")
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })))
    const openSpy = vi.fn(() => ({}) as Window)
    vi.stubGlobal("open", openSpy)
    const setHref = vi.fn()
    Object.defineProperty(window, "location", {
      value: { ...window.location, set href(v: string) { setHref(v) } },
      writable: true,
    })
    startDefaultNavigation(coords)
    expect(setHref).toHaveBeenCalledWith("https://www.google.com/maps/dir/?api=1&destination=52.52,13.405")
    expect(openSpy).not.toHaveBeenCalled()
  })

  it("also detects standalone mode via the legacy iOS navigator.standalone flag", () => {
    mockGetPlatform.mockReturnValue("web")
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })))
    Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true })
    const setHref = vi.fn()
    Object.defineProperty(window, "location", {
      value: { ...window.location, set href(v: string) { setHref(v) } },
      writable: true,
    })
    startDefaultNavigation(coords)
    expect(setHref).toHaveBeenCalledWith("https://www.google.com/maps/dir/?api=1&destination=52.52,13.405")
    // @ts-expect-error cleanup only, not part of the Navigator type
    delete window.navigator.standalone
  })
})

describe("shouldShowChooser", () => {
  it("is true only for android", () => {
    expect(shouldShowChooser("android")).toBe(true)
    expect(shouldShowChooser("ios")).toBe(false)
    expect(shouldShowChooser("web")).toBe(false)
  })

  it("defaults to reading the current platform when called with no argument", () => {
    mockGetPlatform.mockReturnValue("android")
    expect(shouldShowChooser()).toBe(true)
    mockGetPlatform.mockReturnValue("ios")
    expect(shouldShowChooser()).toBe(false)
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
