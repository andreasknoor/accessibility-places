import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockIsNativePlatform = vi.fn()
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mockIsNativePlatform() } }))

const mockCheckPermissions = vi.fn()
vi.mock("@capacitor/geolocation", () => ({ Geolocation: { checkPermissions: () => mockCheckPermissions() } }))

import { hasLocationPermission } from "@/lib/native/geolocation"

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
