// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/geocode/suggest/route"

function makeReq(q: string, lang = "de"): NextRequest {
  return new NextRequest(`http://localhost/api/geocode/suggest?q=${encodeURIComponent(q)}&lang=${lang}`)
}

function photonResponse(features: object[]): Response {
  return new Response(JSON.stringify({ type: "FeatureCollection", features }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

function feature(name: string, city?: string) {
  return {
    type: "Feature",
    properties: { name, ...(city ? { city } : {}) },
    geometry: { type: "Point", coordinates: [0, 0] },
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("GET /api/geocode/suggest", () => {

  // ── Input validation ────────────────────────────────────────────────────────

  it("returns [] for missing q", async () => {
    const req = new NextRequest("http://localhost/api/geocode/suggest")
    const res = await GET(req)
    expect(await res.json()).toEqual([])
  })

  it("returns [] for q shorter than 2 chars", async () => {
    const res = await GET(makeReq("B"))
    expect(await res.json()).toEqual([])
  })

  // ── Upstream failure handling ───────────────────────────────────────────────

  it("returns [] when Photon responds with non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    const res = await GET(makeReq("Berlin"))
    expect(await res.json()).toEqual([])
  })

  it("returns [] when fetch throws (network error / timeout)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")))
    const res = await GET(makeReq("Berlin"))
    expect(await res.json()).toEqual([])
  })

  it("returns [] when Photon returns no features array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    ))
    const res = await GET(makeReq("Berlin"))
    expect(await res.json()).toEqual([])
  })

  // ── Feature mapping ─────────────────────────────────────────────────────────

  it("uses name alone when no city present", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      photonResponse([feature("Berlin")]),
    ))
    const data = await (await GET(makeReq("Berlin"))).json()
    expect(data).toEqual([{ display: "Berlin", name: "Berlin" }])
  })

  it("uses 'name, city' display when city differs from name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      photonResponse([feature("Mitte", "Berlin")]),
    ))
    const data = await (await GET(makeReq("Mitte"))).json()
    expect(data).toEqual([{ display: "Mitte, Berlin", name: "Mitte" }])
  })

  it("omits city from display when city equals name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      photonResponse([feature("Berlin", "Berlin")]),
    ))
    const data = await (await GET(makeReq("Berlin"))).json()
    expect(data).toEqual([{ display: "Berlin", name: "Berlin" }])
  })

  it("falls back to county when city is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      photonResponse([{
        type: "Feature",
        properties: { name: "Kleinstadt", county: "Musterkreis" },
        geometry: { type: "Point", coordinates: [0, 0] },
      }]),
    ))
    const data = await (await GET(makeReq("Kleinstadt"))).json()
    expect(data[0].display).toBe("Kleinstadt, Musterkreis")
  })

  it("filters out features with empty name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      photonResponse([feature(""), feature("Berlin")]),
    ))
    const data = await (await GET(makeReq("Berlin"))).json()
    expect(data).toHaveLength(1)
    expect(data[0].name).toBe("Berlin")
  })

  it("deduplicates identical display strings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      photonResponse([feature("Berlin"), feature("Berlin"), feature("Hamburg")]),
    ))
    const data = await (await GET(makeReq("Berlin"))).json()
    const displays = data.map((d: { display: string }) => d.display)
    expect(displays).toEqual(["Berlin", "Hamburg"])
  })

  // ── Query forwarding ────────────────────────────────────────────────────────

  it("forwards the lang parameter to Photon", async () => {
    const mockFetch = vi.fn().mockResolvedValue(photonResponse([]))
    vi.stubGlobal("fetch", mockFetch)
    await GET(makeReq("Wien", "en"))
    const calledUrl: string = mockFetch.mock.calls[0][0]
    expect(calledUrl).toContain("lang=en")
  })

  it("includes all required Photon layers in the URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue(photonResponse([]))
    vi.stubGlobal("fetch", mockFetch)
    await GET(makeReq("Wien"))
    const calledUrl: string = mockFetch.mock.calls[0][0]
    expect(calledUrl).toContain("layer=city")
    expect(calledUrl).toContain("layer=district")
    expect(calledUrl).toContain("layer=locality")
    expect(calledUrl).not.toContain("suburb")
  })

  it("includes the DACH bounding box", async () => {
    const mockFetch = vi.fn().mockResolvedValue(photonResponse([]))
    vi.stubGlobal("fetch", mockFetch)
    await GET(makeReq("Zürich"))
    const calledUrl: string = mockFetch.mock.calls[0][0]
    expect(calledUrl).toContain("bbox=")
  })
})
