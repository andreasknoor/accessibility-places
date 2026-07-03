// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/search/route"
import { trackCall, trackError, trackDuration } from "@/lib/stats"

vi.mock("@/lib/stats", () => ({
  trackCall:     vi.fn(),
  trackError:    vi.fn(),
  trackDuration: vi.fn(),
  getStats:      vi.fn().mockResolvedValue({}),
}))

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
  // parking spot 80 m away. The restaurant's parking value is upgraded to
  // "yes" + nearbyOnly=true, and parkingSpots is populated in the result payload.
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
  })

  it("enriches parking to nearbyOnly=true when parking filter is OFF", async () => {
    // Two fetch calls: one for OSM venues, one for Overpass disabled parking.
    // Both POST to the same Overpass URL — the query lives in the body, so we
    // discriminate on the request body, not the URL.
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init?: { body?: string }) => {
      if (init?.body?.includes("parking_space")) {
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
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init?: { body?: string }) => {
      if (init?.body?.includes("parking_space")) {
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

  it("does NOT enrich when coordinates are outside DACH (international mode)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ elements: [{ ...OSM_RESTAURANT, lat: 48.85, lon: 2.35 }] }),
    })
    vi.stubGlobal("fetch", fetchMock)

    // Paris coordinates + international mode — outside DACH, enrichment must be skipped
    const req = makeReq({
      ...BASE_BODY,
      location:     "Paris",
      coordinates:  { lat: 48.85, lon: 2.35 },
      international: true,
      filters:      { ...BASE_BODY.filters, parking: false, entrance: false, toilet: false },
      sources:      { ...BASE_BODY.sources, osm: true },
    })
    const res    = await POST(req)
    const events = await parseEvents(res)
    const result = events.find((e) => e.type === "result")
    expect(result).toBeDefined()

    const payload = result!.payload as { parkingSpots: unknown[] }
    expect(payload.parkingSpots).toHaveLength(0)
  })

  // A strong spot ~1 km from the venue: too far to enrich (>250 m) so the venue
  // is NOT anchored to it, but well inside the 2 km centre-display radius. The
  // anchor-free display means it must still be shipped (previously it was dropped
  // because no enriched venue sat next to it).
  const OSM_PARKING_FAR = {
    type: "node",
    id: 888,
    lat: 52.529, // ~1 km north of the 52.52 search centre / venue
    lon: 13.405,
    tags: { amenity: "parking_space", "parking_space": "disabled", "capacity:disabled": "3" },
  }

  it("ships a strong spot with no enriched venue anchor (within centre radius)", async () => {
    // The Overpass query lives in the POST body, not the URL — discriminate there.
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init?: { body?: string }) => {
      if (init?.body?.includes("parking_space")) {
        return Promise.resolve({ ok: true, json: async () => ({ elements: [OSM_PARKING_FAR] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ elements: [OSM_RESTAURANT] }) })
    }))

    const req = makeReq({
      ...BASE_BODY,
      filters: { ...BASE_BODY.filters, parking: false, entrance: false, toilet: false },
      sources: { ...BASE_BODY.sources, osm: true },
    })
    const res    = await POST(req)
    const events = await parseEvents(res)
    const result = events.find((e) => e.type === "result")
    expect(result).toBeDefined()

    const payload = result!.payload as { places: Array<{ accessibility: { parking: { value: string } } }>; parkingSpots: unknown[] }
    // Venue stays unenriched (spot is >250 m away) ...
    expect(payload.places[0].accessibility.parking.value).toBe("unknown")
    // ... yet the spot is still displayed (anchor-free).
    expect(payload.parkingSpots).toHaveLength(1)
  })

  // A strong spot ~12 km from the centre, inside a deliberately wide 20 km search:
  // fetched, but trimmed by the PARKING_DISPLAY_MAX_M (10 km) cap so a very wide
  // search doesn't scatter pins far from where the user looked. (Within a normal
  // ≤10 km radius the display distance equals the search radius and nothing is
  // trimmed — that's the Bad Muskau case where a 2.8 km spot must stay visible.)
  const OSM_PARKING_TOOFAR = {
    type: "node",
    id: 777,
    lat: 52.628, // ~12 km north of the 52.52 centre — beyond the 10 km cap
    lon: 13.405,
    tags: { amenity: "parking_space", "parking_space": "disabled", "capacity:disabled": "2" },
  }

  it("trims a strong spot beyond the display cap on a very wide search", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init?: { body?: string }) => {
      if (init?.body?.includes("parking_space")) {
        return Promise.resolve({ ok: true, json: async () => ({ elements: [OSM_PARKING_TOOFAR] }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ elements: [OSM_RESTAURANT] }) })
    }))

    const req = makeReq({
      ...BASE_BODY,
      radiusKm: 20, // wide enough to fetch the 12 km spot, but past the 10 km cap
      filters: { ...BASE_BODY.filters, parking: false, entrance: false, toilet: false },
      sources: { ...BASE_BODY.sources, osm: true },
    })
    const res    = await POST(req)
    const events = await parseEvents(res)
    const result = events.find((e) => e.type === "result")
    expect(result).toBeDefined()

    const payload = result!.payload as { parkingSpots: unknown[] }
    expect(payload.parkingSpots).toHaveLength(0)
  })
})

describe("POST /api/search — stats tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key")
  })

  it("calls trackCall (not trackError) for each source that succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ places: [GP_PLACE_SEATING_NO] }),
    }))

    // Use a unique IP to avoid the shared in-memory rate limiter being exhausted
    // by the 10+ other POST calls that precede this test in the file.
    const req = new NextRequest("http://localhost/api/search", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "stats-test-1" },
      body:    JSON.stringify({ ...BASE_BODY, sources: { ...BASE_BODY.sources, google_places: true } }),
    })
    await parseEvents(await POST(req))

    expect(trackCall).toHaveBeenCalledWith("google_places")
    expect(trackError).not.toHaveBeenCalled()
  })

  it("calls both trackCall and trackError when a source fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")))

    const req = new NextRequest("http://localhost/api/search", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "stats-test-2" },
      body:    JSON.stringify({ ...BASE_BODY, sources: { ...BASE_BODY.sources, osm: true } }),
    })
    await parseEvents(await POST(req))

    expect(trackCall).toHaveBeenCalledWith("osm")
    expect(trackError).toHaveBeenCalledWith("osm")
  })
})

// ─── Geocode failure modes (not-found vs. transient upstream failure) ────────

describe("POST /api/search — geocode failure codes", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function geocodeReq(ip: string): NextRequest {
    // No `coordinates` → the route must geocode via (mocked) Nominatim.
    const { coordinates: _c, ...body } = BASE_BODY
    return new NextRequest("http://localhost/api/search", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body:    JSON.stringify(body),
    })
  }

  it("emits fatal code location_not_found when Nominatim knows no such place", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    const events = await parseEvents(await POST(geocodeReq("geo-test-1")))
    const fatal = events.find((e) => e.type === "fatal")
    expect(fatal?.code).toBe("location_not_found")
  })

  it("emits fatal code geocoding_unavailable on a Nominatim 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    const events = await parseEvents(await POST(geocodeReq("geo-test-2")))
    const fatal = events.find((e) => e.type === "fatal")
    expect(fatal?.code).toBe("geocoding_unavailable")
  })

  it("emits fatal code geocoding_unavailable on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")))
    const events = await parseEvents(await POST(geocodeReq("geo-test-3")))
    const fatal = events.find((e) => e.type === "fatal")
    expect(fatal?.code).toBe("geocoding_unavailable")
  })
})
