// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest"

// Provide minimal localStorage stub for the node environment
const store: Record<string, string> = {}
const localStorageMock = {
  getItem:    (k: string) => store[k] ?? null,
  setItem:    (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
  clear:      () => { Object.keys(store).forEach((k) => delete store[k]) },
}
;(global as unknown as { window: unknown }).window  = { localStorage: localStorageMock }
;(global as unknown as { localStorage: unknown }).localStorage = localStorageMock

import { loadSettings, DEFAULT_APP_SETTINGS } from "@/lib/settings"
import type { AppSettings } from "@/lib/settings"

const KEY = "ap_settings"

beforeEach(() => {
  localStorageMock.clear()
})

describe("loadSettings", () => {
  it("returns defaults when localStorage is empty", () => {
    expect(loadSettings()).toEqual(DEFAULT_APP_SETTINGS)
  })

  it("merges saved values over defaults", () => {
    const saved: Partial<AppSettings> = { sortOrder: "distance", autoZoom: false }
    localStorageMock.setItem(KEY, JSON.stringify(saved))
    const result = loadSettings()
    expect(result.sortOrder).toBe("distance")
    expect(result.autoZoom).toBe(false)
    // unset keys keep their defaults
    expect(result.defaultSearchMode).toBe(DEFAULT_APP_SETTINGS.defaultSearchMode)
    expect(result.defaultMobileView).toBe(DEFAULT_APP_SETTINGS.defaultMobileView)
  })

  it("falls back to defaults on invalid JSON", () => {
    localStorageMock.setItem(KEY, "not-json{{")
    expect(loadSettings()).toEqual(DEFAULT_APP_SETTINGS)
  })

  it("handles missing keys gracefully (new keys added after save)", () => {
    // Simulate an old save that only has some keys
    localStorageMock.setItem(KEY, JSON.stringify({ sortOrder: "distance" }))
    const result = loadSettings()
    // All default keys must be present
    for (const key of Object.keys(DEFAULT_APP_SETTINGS) as (keyof AppSettings)[]) {
      expect(result).toHaveProperty(key)
    }
  })

  it("roundtrips correctly", () => {
    const custom: AppSettings = {
      defaultSearchMode: "nearby",
      defaultMobileView: "map",
      defaultChipIdx:    3,
      sortOrder:         "distance",
      autoZoom:          false,
      alwaysShowParking: true,
      parkingRadiusKm:   1,
    }
    localStorageMock.setItem(KEY, JSON.stringify(custom))
    expect(loadSettings()).toEqual(custom)
  })

  it("defaultChipIdx null roundtrips correctly", () => {
    localStorageMock.setItem(KEY, JSON.stringify({ defaultChipIdx: null }))
    expect(loadSettings().defaultChipIdx).toBeNull()
  })

  it("defaultSearchMode null roundtrips correctly", () => {
    localStorageMock.setItem(KEY, JSON.stringify({ defaultSearchMode: null }))
    expect(loadSettings().defaultSearchMode).toBeNull()
  })
})
