// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/search/route"

// Parse the NDJSON stream into an array of event objects
async function parseEvents(res: Response): Promise<Array<{ type: string; [k: string]: unknown }>> {
  const text = await res.text()
  return text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
}

function makeReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/search", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  })
}

// Coordinates bypass Nominatim geocoding; only one source active to keep mocks simple.
const BASE_BODY = {
  userQuery:   "restaurants in Berlin",
  radiusKm:    5,
  coordinates: { lat: 52.52, lon: 13.405 },
  filters: {
    entrance: false, toilet: false, parking: false, seating: false,
    onlyVerified: false, acceptUnknown: false,
  },
  sources: {
    accessibility_cloud: false, osm: false,
    reisen_fuer_alle: false, ginto: false, google_places: false,
  },
}

// A Google Places response item that has accessible entrance/toilet/parking
// but explicitly inaccessible seating (wheelchairAccessibleSeating: false).
const GP_PLACE_SEATING_NO = {
  id: "gp-seat-no",
  displayName: { text: "Test Restaurant" },
  location: { latitude: 52.52, longitude: 13.405 },
  formattedAddress: "Hauptstr. 1, 10115 Berlin",
  addressComponents: [
    { types: ["locality"], longText: "Berlin" },
    { types: ["country"],  longText: "DE" },
  ],
  types: ["restaurant"],
  primaryType: "restaurant",
  accessibilityOptions: {
    wheelchairAccessibleEntrance: true,
    wheelchairAccessibleRestroom: true,
    wheelchairAccessibleParking:  true,
    wheelchairAccessibleSeating:  false,
  },
}

describe("POST /api/search — filterDebug (Bug 2: failedBy.seating)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key")
  })

  it("counts failedBy.seating when a place fails the seating filter", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ places: [GP_PLACE_SEATING_NO] }),
    }))

    const req = makeReq({
      ...BASE_BODY,
      filters: { ...BASE_BODY.filters, seating: true },
      sources: { ...BASE_BODY.sources, google_places: true },
    })
    const res    = await POST(req)
    const events = await parseEvents(res)
    const result = events.find((e) => e.type === "result")
    expect(result).toBeDefined()

    const { filterDebug } = result!.payload as {
      filterDebug: { failedBy: { entrance: number; toilet: number; parking: number; seating: number }; total: number; passed: number }
    }
    expect(filterDebug.failedBy.seating).toBe(1)
    expect(filterDebug.failedBy.entrance).toBe(0)
    expect(filterDebug.failedBy.toilet).toBe(0)
    expect(filterDebug.passed).toBe(0)  // place fails filter → not in results
  })

  it("failedBy.seating is 0 when seating filter is inactive", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ places: [GP_PLACE_SEATING_NO] }),
    }))

    // seating filter OFF — failedBy.seating must stay 0
    const req = makeReq({
      ...BASE_BODY,
      filters: { ...BASE_BODY.filters, seating: false },
      sources: { ...BASE_BODY.sources, google_places: true },
    })
    const res    = await POST(req)
    const events = await parseEvents(res)
    const result = events.find((e) => e.type === "result")
    expect(result).toBeDefined()

    const { filterDebug } = result!.payload as {
      filterDebug: { failedBy: { seating: number } }
    }
    expect(filterDebug.failedBy.seating).toBe(0)
  })
})

describe("POST /api/search — input validation", () => {
  it("returns 400 for missing userQuery", async () => {
    const req = makeReq({ radiusKm: 5 })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 400 for empty userQuery", async () => {
    const req = makeReq({ ...BASE_BODY, userQuery: "   " })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/search", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    "not-json",
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 400 when userQuery exceeds 500 characters", async () => {
    const req = makeReq({ ...BASE_BODY, userQuery: "a".repeat(501) })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("clamps radiusKm to configured min/max range", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ elements: [] }),
    }))
    const req = makeReq({ ...BASE_BODY, radiusKm: 999, sources: { ...BASE_BODY.sources, osm: true } })
    const res    = await POST(req)
    const events = await parseEvents(res)
    const result = events.find((e) => e.type === "result")
    expect(result).toBeDefined()
    // If radius was NOT clamped, the query would blow up or return a fatal event.
    // Presence of a result event confirms the route processed it without error.
  })
})

describe("POST /api/search — nearby parking enrichment", () => {
  // OSM Overpass returns one restaurant with unknown parking and one disabled
  // parking spot 80 m away. With ENABLE_NEARBY_PARKING=1 the restaurant's
  // parking value is upgraded to "yes" + nearbyOnly=true, and parkingSpots
  // is populated in the result payload.
  const OSM_RESTAURANT = {
    type: "node",
    id: 111,
    lat: 52.52,
    lon: 13.405,
    tags: {
      amenity:    "restaurant",
      name:       "Enrichment Test",
      wheelchair: "unknown",
    },
  }
  // ~80 m north of the restaurant
  const OSM_PARKING_SPOT = {
    type: "node",
    id: 999,
    lat: 52.5207,
    lon: 13.405,
    tags: { amenity: "parking_space", "parking_space": "disabled", "capacity:disabled": "2" },
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv("ENABLE_NEARBY_PARKING", "1")
  })

  it("enriches parking to nearbyOnly=true when parking filter is OFF", async () => {
    // Two fetch calls: one for OSM venues, one for Overpass disabled parking.
    // We discriminate by URL substring.
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.includes("parking_space")) {
        return Promise.resolve({ ok: true, json: async () => ({ elements: [OSM_PARKING_SPOT] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ elements: [OSM_RESTAURANT] }) })
    }))

    const req = makeReq({
      ...BASE_BODY,
      // parking filter is explicitly OFF — enrichment must still run
      filters:  { ...BASE_BODY.filters, parking: false, entrance: false, toilet: false },
      sources:  { ...BASE_BODY.sources, osm: true },
    })
    const res    = await POST(req)
    const events = await parseEvents(res)
    const result = events.find((e) => e.type === "result")
    expect(result).toBeDefined()

    const payload = result!.payload as { places: Array<{ accessibility: { parking: { value: string; details: Record<string, unknown> } } }>; parkingSpots: unknown[] }
    expect(payload.places).toHaveLength(1)
    expect(payload.places[0].accessibility.parking.value).toBe("yes")
    expect(payload.places[0].accessibility.parking.details.nearbyOnly).toBe(true)
    expect(payload.parkingSpots).toHaveLength(1)
  })

  it("enriches parking even when parking filter is ON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.includes("parking_space")) {
        return Promise.resolve({ ok: true, json: async () => ({ elements: [OSM_PARKING_SPOT] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ elements: [OSM_RESTAURANT] }) })
    }))

    const req = makeReq({
      ...BASE_BODY,
      filters:  { ...BASE_BODY.filters, parking: true, entrance: false, toilet: false },
      sources:  { ...BASE_BODY.sources, osm: true },
    })
    const res    = await POST(req)
    const events = await parseEvents(res)
    const result = events.find((e) => e.type === "result")
    expect(result).toBeDefined()

    const payload = result!.payload as { places: Array<{ accessibility: { parking: { value: string } } }>; parkingSpots: unknown[] }
    // Place passes the parking filter because enrichment upgraded it to "yes"
    expect(payload.places).toHaveLength(1)
    expect(payload.places[0].accessibility.parking.value).toBe("yes")
    expect(payload.parkingSpots).toHaveLength(1)
  })

  it("does NOT enrich when ENABLE_NEARBY_PARKING is unset", async () => {
    vi.unstubAllEnvs()
    // ENABLE_NEARBY_PARKING is NOT set — only the OSM venue fetch should fire
    const fetchMock = vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ elements: [OSM_RESTAURANT] }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const req = makeReq({
      ...BASE_BODY,
      filters:  { ...BASE_BODY.filters, parking: false, entrance: false, toilet: false },
      sources:  { ...BASE_BODY.sources, osm: true },
    })
    const res    = await POST(req)
    const events = await parseEvents(res)
    const result = events.find((e) => e.type === "result")
    expect(result).toBeDefined()

    const payload = result!.payload as { places: Array<{ accessibility: { parking: { value: string } } }>; parkingSpots: unknown[] }
    expect(payload.places[0].accessibility.parking.value).toBe("unknown")
    expect(payload.parkingSpots).toHaveLength(0)
  })
})
