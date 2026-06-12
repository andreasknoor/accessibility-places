// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/geocode/unified-suggest/route"

function makeReq(q: string, extra = ""): NextRequest {
  return new NextRequest(`http://localhost/api/geocode/unified-suggest?q=${encodeURIComponent(q)}&lang=de${extra}`)
}

function photonResponse(features: object[]): Response {
  return new Response(JSON.stringify({ type: "FeatureCollection", features }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

type FeatureOpts = {
  city?: string
  countrycode?: string
  osm_key?: string
  osm_value?: string
  type?: string
  coordinates?: [number, number]
}

function feature(name: string, opts: FeatureOpts = {}) {
  const { coordinates, ...properties } = opts
  return {
    type: "Feature",
    properties: { name, ...properties },
    geometry: { type: "Point", coordinates: coordinates ?? [13.4, 52.5] },
  }
}

const cityFeature  = (name: string, opts: FeatureOpts = {}) =>
  feature(name, { osm_key: "place", osm_value: "city", type: "city", countrycode: "DE", ...opts })
const venueFeature = (name: string, opts: FeatureOpts = {}) =>
  feature(name, { osm_key: "amenity", osm_value: "restaurant", type: "house", countrycode: "DE", ...opts })

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("GET /api/geocode/unified-suggest", () => {

  // ── Input validation ────────────────────────────────────────────────────────

  it("returns [] for missing q", async () => {
    const req = new NextRequest("http://localhost/api/geocode/unified-suggest")
    expect(await (await GET(req)).json()).toEqual([])
  })

  it("returns [] for q shorter than 2 chars", async () => {
    expect(await (await GET(makeReq("B"))).json()).toEqual([])
  })

  // ── Upstream failure handling ───────────────────────────────────────────────

  it("returns [] when Photon responds with non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    expect(await (await GET(makeReq("Berlin"))).json()).toEqual([])
  })

  it("returns [] when fetch throws (network error / timeout)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")))
    expect(await (await GET(makeReq("Berlin"))).json()).toEqual([])
  })

  // ── Classification ──────────────────────────────────────────────────────────

  it("classifies place/city features as area", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(photonResponse([cityFeature("Berlin")])))
    const data = await (await GET(makeReq("Berlin"))).json()
    expect(data).toHaveLength(1)
    expect(data[0].kind).toBe("area")
    expect(data[0].name).toBe("Berlin")
  })

  it("classifies amenity features as venue", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      photonResponse([venueFeature("Bierpumpe", { city: "Issum" })]),
    ))
    const data = await (await GET(makeReq("Bierpumpe"))).json()
    expect(data).toEqual([{
      kind: "venue", display: "Bierpumpe, Issum (DE)", name: "Bierpumpe",
      lat: 52.5, lon: 13.4, osmKey: "amenity", osmValue: "restaurant",
    }])
  })

  it("classifies boundary features as area", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(photonResponse([
      feature("Mitte", { osm_key: "boundary", osm_value: "administrative", type: "district", city: "Berlin", countrycode: "DE" }),
    ])))
    const data = await (await GET(makeReq("Mitte"))).json()
    expect(data[0].kind).toBe("area")
  })

  it("classifies tourism features as venue", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(photonResponse([
      feature("Hotel Adlon", { osm_key: "tourism", osm_value: "hotel", type: "house", city: "Berlin", countrycode: "DE" }),
    ])))
    const data = await (await GET(makeReq("Adlon"))).json()
    expect(data[0].kind).toBe("venue")
    expect(data[0].osmValue).toBe("hotel")
  })

  it("skips street (highway) features entirely", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(photonResponse([
      feature("Hauptstraße", { osm_key: "highway", osm_value: "residential", type: "street", countrycode: "DE" }),
      cityFeature("Hamburg"),
    ])))
    const data = await (await GET(makeReq("Haupt"))).json()
    expect(data).toHaveLength(1)
    expect(data[0].name).toBe("Hamburg")
  })

  // ── Ordering and caps ───────────────────────────────────────────────────────

  it("returns areas before venues regardless of Photon order", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(photonResponse([
      venueFeature("Restaurant Essen"),
      cityFeature("Essen"),
    ])))
    const data = await (await GET(makeReq("Essen"))).json()
    expect(data.map((d: { kind: string }) => d.kind)).toEqual(["area", "venue"])
  })

  it("caps areas at 3 and venues at 5", async () => {
    const features = [
      ...[1, 2, 3, 4, 5].map((i) => cityFeature(`Stadt${i}`)),
      ...[1, 2, 3, 4, 5, 6, 7].map((i) => venueFeature(`Lokal${i}`)),
    ]
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(photonResponse(features)))
    const data = await (await GET(makeReq("Test"))).json()
    const kinds = data.map((d: { kind: string }) => d.kind)
    expect(kinds.filter((k: string) => k === "area")).toHaveLength(3)
    expect(kinds.filter((k: string) => k === "venue")).toHaveLength(5)
  })

  // ── Filtering & dedupe ──────────────────────────────────────────────────────

  it("excludes explicit non-DACH country codes but keeps missing ones", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(photonResponse([
      venueFeature("London Pub", { countrycode: "GB" }),
      feature("Namenlos-POI", { osm_key: "amenity", osm_value: "cafe", type: "house" }), // no countrycode
    ])))
    const data = await (await GET(makeReq("Pub"))).json()
    expect(data).toHaveLength(1)
    expect(data[0].name).toBe("Namenlos-POI")
  })

  it("filters out features with empty name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(photonResponse([
      venueFeature(""),
      cityFeature("Berlin"),
    ])))
    const data = await (await GET(makeReq("Berlin"))).json()
    expect(data).toHaveLength(1)
  })

  it("deduplicates identical display strings across groups", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(photonResponse([
      cityFeature("Berlin"),
      cityFeature("Berlin"),
    ])))
    const data = await (await GET(makeReq("Berlin"))).json()
    expect(data).toHaveLength(1)
  })

  // ── Query forwarding ────────────────────────────────────────────────────────

  it("does not restrict Photon layers", async () => {
    const mockFetch = vi.fn().mockResolvedValue(photonResponse([]))
    vi.stubGlobal("fetch", mockFetch)
    await GET(makeReq("Wien"))
    expect(mockFetch.mock.calls[0][0]).not.toContain("layer=")
  })

  it("forwards valid lat/lon bias to Photon", async () => {
    const mockFetch = vi.fn().mockResolvedValue(photonResponse([]))
    vi.stubGlobal("fetch", mockFetch)
    await GET(makeReq("Wien", "&lat=48.2&lon=16.37"))
    const url: string = mockFetch.mock.calls[0][0]
    expect(url).toContain("lat=48.2")
    expect(url).toContain("lon=16.37")
  })

  it("drops invalid lat/lon bias instead of forwarding it", async () => {
    const mockFetch = vi.fn().mockResolvedValue(photonResponse([]))
    vi.stubGlobal("fetch", mockFetch)
    await GET(makeReq("Wien", "&lat=999&lon=abc"))
    const url: string = mockFetch.mock.calls[0][0]
    expect(url).not.toContain("lat=")
    expect(url).not.toContain("lon=")
  })

  it("includes the DACH bounding box", async () => {
    const mockFetch = vi.fn().mockResolvedValue(photonResponse([]))
    vi.stubGlobal("fetch", mockFetch)
    await GET(makeReq("Zürich"))
    expect(mockFetch.mock.calls[0][0]).toContain("bbox=")
  })
})
