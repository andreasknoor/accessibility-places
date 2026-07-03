import { describe, it, expect, vi, beforeEach } from "vitest"
import { fetchGooglePlaces } from "@/lib/adapters/google-places"
import type { SearchParams } from "@/lib/types"

const BASE_PARAMS: SearchParams = {
  query: "restaurants",
  location: { lat: 52.52, lon: 13.405 },
  radiusKm: 2,
  categories: ["restaurant"],
  filters: { entrance: true, toilet: true, parking: true, parkingNearby: true, seating: false, onlyVerified: false, acceptUnknown: false, alwaysShowParking: false, alwaysShowToilets: false },
  sources: { accessibility_cloud: true, osm: true, reisen_fuer_alle: true, ginto: true, acceslibre: false, google_places: true },
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

  it("caps the per-category fan-out at 3 requests for an all-categories search", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ places: [] }) })
    vi.stubGlobal("fetch", fetchMock)
    await fetchGooglePlaces({
      ...BASE_PARAMS,
      categories: [
        "cafe", "restaurant", "bar", "pub", "biergarten", "fast_food",
        "hotel", "hostel", "apartment",
        "museum", "theater", "cinema", "library", "gallery", "attraction",
      ],
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("calls the Text Search endpoint with a German query term by default", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ places: [] }) })
    vi.stubGlobal("fetch", mockFetch)
    await fetchGooglePlaces({ ...BASE_PARAMS, categories: ["doctors"] })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText")
    const body = JSON.parse(init.body as string)
    expect(body.textQuery).toBe("Arzt")
    expect(body.pageSize).toBe(20)
    expect(body.locationBias.circle.radius).toBe(2000)
    expect(body.includedTypes).toBeUndefined()
  })

  it("uses the English query term when locale is en", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ places: [] }) })
    vi.stubGlobal("fetch", mockFetch)
    await fetchGooglePlaces({ ...BASE_PARAMS, categories: ["doctors"], locale: "en" })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body.textQuery).toBe("doctor")
  })

  it("drops results whose types don't match the category (relevance-query noise)", async () => {
    const physio = makeGooglePlace({ displayName: { text: "Physiopraxis" }, types: ["physiotherapist"], primaryType: "physiotherapist" })
    const doctor = makeGooglePlace({ displayName: { text: "Hausarztzentrum" }, types: ["doctor", "health"], primaryType: "doctor" })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [physio, doctor] }),
    }))
    const result = await fetchGooglePlaces({ ...BASE_PARAMS, categories: ["doctors"] })
    expect(result.map((p) => p.name)).toEqual(["Hausarztzentrum"])
  })

  it("keeps results without any type info (defensive leniency)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [makeGooglePlace()] }), // fixture carries no types
    }))
    const result = await fetchGooglePlaces({ ...BASE_PARAMS, categories: ["doctors"] })
    expect(result).toHaveLength(1)
  })

  it("clips results beyond the search radius (locationBias is soft)", async () => {
    const near = makeGooglePlace({ displayName: { text: "Nah" } })                                    // ~130 m
    const far  = makeGooglePlace({ displayName: { text: "Fern" }, location: { latitude: 52.62, longitude: 13.405 } }) // ~11 km
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [near, far] }),
    }))
    const result = await fetchGooglePlaces(BASE_PARAMS) // radiusKm: 2
    expect(result.map((p) => p.name)).toEqual(["Nah"])
  })

  it("follows nextPageToken up to 3 pages and aggregates results", async () => {
    const page = (name: string, token?: string) => ({
      ok: true,
      json: async () => ({
        places: [makeGooglePlace({ id: name, displayName: { text: name } })],
        ...(token ? { nextPageToken: token } : {}),
      }),
    })
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(page("Seite1", "tok-1"))
      .mockResolvedValueOnce(page("Seite2", "tok-2"))
      .mockResolvedValueOnce(page("Seite3", "tok-3")) // token on the last page must be ignored (cap)
    vi.stubGlobal("fetch", mockFetch)

    const result = await fetchGooglePlaces(BASE_PARAMS)
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(result.map((p) => p.name)).toEqual(["Seite1", "Seite2", "Seite3"])
    // Follow-up requests carry the token from the previous response, same query otherwise
    const body2 = JSON.parse(mockFetch.mock.calls[1][1].body as string)
    expect(body2.pageToken).toBe("tok-1")
    expect(body2.textQuery).toBe("Restaurant")
    const body3 = JSON.parse(mockFetch.mock.calls[2][1].body as string)
    expect(body3.pageToken).toBe("tok-2")
  })

  it("stops after one page when no nextPageToken is returned (adaptive)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ places: [makeGooglePlace()] }),
    })
    vi.stubGlobal("fetch", mockFetch)
    await fetchGooglePlaces(BASE_PARAMS)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("keeps earlier pages when a follow-up page errors", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ places: [makeGooglePlace()], nextPageToken: "tok-1" }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 })
    vi.stubGlobal("fetch", mockFetch)
    const result = await fetchGooglePlaces(BASE_PARAMS)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(1)
  })

  it("combines user signal with timeout so client disconnect aborts the fetch (Bug 3)", async () => {
    const controller = new AbortController()
    let capturedSignal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: unknown, init: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal
      return Promise.resolve({ ok: true, json: async () => ({ places: [] }) })
    }))

    await fetchGooglePlaces({ ...BASE_PARAMS, signal: controller.signal })

    expect(capturedSignal).toBeDefined()
    expect(capturedSignal!.aborted).toBe(false)
    controller.abort()
    expect(capturedSignal!.aborted).toBe(true)
  })
})
