import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  buildOverpassQuery,
  osmWheelchair,
  osmToilet,
  osmParking,
  osmAllowsDogs,
  osmDiet,
  fetchOsm,
  fetchOsmDisabledParking,
  isRecentlyVerified,
} from "@/lib/adapters/osm"
import type { SearchParams } from "@/lib/types"

const BASE_PARAMS: SearchParams = {
  query: "restaurants in Berlin",
  location: { lat: 52.52, lon: 13.405 },
  radiusKm: 5,
  categories: ["restaurant"],
  filters: { entrance: true, toilet: true, parking: true, seating: false, onlyVerified: false, acceptUnknown: false, alwaysShowParking: false },
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
    // node + way per tag type → 2 amenity~ clauses (deduplicated values within each)
    const amenityMatches = q.match(/amenity~/g) ?? []
    expect(amenityMatches).toHaveLength(2)
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
    const noFilters = { entrance: false, toilet: false, parking: false, seating: false, acceptUnknown: false, onlyVerified: false, alwaysShowParking: false }
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
    const recent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const element = {
      id: 1, type: "node", lat: 52.52, lon: 13.405,
      tags: { name: "Recent", amenity: "restaurant", wheelchair: "yes", "check_date:wheelchair": recent },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [element] }) }))
    const [boosted] = await fetchOsm(BASE_PARAMS)
    const w = boosted.accessibility.entrance.sources[0].reliabilityWeight
    // base 0.75, isOsmOverall ×0.85, boost ×1.2 → 0.765, capped <= 1.0
    expect(w).toBeGreaterThan(0.75 * 0.85)
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
    expect(w).toBeCloseTo(0.75 * 0.90, 5) // base × OSM_ENTRANCE_WEIGHT_FACTOR (0.90), no boost
  })

  it("encodes OSM type into externalId so consumers can build deep links", async () => {
    const node = { id: 99, type: "node", lat: 52.52, lon: 13.405, tags: { name: "X", amenity: "cafe" } }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [node] }) }))
    const [p] = await fetchOsm(BASE_PARAMS)
    expect(p.sourceRecords[0].externalId).toBe("node/99")
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

  // ─── Parallel race behaviour ──────────────────────────────────────────────

  it("fires both endpoints simultaneously (parallel, not sequential)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [] }),
    })
    vi.stubGlobal("fetch", mockFetch)
    await fetchOsm(BASE_PARAMS)
    // Both endpoints must be called — verifies the parallel race fires them all.
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("returns results from exactly one winner — parallel responses are not concatenated", async () => {
    const element = { id: 1, type: "node", lat: 52.52, lon: 13.405, tags: { name: "Race Café", amenity: "cafe" } }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [element] }),
    }))
    const result = await fetchOsm(BASE_PARAMS)
    // Both endpoints return the same element. If results were concatenated we'd
    // get 2 identical places. The race must process only the first resolved response.
    expect(result).toHaveLength(1)
  })

  it("cancels the losing endpoint fetch after the race winner responds", async () => {
    const capturedSignals: AbortSignal[] = []
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: unknown, init: RequestInit) => {
      capturedSignals.push(init?.signal as AbortSignal)
      return Promise.resolve({ ok: true, json: async () => ({ elements: [] }) })
    }))
    await fetchOsm(BASE_PARAMS)
    // cancelRace.abort() fires after the winner is found. All composite signals
    // (which include cancelRace.signal) are now aborted — the loser gets cancelled.
    expect(capturedSignals).toHaveLength(2)
    expect(capturedSignals.every((s) => s.aborted)).toBe(true)
  })

  it("returns results even when the first endpoint fails (timeout/5xx)", async () => {
    let calls = 0
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      const n = ++calls
      if (n < 2) {
        const err = new Error("The operation was aborted due to timeout")
        err.name = "TimeoutError"
        return Promise.reject(err)
      }
      return Promise.resolve({ ok: true, json: async () => ({ elements: [] }) })
    }))
    const result = await fetchOsm(BASE_PARAMS)
    expect(result).toEqual([]) // 2nd endpoint succeeded
    expect(calls).toBe(2)      // both were initiated in parallel
  })

  it("aborts all in-flight endpoint fetches when the user signal fires (Bug 3)", async () => {
    const controller = new AbortController()
    const capturedSignals: AbortSignal[] = []

    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: unknown, init: RequestInit) => {
      const signal = init?.signal as AbortSignal
      capturedSignals.push(signal)
      // Simulate a fetch that is pending until its signal aborts.
      return new Promise<Response>((_, reject) => {
        signal.addEventListener("abort", () => {
          const err = new Error("The user aborted a request.")
          err.name = "AbortError"
          reject(err)
        })
      })
    }))

    const promise = fetchOsm({ ...BASE_PARAMS, signal: controller.signal })

    // Yield to allow both parallel fetch calls to be initiated.
    await Promise.resolve()
    await Promise.resolve()

    expect(capturedSignals).toHaveLength(2)
    // Signals are composite (AbortSignal.any) — not yet aborted.
    expect(capturedSignals.every((s) => !s.aborted)).toBe(true)

    // Aborting the user controller must propagate to all endpoint signals.
    controller.abort()
    expect(capturedSignals.every((s) => s.aborted)).toBe(true)

    // fetchOsm must reject (both fail with AbortError → AggregateError unwrapped).
    await expect(promise).rejects.toThrow()
  })
})

// ─── fetchOsmDisabledParking ──────────────────────────────────────────────────

describe("fetchOsmDisabledParking", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("returns empty array when Overpass returns no elements", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [] }),
    }))
    const result = await fetchOsmDisabledParking({ lat: 52.52, lon: 13.405 }, 1)
    expect(result).toEqual([])
  })

  it("parses capacity:disabled from parking features", async () => {
    const element = {
      type: "node", id: 1, lat: 52.52, lon: 13.405,
      tags: { amenity: "parking", "capacity:disabled": "3" },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [element] }),
    }))
    const [f] = await fetchOsmDisabledParking({ lat: 52.52, lon: 13.405 }, 1)
    expect(f.lat).toBe(52.52)
    expect(f.capacity).toBe(3)
  })

  it("uses center for way elements", async () => {
    const element = {
      type: "way", id: 2,
      center: { lat: 52.530, lon: 13.410 },
      tags: { amenity: "parking", "capacity:disabled": "2" },
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [element] }),
    }))
    const [f] = await fetchOsmDisabledParking({ lat: 52.52, lon: 13.405 }, 1)
    expect(f.lat).toBe(52.530)
  })

  it("returns empty array on non-200 response and tries next endpoint", async () => {
    let calls = 0
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      calls++
      if (calls < 2) return Promise.resolve({ ok: false, status: 503 })
      return Promise.resolve({ ok: true, json: async () => ({ elements: [] }) })
    }))
    const result = await fetchOsmDisabledParking({ lat: 52.52, lon: 13.405 }, 1)
    expect(calls).toBe(2) // 2 endpoints: first fails (503), second succeeds
    expect(result).toEqual([])
  })

  it("combines user signal with timeout (Bug 4)", async () => {
    const controller = new AbortController()
    let capturedSignal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: unknown, init: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal
      return Promise.resolve({ ok: true, json: async () => ({ elements: [] }) })
    }))

    await fetchOsmDisabledParking({ lat: 52.52, lon: 13.405 }, 1, controller.signal)

    expect(capturedSignal).toBeDefined()
    expect(capturedSignal!.aborted).toBe(false)
    controller.abort()
    expect(capturedSignal!.aborted).toBe(true)
  })

  it("quotes colon keys in Overpass QL to avoid 400 Bad Request", async () => {
    // Unquoted [capacity:disabled] is a syntax error in Overpass QL — the server
    // returns 400 and the caller silently falls back to []. Quoted keys are required.
    let capturedBody = ""
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: unknown, init: RequestInit) => {
      capturedBody = init?.body as string
      return Promise.resolve({ ok: true, json: async () => ({ elements: [] }) })
    }))
    await fetchOsmDisabledParking({ lat: 52.52, lon: 13.405 }, 1)
    const decoded = decodeURIComponent(capturedBody.replace(/^data=/, ""))
    expect(decoded).toContain(`["capacity:disabled"]`)
    expect(decoded).toContain(`["capacity:wheelchair"]`)
    expect(decoded).not.toContain(`[capacity:disabled]`)
    expect(decoded).not.toContain(`[capacity:wheelchair]`)
  })

  it("caps the search radius at NEARBY_PARKING_MAX_RADIUS_KM regardless of input", async () => {
    let capturedBody = ""
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: unknown, init: RequestInit) => {
      capturedBody = init?.body as string
      return Promise.resolve({ ok: true, json: async () => ({ elements: [] }) })
    }))
    await fetchOsmDisabledParking({ lat: 52.52, lon: 13.405 }, 50)
    const decoded = decodeURIComponent(capturedBody.replace(/^data=/, ""))
    // 50 km capped to 10 km → radius in metres = 10000
    expect(decoded).toContain("around:10000")
    expect(decoded).not.toContain("around:50000")
  })
})
