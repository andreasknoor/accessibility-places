// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fetchGinto } from "@/lib/adapters/ginto"
import { RELIABILITY_WEIGHTS, GINTO_LEVEL2_WEIGHT } from "@/lib/config"
import type { SearchParams } from "@/lib/types"

const BASE_PARAMS: SearchParams = {
  query: "restaurants in Zurich",
  location: { lat: 47.376, lon: 8.548 },
  radiusKm: 5,
  categories: ["restaurant"],
  filters: { entrance: true, toilet: true, parking: true, seating: false, onlyVerified: false, acceptUnknown: false },
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
  qualityInfo: { detailLevels: [] },
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
})

// ─── weight logic ─────────────────────────────────────────────────────────────

describe("Ginto weight and verifiedRecently logic", () => {
  it("LEVEL_1 not verified → base weight 0.90, no badge", async () => {
    mockFetch({ ...BASE_NODE, qualityInfo: { detailLevels: ["LEVEL_1"] } })
    const places = await fetchGinto(BASE_PARAMS)
    const src = places[0].accessibility.entrance.sources[0]
    expect(src.reliabilityWeight).toBeCloseTo(RELIABILITY_WEIGHTS.ginto)
    expect(src.verifiedRecently).toBeUndefined()
  })

  it("LEVEL_2 not verified → weight 0.95, no badge", async () => {
    mockFetch({ ...BASE_NODE, qualityInfo: { detailLevels: ["LEVEL_2"] } })
    const places = await fetchGinto(BASE_PARAMS)
    const src = places[0].accessibility.entrance.sources[0]
    expect(src.reliabilityWeight).toBeCloseTo(GINTO_LEVEL2_WEIGHT)
    expect(src.verifiedRecently).toBeUndefined()
  })

  it("LEVEL_1 recently verified → weight capped at 1.0 (0.90×1.2), badge set", async () => {
    const recentDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days ago
    mockFetch({ ...BASE_NODE, updatedAt: recentDate, qualityInfo: { detailLevels: ["LEVEL_1"] } })
    const places = await fetchGinto(BASE_PARAMS)
    const src = places[0].accessibility.entrance.sources[0]
    // 0.90 × 1.2 = 1.08 → capped to 1.0 by buildAttribute
    expect(src.reliabilityWeight).toBeCloseTo(1.0)
    expect(src.verifiedRecently).toBe(true)
    expect(src.verifiedAt).toBe(recentDate)
  })

  it("LEVEL_2 recently verified → max(0.95, 1.08) wins, weight capped at 1.0, badge set", async () => {
    const recentDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    mockFetch({ ...BASE_NODE, updatedAt: recentDate, qualityInfo: { detailLevels: ["LEVEL_2"] } })
    const places = await fetchGinto(BASE_PARAMS)
    const src = places[0].accessibility.entrance.sources[0]
    // verified weight (1.08) > level2 weight (0.95) → 1.08 wins, capped to 1.0
    expect(src.reliabilityWeight).toBeCloseTo(1.0)
    expect(src.verifiedRecently).toBe(true)
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

// ─── metadata ─────────────────────────────────────────────────────────────────

describe("Ginto sourceRecord metadata", () => {
  it("includes updatedAt and detailLevels in metadata", async () => {
    mockFetch({ ...BASE_NODE, qualityInfo: { detailLevels: ["LEVEL_2"] } })
    const places = await fetchGinto(BASE_PARAMS)
    const meta = places[0].sourceRecords[0].metadata as Record<string, unknown>
    expect(meta.updatedAt).toBe(BASE_NODE.updatedAt)
    expect(meta.detailLevels).toEqual(["LEVEL_2"])
  })

  it("sets gintoUrl from publication.linkUrl", async () => {
    mockFetch(BASE_NODE)
    const places = await fetchGinto(BASE_PARAMS)
    expect(places[0].gintoUrl).toBe("https://www.ginto.guide/entries/abc-123")
  })
})
