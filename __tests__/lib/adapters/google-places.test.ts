import { describe, it, expect, vi, beforeEach } from "vitest"
import { fetchGooglePlaces } from "@/lib/adapters/google-places"
import type { SearchParams } from "@/lib/types"

const BASE_PARAMS: SearchParams = {
  query: "restaurants",
  location: { lat: 52.52, lon: 13.405 },
  radiusKm: 2,
  categories: ["restaurant"],
  filters: { entrance: true, toilet: true, parking: true, seating: false, acceptUnknown: false },
  sources: { accessibility_cloud: true, osm: true, reisen_fuer_alle: true, google_places: true },
}

function makeGooglePlace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ChIJ123",
    displayName: { text: "Meine Pizzeria" },
    location: { latitude: 52.521, longitude: 13.406 },
    formattedAddress: "Hauptstraße 1, 10115 Berlin",
    addressComponents: [
      { types: ["route"],           longText: "Hauptstraße" },
      { types: ["street_number"],   longText: "1" },
      { types: ["postal_code"],     longText: "10115" },
      { types: ["locality"],        longText: "Berlin" },
      { types: ["country"],         longText: "DE" },
    ],
    accessibilityOptions: {
      wheelchairAccessibleEntrance:  true,
      wheelchairAccessibleRestroom:  true,
      wheelchairAccessibleParking:   false,
      wheelchairAccessibleSeating:   true,
    },
    ...overrides,
  }
}

describe("fetchGooglePlaces", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key")
  })

  it("returns empty array when API key is missing", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "")
    const result = await fetchGooglePlaces(BASE_PARAMS)
    expect(result).toEqual([])
  })

  it("returns empty array when API returns no places", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [] }),
    }))
    const result = await fetchGooglePlaces(BASE_PARAMS)
    expect(result).toEqual([])
  })

  it("maps boolean accessibility flags correctly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [makeGooglePlace()] }),
    }))
    const result = await fetchGooglePlaces(BASE_PARAMS)
    expect(result).toHaveLength(1)
    const place = result[0]
    expect(place.accessibility.entrance.value).toBe("yes")
    expect(place.accessibility.toilet.value).toBe("yes")
    expect(place.accessibility.parking.value).toBe("no")
    expect(place.accessibility.seating?.value).toBe("yes")
  })

  it("maps false → no for entrance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [makeGooglePlace({
          accessibilityOptions: { wheelchairAccessibleEntrance: false },
        })],
      }),
    }))
    const result = await fetchGooglePlaces(BASE_PARAMS)
    expect(result[0].accessibility.entrance.value).toBe("no")
  })

  it("maps null → unknown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [makeGooglePlace({ accessibilityOptions: {} })],
      }),
    }))
    const result = await fetchGooglePlaces(BASE_PARAMS)
    expect(result[0].accessibility.entrance.value).toBe("unknown")
    expect(result[0].accessibility.seating).toBeUndefined()
  })

  it("parses address components correctly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [makeGooglePlace()] }),
    }))
    const [place] = await fetchGooglePlaces(BASE_PARAMS)
    expect(place.address.street).toBe("Hauptstraße")
    expect(place.address.houseNumber).toBe("1")
    expect(place.address.postalCode).toBe("10115")
    expect(place.address.city).toBe("Berlin")
    expect(place.address.country).toBe("DE")
  })

  it("skips places without displayName", async () => {
    const noName = makeGooglePlace({ displayName: null })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [noName] }),
    }))
    const result = await fetchGooglePlaces(BASE_PARAMS)
    expect(result).toHaveLength(0)
  })

  it("flags vegetarian_restaurant primary type as vegetarian-friendly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [makeGooglePlace({ primaryType: "vegetarian_restaurant", types: ["vegetarian_restaurant","restaurant"] })] }),
    }))
    const [p] = await fetchGooglePlaces(BASE_PARAMS)
    expect(p.isVegetarianFriendly).toBe(true)
    expect(p.isVeganFriendly).toBeUndefined()
  })

  it("vegan_restaurant type implies both vegan and vegetarian friendly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [makeGooglePlace({ primaryType: "vegan_restaurant", types: ["vegan_restaurant","restaurant"] })] }),
    }))
    const [p] = await fetchGooglePlaces(BASE_PARAMS)
    expect(p.isVeganFriendly).toBe(true)
    expect(p.isVegetarianFriendly).toBe(true)
  })

  it("regular restaurant has no diet flags", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [makeGooglePlace({ primaryType: "restaurant", types: ["restaurant"] })] }),
    }))
    const [p] = await fetchGooglePlaces(BASE_PARAMS)
    expect(p.isVegetarianFriendly).toBeUndefined()
    expect(p.isVeganFriendly).toBeUndefined()
  })

  it("uses google_places reliability weight (0.35)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [makeGooglePlace()] }),
    }))
    const [place] = await fetchGooglePlaces(BASE_PARAMS)
    const src = place.accessibility.entrance.sources[0]
    expect(src.reliabilityWeight).toBeCloseTo(0.35)
  })

  it("makes one API call per category", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [] }),
    })
    vi.stubGlobal("fetch", mockFetch)
    await fetchGooglePlaces({ ...BASE_PARAMS, categories: ["restaurant", "hotel"] })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("continues on per-category API error (logs, does not throw)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    const result = await fetchGooglePlaces(BASE_PARAMS)
    expect(result).toEqual([])
  })
})
