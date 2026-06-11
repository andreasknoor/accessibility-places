// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fetchGinto, intersectsSwitzerland, normalizeCountryCode } from "@/lib/adapters/ginto"
import { RELIABILITY_WEIGHTS, GINTO_SELF_DECLARED_WEIGHT, GINTO_AUDITED_WEIGHT } from "@/lib/config"
import type { SearchParams } from "@/lib/types"

const BASE_PARAMS: SearchParams = {
  query: "restaurants in Zurich",
  location: { lat: 47.376, lon: 8.548 },
  radiusKm: 5,
  categories: ["restaurant"],
  filters: { entrance: true, toilet: true, parking: true, parkingNearby: true, seating: false, onlyVerified: false, acceptUnknown: false, alwaysShowParking: false },
  sources: { accessibility_cloud: true, osm: true, reisen_fuer_alle: true, google_places: true, ginto: true },
}

const BASE_NODE = {
  entryId:  "abc-123",
  name:     "Test Restaurant",
  categories: [{ key: "restaurant" }],
  position: { lat: 47.376, lng: 8.548, street: "Bahnhofstr.", housenumber: "1", postcode: "8001", city: "Zürich", countryCode: "CH" },
  accessibilityInfo: { defaultRatings: [{ key: "completely_wheelchair_accessible" }, { key: "toilet_completely_wheelchair_accessible" }] },
  publication: { linkUrl: "https://www.ginto.guide/entries/abc-123" },
  updatedAt: new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString(), // 3 years ago → NOT recently verified
  qualityInfo: { detailLevels: [] as string[], approvalLevels: [] as string[] },
}

function mockFetch(node: typeof BASE_NODE) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        entriesBySearch: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [node],
        },
      },
    }),
  }))
}

beforeEach(() => {
  vi.unstubAllGlobals()
  process.env.GINTO_API_KEY = "test-key"
  delete process.env.GINTO_GEOFENCE
})

// ─── weight logic ─────────────────────────────────────────────────────────────

describe("Ginto weight by approval level", () => {
  it("no approval info → base weight 0.90, no badge", async () => {
    mockFetch({ ...BASE_NODE, qualityInfo: { detailLevels: [], approvalLevels: [] } })
    const places = await fetchGinto(BASE_PARAMS)
    const src = places[0].accessibility.entrance.sources[0]
    expect(src.reliabilityWeight).toBeCloseTo(RELIABILITY_WEIGHTS.ginto)
    expect(src.verifiedRecently).toBeUndefined()
  })

  it("SELF_DECLARED → weight 0.94, no badge", async () => {
    mockFetch({ ...BASE_NODE, qualityInfo: { detailLevels: [], approvalLevels: ["SELF_DECLARED"] } })
    const places = await fetchGinto(BASE_PARAMS)
    const src = places[0].accessibility.entrance.sources[0]
    expect(src.reliabilityWeight).toBeCloseTo(GINTO_SELF_DECLARED_WEIGHT)
    expect(src.verifiedRecently).toBeUndefined()
  })

  it("AUDITED → weight 1.0, no badge (no audit date available)", async () => {
    mockFetch({ ...BASE_NODE, qualityInfo: { detailLevels: [], approvalLevels: ["AUDITED"] } })
    const places = await fetchGinto(BASE_PARAMS)
    const src = places[0].accessibility.entrance.sources[0]
    expect(src.reliabilityWeight).toBeCloseTo(GINTO_AUDITED_WEIGHT)
    expect(src.verifiedRecently).toBeUndefined()
  })

  it("AUDITED wins over SELF_DECLARED when both present", async () => {
    mockFetch({ ...BASE_NODE, qualityInfo: { detailLevels: [], approvalLevels: ["SELF_DECLARED", "AUDITED"] } })
    const places = await fetchGinto(BASE_PARAMS)
    const src = places[0].accessibility.entrance.sources[0]
    expect(src.reliabilityWeight).toBeCloseTo(GINTO_AUDITED_WEIGHT)
  })

  it("detail levels alone do NOT boost the weight (regression: old detailLevels mapping)", async () => {
    mockFetch({ ...BASE_NODE, qualityInfo: { detailLevels: ["LEVEL_3", "LEVEL_2", "LEVEL_1"], approvalLevels: [] } })
    const places = await fetchGinto(BASE_PARAMS)
    const src = places[0].accessibility.entrance.sources[0]
    expect(src.reliabilityWeight).toBeCloseTo(RELIABILITY_WEIGHTS.ginto)
  })

  it("updatedAt does not set verifiedRecently regardless of recency", async () => {
    const recentDate = new Date(Date.now() - 1000).toISOString() // 1 second ago
    mockFetch({ ...BASE_NODE, updatedAt: recentDate, qualityInfo: { detailLevels: ["LEVEL_1"], approvalLevels: ["AUDITED"] } })
    const places = await fetchGinto(BASE_PARAMS)
    const src = places[0].accessibility.entrance.sources[0]
    expect(src.verifiedRecently).toBeUndefined()
    expect(src.verifiedAt).toBeUndefined()
  })
})

// ─── rating key extraction ────────────────────────────────────────────────────

describe("Ginto rating key → A11yValue mapping", () => {
  it("maps completely_wheelchair_accessible to entrance yes", async () => {
    mockFetch(BASE_NODE)
    const places = await fetchGinto(BASE_PARAMS)
    expect(places[0].accessibility.entrance.value).toBe("yes")
  })

  it("maps toilet_completely_wheelchair_accessible to toilet yes", async () => {
    mockFetch(BASE_NODE)
    const places = await fetchGinto(BASE_PARAMS)
    expect(places[0].accessibility.toilet.value).toBe("yes")
  })

  it("maps partially_wheelchair_accessible to entrance limited", async () => {
    mockFetch({ ...BASE_NODE, accessibilityInfo: { defaultRatings: [{ key: "partially_wheelchair_accessible" }] } })
    const places = await fetchGinto(BASE_PARAMS)
    expect(places[0].accessibility.entrance.value).toBe("limited")
  })

  it("maps not_wheelchair_accessible to entrance no", async () => {
    mockFetch({ ...BASE_NODE, accessibilityInfo: { defaultRatings: [{ key: "not_wheelchair_accessible" }] } })
    const places = await fetchGinto(BASE_PARAMS)
    expect(places[0].accessibility.entrance.value).toBe("no")
  })
})

// ─── geo-fence ────────────────────────────────────────────────────────────────

describe("Ginto CH geo-fence (opt-in via GINTO_GEOFENCE=1)", () => {
  it("default (flag unset): calls the API even for searches far from Switzerland (Berlin)", async () => {
    mockFetch(BASE_NODE)
    const places = await fetchGinto({ ...BASE_PARAMS, location: { lat: 52.52, lon: 13.405 }, radiusKm: 5 })
    expect(places).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("flag set: skips the API call entirely for searches far from Switzerland (Berlin)", async () => {
    process.env.GINTO_GEOFENCE = "1"
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const places = await fetchGinto({ ...BASE_PARAMS, location: { lat: 52.52, lon: 13.405 }, radiusKm: 5 })
    expect(places).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("flag set: skips Munich even with 50 km radius (circle does not reach CH)", async () => {
    process.env.GINTO_GEOFENCE = "1"
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const places = await fetchGinto({ ...BASE_PARAMS, location: { lat: 48.1372, lon: 11.5755 }, radiusKm: 50 })
    expect(places).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("flag set: calls the API for searches inside Switzerland (Zurich)", async () => {
    process.env.GINTO_GEOFENCE = "1"
    mockFetch(BASE_NODE)
    const places = await fetchGinto(BASE_PARAMS)
    expect(places).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("flag set: calls the API for border cities whose radius reaches CH (Konstanz)", async () => {
    process.env.GINTO_GEOFENCE = "1"
    mockFetch(BASE_NODE)
    await fetchGinto({ ...BASE_PARAMS, location: { lat: 47.66, lon: 9.175 }, radiusKm: 5 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  describe("intersectsSwitzerland", () => {
    it("is true inside CH",  () => expect(intersectsSwitzerland(46.948, 7.447, 1)).toBe(true))   // Bern
    it("is false in Vienna", () => expect(intersectsSwitzerland(48.208, 16.373, 50)).toBe(false))
    it("is false in Hamburg",() => expect(intersectsSwitzerland(53.55, 10.0, 50)).toBe(false))
    it("respects the radius buffer just north of the bbox", () => {
      expect(intersectsSwitzerland(48.2, 8.5, 5)).toBe(false)   // ~33 km north, small radius
      expect(intersectsSwitzerland(48.2, 8.5, 50)).toBe(true)   // large radius reaches the bbox
    })
  })
})

// ─── country code normalisation ──────────────────────────────────────────────

describe("Ginto country code normalisation", () => {
  it("maps ISO-3 to ISO-2 (all codes seen in live data)", () => {
    expect(normalizeCountryCode("AUT")).toBe("AT")
    expect(normalizeCountryCode("CHE")).toBe("CH")
    expect(normalizeCountryCode("DEU")).toBe("DE")
    expect(normalizeCountryCode("LIE")).toBe("LI")
  })

  it("passes ISO-2 through unchanged", () => {
    expect(normalizeCountryCode("AT")).toBe("AT")
    expect(normalizeCountryCode("CH")).toBe("CH")
    expect(normalizeCountryCode("DE")).toBe("DE")
    expect(normalizeCountryCode("LI")).toBe("LI")
  })

  it("is case-insensitive", () => {
    expect(normalizeCountryCode("che")).toBe("CH")
    expect(normalizeCountryCode("aut")).toBe("AT")
    expect(normalizeCountryCode("at")).toBe("AT")
    expect(normalizeCountryCode("De")).toBe("DE")
  })

  it("trims surrounding whitespace", () => {
    expect(normalizeCountryCode(" CH ")).toBe("CH")
    expect(normalizeCountryCode("\tAUT\n")).toBe("AT")
  })

  it("falls back to CH for empty / missing / whitespace-only codes", () => {
    expect(normalizeCountryCode("")).toBe("CH")
    expect(normalizeCountryCode("   ")).toBe("CH")
    expect(normalizeCountryCode(undefined)).toBe("CH")
    expect(normalizeCountryCode(null)).toBe("CH")
  })

  it("passes unknown codes through uppercased instead of guessing", () => {
    expect(normalizeCountryCode("FR")).toBe("FR")
    expect(normalizeCountryCode("FRA")).toBe("FRA")  // not in the DACH map — kept as-is
    expect(normalizeCountryCode("xx")).toBe("XX")
  })

  it("normalises the place address country from an AUT node", async () => {
    mockFetch({ ...BASE_NODE, position: { ...BASE_NODE.position, countryCode: "AUT" } })
    const places = await fetchGinto(BASE_PARAMS)
    expect(places[0].address.country).toBe("AT")
  })

  it("normalises a CHE node to CH", async () => {
    mockFetch({ ...BASE_NODE, position: { ...BASE_NODE.position, countryCode: "CHE" } })
    const places = await fetchGinto(BASE_PARAMS)
    expect(places[0].address.country).toBe("CH")
  })

  it("defaults the address country to CH when the node has no countryCode", async () => {
    const { countryCode: _omitted, ...positionWithoutCC } = BASE_NODE.position
    mockFetch({ ...BASE_NODE, position: positionWithoutCC as typeof BASE_NODE.position })
    const places = await fetchGinto(BASE_PARAMS)
    expect(places[0].address.country).toBe("CH")
  })

  it("keeps the raw (un-normalised) countryCode in sourceRecord metadata", async () => {
    mockFetch({ ...BASE_NODE, position: { ...BASE_NODE.position, countryCode: "AUT" } })
    const places = await fetchGinto(BASE_PARAMS)
    const meta = places[0].sourceRecords[0].metadata as Record<string, unknown>
    expect(meta.countryCode).toBe("AUT")
  })
})

// ─── metadata ─────────────────────────────────────────────────────────────────

describe("Ginto sourceRecord metadata", () => {
  it("includes updatedAt, detailLevels and approvalLevels in metadata", async () => {
    mockFetch({ ...BASE_NODE, qualityInfo: { detailLevels: ["LEVEL_2"], approvalLevels: ["SELF_DECLARED"] } })
    const places = await fetchGinto(BASE_PARAMS)
    const meta = places[0].sourceRecords[0].metadata as Record<string, unknown>
    expect(meta.updatedAt).toBe(BASE_NODE.updatedAt)
    expect(meta.detailLevels).toEqual(["LEVEL_2"])
    expect(meta.approvalLevels).toEqual(["SELF_DECLARED"])
  })

  it("sets gintoUrl from publication.linkUrl", async () => {
    mockFetch(BASE_NODE)
    const places = await fetchGinto(BASE_PARAMS)
    expect(places[0].gintoUrl).toBe("https://www.ginto.guide/entries/abc-123")
  })
})
