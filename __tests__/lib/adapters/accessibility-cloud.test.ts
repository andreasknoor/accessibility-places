import { describe, it, expect, vi, beforeEach } from "vitest"
import { localStr, fetchAccessibilityCloud } from "@/lib/adapters/accessibility-cloud"
import type { SearchParams } from "@/lib/types"

const BASE_PARAMS: SearchParams = {
  query: "restaurants",
  location: { lat: 52.52, lon: 13.405 },
  radiusKm: 5,
  categories: ["restaurant"],
  filters: { entrance: true, toilet: true, parking: true, seating: false, acceptUnknown: false },
  sources: { accessibility_cloud: true, osm: true, reisen_fuer_alle: true, google_places: true },
}

// ─── localStr ────────────────────────────────────────────────────────────────

describe("localStr", () => {
  it("returns plain string unchanged", () => {
    expect(localStr("Berlin")).toBe("Berlin")
  })

  it("extracts de from LocalizedString", () => {
    expect(localStr({ de: "Berlin", en: "Berlin" })).toBe("Berlin")
  })

  it("falls back to en when de absent", () => {
    expect(localStr({ en: "Vienna" })).toBe("Vienna")
  })

  it("falls back to first value when neither de nor en", () => {
    expect(localStr({ fr: "Paris" })).toBe("Paris")
  })

  it("returns empty string for null", () => {
    expect(localStr(null)).toBe("")
  })

  it("returns empty string for undefined", () => {
    expect(localStr(undefined)).toBe("")
  })

  it("returns empty string for empty object", () => {
    expect(localStr({})).toBe("")
  })

  it("converts number to string", () => {
    expect(localStr(42)).toBe("42")
  })
})

// ─── fetchAccessibilityCloud ─────────────────────────────────────────────────

describe("fetchAccessibilityCloud", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv("ACCESSIBILITY_CLOUD_API_KEY", "test-token")
  })

  it("returns empty array when API key is missing", async () => {
    vi.stubEnv("ACCESSIBILITY_CLOUD_API_KEY", "")
    const result = await fetchAccessibilityCloud(BASE_PARAMS)
    expect(result).toEqual([])
  })

  it("returns empty array when API returns no features", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [] }),
    }))
    const result = await fetchAccessibilityCloud(BASE_PARAMS)
    expect(result).toEqual([])
  })

  it("throws on non-200 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    await expect(fetchAccessibilityCloud(BASE_PARAMS)).rejects.toThrow("accessibility.cloud error: 401")
  })

  it("parses a fully accessible place with LocalizedString name", async () => {
    const feature = {
      _id: "abc123",
      geometry: { type: "Point", coordinates: [13.405, 52.52] },
      properties: {
        name: { de: "Café Barrier-Free", en: "Café Barrier-Free" },
        category: "restaurant",
        address: {
          street:      { de: "Hauptstraße" },
          housenumber: "12",
          postalCode:  "10115",
          city:        { de: "Berlin" },
          country:     "DE",
        },
        accessibility: {
          accessibleWith: { wheelchair: true },
          restrooms: [{
            isAccessibleWithWheelchair: true,
            grabBars: { onUsersLeftSide: true, onUsersRightSide: true, foldable: true },
          }],
          parking: { forWheelchairUsers: { isAvailable: true } },
        },
      },
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [feature] }),
    }))

    const result = await fetchAccessibilityCloud(BASE_PARAMS)
    expect(result).toHaveLength(1)
    const place = result[0]
    expect(place.name).toBe("Café Barrier-Free")
    expect(place.address.city).toBe("Berlin")
    expect(place.address.street).toBe("Hauptstraße")
    expect(place.accessibility.entrance.value).toBe("yes")
    expect(place.accessibility.toilet.value).toBe("yes")
    expect(place.accessibility.parking.value).toBe("yes")
  })

  it("maps partiallyAccessibleWith.wheelchair → limited for entrance", async () => {
    const feature = {
      _id: "xyz",
      geometry: { type: "Point", coordinates: [13.0, 52.0] },
      properties: {
        name: "Limited Place",
        category: "restaurant",
        address: {},
        accessibility: { partiallyAccessibleWith: { wheelchair: true } },
      },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [feature] }),
    }))
    const result = await fetchAccessibilityCloud(BASE_PARAMS)
    expect(result[0].accessibility.entrance.value).toBe("limited")
  })

  it("skips features without a name", async () => {
    const feature = {
      _id: "no-name",
      geometry: { type: "Point", coordinates: [13.0, 52.0] },
      properties: { name: "", category: "restaurant", address: {} },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [feature] }),
    }))
    const result = await fetchAccessibilityCloud(BASE_PARAMS)
    expect(result).toHaveLength(0)
  })

  it("captures wheelmapUrl when infoPageUrl points to wheelmap.org", async () => {
    const feature = {
      _id: "wm1",
      geometry: { type: "Point", coordinates: [13.0, 52.0] },
      properties: {
        name: "Wheelmap Place",
        category: "restaurant",
        address: {},
        infoPageUrl: "https://wheelmap.org/nodes/12345",
        accessibility: { accessibleWith: { wheelchair: true } },
      },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [feature] }),
    }))
    const [p] = await fetchAccessibilityCloud(BASE_PARAMS)
    expect(p.wheelmapUrl).toBe("https://wheelmap.org/nodes/12345")
  })

  it("captures allowsDogs and flags supplementary-only records", async () => {
    const feature = {
      _id: "pp1",
      geometry: { type: "Point", coordinates: [13.0, 52.0] },
      properties: {
        name: "Pfotenpiloten Cafe",
        category: "cafe",
        address: {},
        accessibility: { animalPolicy: { allowsDogs: true } },
      },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [feature] }),
    }))
    const [p] = await fetchAccessibilityCloud(BASE_PARAMS)
    expect(p.allowsDogs).toBe(true)
    expect(p.dogPolicyOnly).toBe(true)
  })

  it("does NOT flag dogPolicyOnly when wheelchair data is present alongside animalPolicy", async () => {
    const feature = {
      _id: "wm-dogs",
      geometry: { type: "Point", coordinates: [13.0, 52.0] },
      properties: {
        name: "Cafe Both",
        category: "cafe",
        address: {},
        accessibility: {
          accessibleWith: { wheelchair: true },
          animalPolicy:   { allowsDogs: true },
        },
      },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [feature] }),
    }))
    const [p] = await fetchAccessibilityCloud(BASE_PARAMS)
    expect(p.allowsDogs).toBe(true)
    expect(p.dogPolicyOnly).toBeUndefined()
  })

  it("ignores infoPageUrl from non-wheelmap hosts", async () => {
    const feature = {
      _id: "pp1",
      geometry: { type: "Point", coordinates: [13.0, 52.0] },
      properties: {
        name: "Pfotenpiloten Place",
        category: "restaurant",
        address: {},
        infoPageUrl: "https://map.pfotenpiloten.org/?place_id=42",
        accessibility: { accessibleWith: { wheelchair: true } },
      },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [feature] }),
    }))
    const [p] = await fetchAccessibilityCloud(BASE_PARAMS)
    expect(p.wheelmapUrl).toBeUndefined()
  })

  it("drops records with off-topic categories like government_office", async () => {
    const features = [
      {
        _id: "office", geometry: { type: "Point", coordinates: [13.0, 52.0] },
        properties: { name: "Bürgerbüro", category: "government_office", address: {} },
      },
      {
        _id: "atm", geometry: { type: "Point", coordinates: [13.0, 52.0] },
        properties: { name: "Sparkasse ATM", category: "atm", address: {} },
      },
      {
        _id: "stop", geometry: { type: "Point", coordinates: [13.0, 52.0] },
        properties: { name: "Hauptstraße", category: "bus_stop", address: {} },
      },
      {
        _id: "real", geometry: { type: "Point", coordinates: [13.0, 52.0] },
        properties: { name: "Café Wagner", category: "cafe", address: {} },
      },
    ]
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features }) }))
    const result = await fetchAccessibilityCloud(BASE_PARAMS)
    expect(result.map((p) => p.name)).toEqual(["Café Wagner"])
  })

  it("keeps records with attraction-like categories", async () => {
    const feature = {
      _id: "zoo1",
      geometry: { type: "Point", coordinates: [13.0, 52.0] },
      properties: { name: "Tierpark", category: "zoo", address: {} },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [feature] }) }))
    const [p] = await fetchAccessibilityCloud(BASE_PARAMS)
    expect(p.category).toBe("attraction")
  })

  it("handles toilet details with grab bars", async () => {
    const feature = {
      _id: "t1",
      geometry: { type: "Point", coordinates: [13.0, 52.0] },
      properties: {
        name: "Place With Toilet",
        category: "restaurant",
        address: {},
        accessibility: {
          restrooms: [{
            isAccessibleWithWheelchair: true,
            grabBars: {
              onUsersLeftSide: true,
              onUsersRightSide: true,
              foldable: false,
              topHeightFromFloor: { value: 85 },
            },
            turningSpaceInside: { width: { value: 150 } },
            entrance: { door: { width: { value: 90 } } },
            hasEmergencyPullstring: true,
          }],
        },
      },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ features: [feature] }),
    }))
    const result = await fetchAccessibilityCloud(BASE_PARAMS)
    const td = result[0].accessibility.toilet.details as Record<string, unknown>
    expect(td.hasGrabBars).toBe(true)
    expect(td.grabBarsOnBothSides).toBe(true)
    expect(td.turningRadiusCm).toBe(150)
    expect(td.doorWidthCm).toBe(90)
    expect(td.hasEmergencyPullstring).toBe(true)
  })
})
