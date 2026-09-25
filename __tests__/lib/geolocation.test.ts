import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockIsNativePlatform = vi.fn()
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mockIsNativePlatform() } }))

const mockCheckPermissions = vi.fn()
vi.mock("@capacitor/geolocation", () => ({ Geolocation: { checkPermissions: () => mockCheckPermissions() } }))

import { hasLocationPermission, getCurrentPositionWithFallback } from "@/lib/native/geolocation"

// hasLocationPermission is the silent gate for SimpleLayout's background
// location prefetch (v10.58) — it must NEVER trigger the OS/browser
// permission prompt itself (that stays getBestPosition's job, fired only on
// an actual user tap), so these tests specifically guard against it starting
// to call requestPermissions/anything prompt-shaped.
describe("hasLocationPermission", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe("native", () => {
    beforeEach(() => {
      mockIsNativePlatform.mockReturnValue(true)
      mockCheckPermissions.mockReset()
    })

    it("returns true when the OS permission is already granted", async () => {
      mockCheckPermissions.mockResolvedValue({ location: "granted" })
      expect(await hasLocationPermission()).toBe(true)
    })

    it("returns false when the permission is still unresolved (prompt)", async () => {
      mockCheckPermissions.mockResolvedValue({ location: "prompt" })
      expect(await hasLocationPermission()).toBe(false)
    })

    it("returns false when the permission was denied", async () => {
      mockCheckPermissions.mockResolvedValue({ location: "denied" })
      expect(await hasLocationPermission()).toBe(false)
    })

    it("returns false rather than throwing if the native check itself fails", async () => {
      mockCheckPermissions.mockRejectedValue(new Error("plugin unavailable"))
      expect(await hasLocationPermission()).toBe(false)
    })
  })

  describe("web", () => {
    beforeEach(() => {
      mockIsNativePlatform.mockReturnValue(false)
    })

    it("returns true when the Permissions API reports granted", async () => {
      const query = vi.fn().mockResolvedValue({ state: "granted" })
      vi.stubGlobal("navigator", { permissions: { query } })
      expect(await hasLocationPermission()).toBe(true)
      expect(query).toHaveBeenCalledWith({ name: "geolocation" })
    })

    it("returns false when the Permissions API reports prompt", async () => {
      vi.stubGlobal("navigator", { permissions: { query: vi.fn().mockResolvedValue({ state: "prompt" }) } })
      expect(await hasLocationPermission()).toBe(false)
    })

    it("returns false when the Permissions API is unavailable (older Safari), without throwing", async () => {
      vi.stubGlobal("navigator", {})
      expect(await hasLocationPermission()).toBe(false)
    })

    it("returns false if the Permissions API call itself rejects", async () => {
      vi.stubGlobal("navigator", { permissions: { query: vi.fn().mockRejectedValue(new Error("not supported")) } })
      expect(await hasLocationPermission()).toBe(false)
    })
  })
})

// Desktop network-based location (macOS via Wi-Fi) intermittently times out
// with no fix at all — the ChatPanel locate paths must retry once with a
// cached position instead of failing straight away.
describe("getCurrentPositionWithFallback (web)", () => {
  const pos = (lat: number, lon: number) => ({ coords: { latitude: lat, longitude: lon } })
  beforeEach(() => {
    mockIsNativePlatform.mockReturnValue(false)
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("returns the first fix without a second request", async () => {
    const getCurrentPosition = vi.fn((ok: (p: unknown) => void, _err?: unknown, _opts?: PositionOptions) => ok(pos(52.5, 13.4)))
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } })
    expect(await getCurrentPositionWithFallback()).toEqual({ lat: 52.5, lon: 13.4 })
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({ timeout: 15_000 })
  })

  it("retries once accepting a 10-minute-old position after a timeout", async () => {
    const getCurrentPosition = vi.fn()
      .mockImplementationOnce((_ok: unknown, err: (e: unknown) => void) => err({ code: 3, message: "Timeout expired" }))
      .mockImplementationOnce((ok: (p: unknown) => void) => ok(pos(48.1, 11.6)))
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } })
    expect(await getCurrentPositionWithFallback()).toEqual({ lat: 48.1, lon: 11.6 })
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
    expect(getCurrentPosition.mock.calls[1][2]).toMatchObject({ maximumAge: 600_000 })
  })

  it("does not retry when permission was denied", async () => {
    const getCurrentPosition = vi.fn((_ok: unknown, err: (e: unknown) => void) => err({ code: 1, message: "User denied" }))
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } })
    await expect(getCurrentPositionWithFallback()).rejects.toMatchObject({ code: 1 })
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
  })

  it("rejects with the fallback's error when both attempts fail", async () => {
    const getCurrentPosition = vi.fn()
      .mockImplementationOnce((_ok: unknown, err: (e: unknown) => void) => err({ code: 3 }))
      .mockImplementationOnce((_ok: unknown, err: (e: unknown) => void) => err({ code: 2 }))
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } })
    await expect(getCurrentPositionWithFallback()).rejects.toMatchObject({ code: 2 })
  })
})
