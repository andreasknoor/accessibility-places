// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { GET as geocodeGET }        from "@/app/api/geocode/route"
import { GET as reverseGET }        from "@/app/api/geocode/reverse/route"

function makeGeoReq(q: string): NextRequest {
  return new NextRequest(`http://localhost/api/geocode?q=${encodeURIComponent(q)}`)
}

function makeRevReq(lat: string, lon: string): NextRequest {
  return new NextRequest(`http://localhost/api/geocode/reverse?lat=${lat}&lon=${lon}`)
}

// ─── GET /api/geocode ─────────────────────────────────────────────────────────

describe("GET /api/geocode", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("returns 400 when q is missing", async () => {
    const req = new NextRequest("http://localhost/api/geocode")
    const res = await geocodeGET(req)
    expect(res.status).toBe(400)
  })

  it("returns 502 when Nominatim is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    const res = await geocodeGET(makeGeoReq("Berlin"))
    expect(res.status).toBe(502)
  })

  it("returns 404 when Nominatim finds nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    const res = await geocodeGET(makeGeoReq("xyzzy-no-such-place"))
    expect(res.status).toBe(404)
  })

  it("returns lat/lon/displayName on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => [{ lat: "52.5200066", lon: "13.404954", display_name: "Berlin, Deutschland" }],
    }))
    const res  = await geocodeGET(makeGeoReq("Berlin"))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.lat).toBeCloseTo(52.52)
    expect(body.lon).toBeCloseTo(13.404)
    expect(body.displayName).toBe("Berlin, Deutschland")
  })

  it("restricts query to DACH (countrycodes param in upstream URL)", async () => {
    let capturedUrl = ""
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      capturedUrl = url
      return Promise.resolve({ ok: true, json: async () => [{ lat: "52.52", lon: "13.4", display_name: "Berlin" }] })
    }))
    await geocodeGET(makeGeoReq("Berlin"))
    expect(capturedUrl).toContain("countrycodes=de,at,ch")
  })
})

// ─── GET /api/geocode/reverse ─────────────────────────────────────────────────

describe("GET /api/geocode/reverse", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("returns 400 for missing coordinates", async () => {
    const req = new NextRequest("http://localhost/api/geocode/reverse")
    const res = await reverseGET(req)
    expect(res.status).toBe(400)
  })

  it("returns 400 for out-of-range lat", async () => {
    const res = await reverseGET(makeRevReq("91", "13.4"))
    expect(res.status).toBe(400)
  })

  it("returns 400 for out-of-range lon", async () => {
    const res = await reverseGET(makeRevReq("52.52", "181"))
    expect(res.status).toBe(400)
  })

  it("returns 400 for non-numeric values", async () => {
    const res = await reverseGET(makeRevReq("notanumber", "13.4"))
    expect(res.status).toBe(400)
  })

  it("returns 502 when Nominatim is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    const res = await reverseGET(makeRevReq("52.52", "13.405"))
    expect(res.status).toBe(502)
  })

  it("returns 502 on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failure")))
    const res = await reverseGET(makeRevReq("52.52", "13.405"))
    expect(res.status).toBe(502)
  })

  it("extracts suburb as district", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ address: { suburb: "Mitte", city: "Berlin" } }),
    }))
    const res  = await reverseGET(makeRevReq("52.52", "13.405"))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.district).toBe("Mitte")
  })

  it("falls back to city when suburb is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ address: { city: "Hamburg" } }),
    }))
    const body = await (await reverseGET(makeRevReq("53.55", "9.99"))).json()
    expect(body.district).toBe("Hamburg")
  })

  it("returns empty district string when address is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ address: {} }),
    }))
    const body = await (await reverseGET(makeRevReq("52.52", "13.405"))).json()
    expect(body.district).toBe("")
  })
})
