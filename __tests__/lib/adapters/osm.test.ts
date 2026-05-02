import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  buildOverpassQuery,
  osmWheelchair,
  osmToilet,
  osmParking,
  osmAllowsDogs,
  osmDiet,
  fetchOsm,
  isRecentlyVerified,
} from "@/lib/adapters/osm"
import type { SearchParams } from "@/lib/types"

const BASE_PARAMS: SearchParams = {
  query: "restaurants in Berlin",
  location: { lat: 52.52, lon: 13.405 },
  radiusKm: 5,
  categories: ["restaurant"],
  filters: { entrance: true, toilet: true, parking: true, seating: false, onlyVerified: false, acceptUnknown: false },
  sources: { accessibility_cloud: true, osm: true, reisen_fuer_alle: true, google_places: true },
}

// ─── buildOverpassQuery ───────────────────────────────────────────────────────

describe("buildOverpassQuery", () => {
  it("returns empty string when no categories match", () => {
    const params = { ...BASE_PARAMS, categories: [] as never[] }
    expect(buildOverpassQuery(params as unknown as SearchParams)).toBe("")
  })

  it("includes radius in metres", () => {
    const q = buildOverpassQuery(BASE_PARAMS)
    expect(q).toContain("5000")
  })

  it("includes coordinates", () => {
    const q = buildOverpassQuery(BASE_PARAMS)
    expect(q).toContain("52.52")
    expect(q).toContain("13.405")
  })

  it("uses regex filter for amenity values", () => {
    const q = buildOverpassQuery(BASE_PARAMS)
    expect(q).toContain("amenity~")
    expect(q).toContain("restaurant")
  })

  it("includes tourism filter for hotel category", () => {
    const q = buildOverpassQuery({ ...BASE_PARAMS, categories: ["hotel"] })
    expect(q).toContain("tourism~")
    expect(q).toContain("hotel")
  })

  it("includes tourism filter for museum category", () => {
    const q = buildOverpassQuery({ ...BASE_PARAMS, categories: ["museum"] })
    expect(q).toContain("tourism~")
    expect(q).toContain("museum")
  })

  it("includes amenity filter for theater category", () => {
    const q = buildOverpassQuery({ ...BASE_PARAMS, categories: ["theater"] })
    expect(q).toContain("amenity~")
    expect(q).toContain("theatre")
  })

  it("includes both amenity and tourism for gallery", () => {
    const q = buildOverpassQuery({ ...BASE_PARAMS, categories: ["gallery"] })
    expect(q).toContain("gallery")
    expect(q).toContain("arts_centre")
  })

  it("deduplicates overlapping tag values across categories", () => {
    const q = buildOverpassQuery({ ...BASE_PARAMS, categories: ["cafe", "restaurant", "hotel"] })
    // Should be a single amenity filter, not multiple
    const amenityMatches = q.match(/amenity~/g) ?? []
    expect(amenityMatches).toHaveLength(1)
  })

  it("produces valid Overpass QL structure", () => {
    const q = buildOverpassQuery(BASE_PARAMS)
    expect(q).toMatch(/^\[out:json\]/)
    expect(q).toContain("out")
    expect(q).toContain("center")
    expect(q).toContain("tags")
  })

  it("adds wheelchair pre-filter when accessibility filters active and acceptUnknown=false", () => {
    const q = buildOverpassQuery(BASE_PARAMS)
    expect(q).toContain(`wheelchair~"^(yes|limited|designated)$"`)
  })

  it("omits wheelchair pre-filter when acceptUnknown=true", () => {
    const q = buildOverpassQuery({ ...BASE_PARAMS, filters: { ...BASE_PARAMS.filters, acceptUnknown: true } })
    expect(q).not.toContain("wheelchair~")
  })

  it("omits wheelchair pre-filter when all accessibility filters are inactive", () => {
    const noFilters = { entrance: false, toilet: false, parking: false, seating: false, acceptUnknown: false, onlyVerified: false }
    const q = buildOverpassQuery({ ...BASE_PARAMS, filters: noFilters })
    expect(q).not.toContain("wheelchair~")
  })

  it("adds [~^check_date~] regex-on-key clause when onlyVerified is true", () => {
    const q = buildOverpassQuery({
      ...BASE_PARAMS,
      filters: { ...BASE_PARAMS.filters, onlyVerified: true },
    })
    expect(q).toContain(`[~"^check_date"~"."]`)
  })

  it("omits the check_date clause when onlyVerified is false", () => {
    const q = buildOverpassQuery({
      ...BASE_PARAMS,
      filters: { ...BASE_PARAMS.filters, onlyVerified: false },
    })
    expect(q).not.toContain("check_date")
  })
})

// ─── osmWheelchair ────────────────────────────────────────────────────────────

describe("osmWheelchair", () => {
  it.each([
    [{ wheelchair: "yes" },        "yes"],
    [{ wheelchair: "designated" }, "yes"],
    [{ wheelchair: "limited" },    "limited"],
    [{ wheelchair: "no" },         "no"],
    [{ wheelchair: "unknown" },    "unknown"],
    [{},                           "unknown"],
  ])("maps %o → %s", (tags, expected) => {
    expect(osmWheelchair(tags as Record<string, string>)).toBe(expected)
  })
})

// ─── osmToilet ────────────────────────────────────────────────────────────────

describe("osmToilet", () => {
  it.each([
    [{ "toilets:wheelchair": "yes" },        "yes"],
    [{ "toilets:wheelchair": "designated" }, "yes"],
    [{ "toilets:wheelchair": "limited" },    "limited"],
    [{ "toilets:wheelchair": "no" },         "no"],
    [{},                                     "unknown"],
  ])("maps %o → %s", (tags, expected) => {
    expect(osmToilet(tags as Record<string, string>)).toBe(expected)
  })
})

// ─── osmAllowsDogs ────────────────────────────────────────────────────────────

describe("osmAllowsDogs", () => {
  it.each([
    [{ dog: "yes" },     true],
    [{ dog: "leashed" }, true],
    [{ dog: "outside" }, false],   // outdoor-only doesn't help inside seating
    [{ dog: "no" },      false],
    [{ dogs: "yes" },    true],     // tolerate plural variant
    [{ dog: "unknown" }, undefined],
    [{},                 undefined],
  ])("maps %o → %s", (tags, expected) => {
    expect(osmAllowsDogs(tags as Record<string, string>)).toBe(expected)
  })

  it("OSM element with dog=yes → place.allowsDogs=true", async () => {
    const element = {
      id: 555, type: "node", lat: 52.52, lon: 13.405,
      tags: { name: "Hundefreundliches Café", amenity: "cafe", dog: "yes" },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [element] }) }))
    const [p] = await fetchOsm(BASE_PARAMS)
    expect(p.allowsDogs).toBe(true)
  })
})

// ─── osmDiet ──────────────────────────────────────────────────────────────────

describe("osmDiet", () => {
  it("yes → vegetarian friendly", () => {
    expect(osmDiet({ "diet:vegetarian": "yes" }))
      .toEqual({ isVegetarianFriendly: true,  isVeganFriendly: undefined })
  })

  it("only → vegetarian friendly", () => {
    expect(osmDiet({ "diet:vegetarian": "only" }))
      .toEqual({ isVegetarianFriendly: true,  isVeganFriendly: undefined })
  })

  it("no → not vegetarian friendly", () => {
    expect(osmDiet({ "diet:vegetarian": "no" }))
      .toEqual({ isVegetarianFriendly: false, isVeganFriendly: undefined })
  })

  it("vegan=yes implies vegetarian=true", () => {
    expect(osmDiet({ "diet:vegan": "yes" }))
      .toEqual({ isVegetarianFriendly: true,  isVeganFriendly: true })
  })

  it("vegan=only implies vegetarian=true", () => {
    expect(osmDiet({ "diet:vegan": "only" }))
      .toEqual({ isVegetarianFriendly: true,  isVeganFriendly: true })
  })

  it("vegan=no leaves vegetarian unchanged when not tagged", () => {
    expect(osmDiet({ "diet:vegan": "no" }))
      .toEqual({ isVegetarianFriendly: undefined, isVeganFriendly: false })
  })

  it("returns undefined when no diet tags", () => {
    expect(osmDiet({})).toEqual({ isVegetarianFriendly: undefined, isVeganFriendly: undefined })
  })

  it("OSM element with diet tags surfaces flags on the place", async () => {
    const element = {
      id: 777, type: "node", lat: 52.52, lon: 13.405,
      tags: { name: "Veg Café", amenity: "cafe", "diet:vegetarian": "only", "diet:vegan": "yes" },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [element] }) }))
    const [p] = await fetchOsm(BASE_PARAMS)
    expect(p.isVegetarianFriendly).toBe(true)
    expect(p.isVeganFriendly).toBe(true)
  })
})

// ─── isRecentlyVerified ───────────────────────────────────────────────────────

describe("isRecentlyVerified", () => {
  const NOW = Date.parse("2026-04-29")

  it("returns false for undefined / empty / malformed", () => {
    expect(isRecentlyVerified(undefined, NOW)).toBe(false)
    expect(isRecentlyVerified("",        NOW)).toBe(false)
    expect(isRecentlyVerified("not-a-date", NOW)).toBe(false)
  })

  it("returns true for dates within 2 years", () => {
    expect(isRecentlyVerified("2025-06-01", NOW)).toBe(true)
    expect(isRecentlyVerified("2026-04-01", NOW)).toBe(true)
  })

  it("returns false for dates older than 2 years", () => {
    expect(isRecentlyVerified("2023-01-01", NOW)).toBe(false)
    expect(isRecentlyVerified("2020-01-01", NOW)).toBe(false)
  })
})

// ─── osmParking ───────────────────────────────────────────────────────────────

describe("osmParking", () => {
  it("returns yes when capacity:disabled > 0", () => {
    expect(osmParking({ "capacity:disabled": "3" })).toBe("yes")
  })

  it("returns yes when parking_space=disabled", () => {
    expect(osmParking({ parking_space: "disabled" })).toBe("yes")
  })

  it("returns yes for capacity:wheelchair > 0", () => {
    expect(osmParking({ "capacity:wheelchair": "2" })).toBe("yes")
  })

  it("returns unknown when no parking tags present", () => {
    expect(osmParking({})).toBe("unknown")
  })

  it("returns unknown when capacity:disabled is 0", () => {
    expect(osmParking({ "capacity:disabled": "0" })).toBe("unknown")
  })
})

// ─── fetchOsm (integration with mocked fetch) ─────────────────────────────────

describe("fetchOsm", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("returns empty array when query is empty (no categories)", async () => {
    const result = await fetchOsm({ ...BASE_PARAMS, categories: [] as never[] } as unknown as SearchParams)
    expect(result).toEqual([])
  })

  it("returns empty array when Overpass returns no elements", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [] }),
    }))
    const result = await fetchOsm(BASE_PARAMS)
    expect(result).toEqual([])
  })

  it("throws immediately on non-retryable status (400)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }))
    await expect(fetchOsm(BASE_PARAMS)).rejects.toThrow("Overpass API error: 400")
  })

  it("throws after all endpoints are rate-limited (429)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    await expect(fetchOsm(BASE_PARAMS)).rejects.toThrow(/429/)
  })

  it("parses a restaurant node correctly", async () => {
    const element = {
      id: 123,
      lat: 52.521,
      lon: 13.406,
      tags: {
        name: "Café am See",
        amenity: "restaurant",
        wheelchair: "yes",
        "toilets:wheelchair": "yes",
        "capacity:disabled": "2",
        "addr:street": "Seestraße",
        "addr:housenumber": "5",
        "addr:postcode": "13355",
        "addr:city": "Berlin",
      },
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [element] }),
    }))

    const result = await fetchOsm(BASE_PARAMS)
    expect(result).toHaveLength(1)
    const place = result[0]
    expect(place.name).toBe("Café am See")
    expect(place.category).toBe("restaurant")
    expect(place.accessibility.toilet.value).toBe("yes")
    expect(place.accessibility.parking.value).toBe("yes")
    expect(place.address.city).toBe("Berlin")
    expect(place.coordinates.lat).toBe(52.521)
  })

  it("skips elements without a name", async () => {
    const element = { id: 1, lat: 52.52, lon: 13.4, tags: { amenity: "restaurant" } }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [element] }),
    }))
    const result = await fetchOsm(BASE_PARAMS)
    expect(result).toHaveLength(0)
  })

  it("captures the actual check_date on the verified source attribution", async () => {
    const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const element = {
      id: 11, type: "node", lat: 52.52, lon: 13.405,
      tags: { name: "X", amenity: "restaurant", wheelchair: "yes", "check_date:wheelchair": recent },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [element] }) }))
    const [p] = await fetchOsm(BASE_PARAMS)
    const src = p.accessibility.entrance.sources[0]
    expect(src.verifiedRecently).toBe(true)
    expect(src.verifiedAt).toBe(recent)
  })

  it("boosts entrance weight when check_date:wheelchair is recent", async () => {
    const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) // 30 days ago
    const element = {
      id: 1, type: "node", lat: 52.52, lon: 13.405,
      tags: { name: "Recent", amenity: "restaurant", wheelchair: "yes", "check_date:wheelchair": recent },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [element] }) }))
    const [boosted] = await fetchOsm(BASE_PARAMS)
    const w = boosted.accessibility.entrance.sources[0].reliabilityWeight
    // base 0.7, isOsmOverall ×0.85, boost ×1.2 → 0.714, capped <= 1.0
    expect(w).toBeGreaterThan(0.7 * 0.85)
    expect(w).toBeLessThanOrEqual(1.0)
  })

  it("does NOT boost when check_date is older than 2 years", async () => {
    const old = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const element = {
      id: 2, type: "node", lat: 52.52, lon: 13.405,
      tags: { name: "Old", amenity: "restaurant", wheelchair: "yes", "check_date:wheelchair": old },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [element] }) }))
    const [unboosted] = await fetchOsm(BASE_PARAMS)
    const w = unboosted.accessibility.entrance.sources[0].reliabilityWeight
    expect(w).toBeCloseTo(0.7 * 0.90, 5) // base × OSM_ENTRANCE_WEIGHT_FACTOR (0.90), no boost
  })

  it("encodes OSM type into externalId so consumers can build deep links", async () => {
    const node = { id: 99, type: "node", lat: 52.52, lon: 13.405, tags: { name: "X", amenity: "cafe" } }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [node] }) }))
    const [p] = await fetchOsm(BASE_PARAMS)
    expect(p.sourceRecords[0].externalId).toBe("node/99")
  })

  it("calls onAttempt before each endpoint try", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [] }) }))
    const onAttempt = vi.fn()
    await fetchOsm(BASE_PARAMS, onAttempt)
    // First endpoint succeeds → only one attempt reported
    expect(onAttempt).toHaveBeenCalledTimes(1)
    expect(onAttempt).toHaveBeenCalledWith(1, 3)
  })

  it("falls back to next endpoint on TimeoutError (regression: this used to abort after first timeout)", async () => {
    let calls = 0
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      calls++
      if (calls < 3) {
        const err = new Error("The operation was aborted due to timeout")
        err.name = "TimeoutError"
        return Promise.reject(err)
      }
      return Promise.resolve({ ok: true, json: async () => ({ elements: [] }) })
    }))
    const onAttempt = vi.fn()
    await fetchOsm(BASE_PARAMS, onAttempt)
    expect(onAttempt).toHaveBeenCalledTimes(3)
    expect(onAttempt.mock.calls.map((c) => c[0])).toEqual([1, 2, 3])
  })

  it("uses center coordinates for way elements", async () => {
    const element = {
      id: 456,
      type: "way",
      center: { lat: 52.530, lon: 13.410 },
      tags: { name: "Hotel Zentrum", tourism: "hotel" },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [element] }),
    }))
    const result = await fetchOsm({ ...BASE_PARAMS, categories: ["hotel"] })
    expect(result[0].coordinates.lat).toBe(52.530)
  })
})
