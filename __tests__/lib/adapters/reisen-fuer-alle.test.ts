// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fetchReisenFuerAlle } from "@/lib/adapters/reisen-fuer-alle"
import type { SearchParams } from "@/lib/types"

const BASE_PARAMS: SearchParams = {
  query: "restaurants in Berlin",
  location: { lat: 52.52, lon: 13.405 },
  radiusKm: 5,
  categories: ["restaurant"],
  filters: { entrance: true, toilet: true, parking: false, seating: false, onlyVerified: false, acceptUnknown: false },
  sources: { accessibility_cloud: false, osm: false, reisen_fuer_alle: true, google_places: false, ginto: false },
}

const ITEM = {
  id: "rfa-1",
  name: "Barrierefreies Café",
  lat: "52.521",
  lon: "13.406",
  type: "restaurant",
  street: "Unter den Linden",
  houseNumber: "10",
  zip: "10117",
  city: "Berlin",
  country: "DE",
  criteria: [
    { code: "E01", fulfilled: true },
    { code: "E02", fulfilled: true,  value: 90 },
    { code: "E03", fulfilled: true },
    { code: "T01", fulfilled: true },
    { code: "T02", fulfilled: true,  value: 150 },
    { code: "T03", fulfilled: true,  value: 80 },
    { code: "P01", fulfilled: true,  value: 2 },
  ],
}

describe("fetchReisenFuerAlle", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv("REISEN_FUER_ALLE_API_KEY",  "test-key")
    vi.stubEnv("REISEN_FUER_ALLE_API_BASE", "https://api.reisen-fuer-alle.de/v1")
  })

  it("returns empty array when API key is missing", async () => {
    vi.stubEnv("REISEN_FUER_ALLE_API_KEY", "")
    const result = await fetchReisenFuerAlle(BASE_PARAMS)
    expect(result).toEqual([])
  })

  it("returns empty array when API base is missing", async () => {
    vi.stubEnv("REISEN_FUER_ALLE_API_BASE", "")
    const result = await fetchReisenFuerAlle(BASE_PARAMS)
    expect(result).toEqual([])
  })

  it("returns empty array for placeholder key values", async () => {
    vi.stubEnv("REISEN_FUER_ALLE_API_KEY",  "your_api_key")
    vi.stubEnv("REISEN_FUER_ALLE_API_BASE", "your_api_base")
    const result = await fetchReisenFuerAlle(BASE_PARAMS)
    expect(result).toEqual([])
  })

  it("throws on non-200 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    await expect(fetchReisenFuerAlle(BASE_PARAMS)).rejects.toThrow("401")
  })

  it("returns empty array when response contains no items", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    }))
    const result = await fetchReisenFuerAlle(BASE_PARAMS)
    expect(result).toEqual([])
  })

  it("parses a fully certified place", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [ITEM] }),
    }))
    const [p] = await fetchReisenFuerAlle(BASE_PARAMS)
    expect(p.name).toBe("Barrierefreies Café")
    expect(p.address.street).toBe("Unter den Linden")
    expect(p.address.city).toBe("Berlin")
    expect(p.coordinates.lat).toBeCloseTo(52.521)
    expect(p.coordinates.lon).toBeCloseTo(13.406)
    expect(p.accessibility.entrance.value).toBe("yes")
    expect(p.accessibility.toilet.value).toBe("yes")
    expect(p.accessibility.parking.value).toBe("yes")
    expect(p.primarySource).toBe("reisen_fuer_alle")
  })

  it("returns 'limited' when only some criteria are fulfilled", async () => {
    const partial = {
      ...ITEM,
      criteria: [
        { code: "E01", fulfilled: true  },
        { code: "E02", fulfilled: false },
        { code: "E03", fulfilled: false },
      ],
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [partial] }),
    }))
    const [p] = await fetchReisenFuerAlle(BASE_PARAMS)
    expect(p.accessibility.entrance.value).toBe("limited")
  })

  it("returns 'no' when all entrance criteria are not fulfilled", async () => {
    const allNo = {
      ...ITEM,
      criteria: [
        { code: "E01", fulfilled: false },
        { code: "E02", fulfilled: false },
        { code: "E03", fulfilled: false },
      ],
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [allNo] }),
    }))
    const [p] = await fetchReisenFuerAlle(BASE_PARAMS)
    expect(p.accessibility.entrance.value).toBe("no")
  })

  it("returns 'unknown' when no relevant criteria present", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ ...ITEM, criteria: [] }] }),
    }))
    const [p] = await fetchReisenFuerAlle(BASE_PARAMS)
    expect(p.accessibility.entrance.value).toBe("unknown")
  })

  it("skips items without a name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ ...ITEM, name: undefined }] }),
    }))
    const result = await fetchReisenFuerAlle(BASE_PARAMS)
    expect(result).toHaveLength(0)
  })

  it("skips items with zero coordinates", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ ...ITEM, lat: "0", lon: "0" }] }),
    }))
    const result = await fetchReisenFuerAlle(BASE_PARAMS)
    expect(result).toHaveLength(0)
  })

  it("combines user signal with timeout so client disconnect aborts the fetch (Bug 3)", async () => {
    const controller = new AbortController()
    let capturedSignal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: unknown, init: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) })
    }))

    await fetchReisenFuerAlle({ ...BASE_PARAMS, signal: controller.signal })

    expect(capturedSignal).toBeDefined()
    expect(capturedSignal!.aborted).toBe(false)
    controller.abort()
    expect(capturedSignal!.aborted).toBe(true)
  })
})
