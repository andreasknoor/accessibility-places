import { describe, it, expect, vi, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { usePlaceImage } from "@/hooks/usePlaceImage"
import { useResolvedAddress } from "@/hooks/useResolvedAddress"
import { emptyAttribute } from "@/lib/matching/merge"
import type { Place } from "@/lib/types"

// Hooks extracted from PlaceDebugSheet for the shared detail view
// (see CLAUDE.md, "Detail view").

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "Test",
    category: "museum",
    address: { street: "", houseNumber: "", postalCode: "", city: "", country: "DE" },
    coordinates: { lat: 52.5, lon: 13.4 },
    accessibility: { entrance: emptyAttribute(), toilet: emptyAttribute(), parking: emptyAttribute() },
    overallConfidence: 0,
    primarySource: "osm",
    sourceRecords: [],
    ...overrides,
  }
}

const osmWith = (metadata: Record<string, unknown>) =>
  makePlace({ sourceRecords: [{ sourceId: "osm", externalId: "node/1", fetchedAt: "", metadata }] })

afterEach(() => { vi.unstubAllGlobals() })

describe("usePlaceImage", () => {
  it("returns null without an OSM record", () => {
    const { result } = renderHook(() => usePlaceImage(makePlace()))
    expect(result.current).toBeNull()
  })

  it("uses an http image tag directly", () => {
    const { result } = renderHook(() => usePlaceImage(osmWith({ image: "https://example.com/a.jpg" })))
    expect(result.current).toBe("https://example.com/a.jpg")
  })

  it("resolves a Commons File: image tag to a Special:FilePath URL", () => {
    const { result } = renderHook(() => usePlaceImage(osmWith({ image: "File:Foo bar.jpg" })))
    expect(result.current).toContain("Special:FilePath/Foo%20bar.jpg")
  })

  it("falls back to the wikimedia_commons tag", () => {
    const { result } = renderHook(() => usePlaceImage(osmWith({ wikimedia_commons: "File:X.png" })))
    expect(result.current).toContain("Special:FilePath/X.png")
  })

  it("looks up the Wikidata P18 image when no image tag exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ entities: { Q42: { claims: { P18: [{ mainsnak: { datavalue: { value: "Some Photo.jpg" } } }] } } } }),
    })
    vi.stubGlobal("fetch", fetchMock)
    const { result } = renderHook(() => usePlaceImage(osmWith({ wikidata: "Q42" })))
    await waitFor(() => expect(result.current).toContain("Special:FilePath/Some_Photo.jpg"))
    expect(fetchMock.mock.calls[0][0]).toContain("ids=Q42")
  })

  it("does not query Wikidata when an image tag is present", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    renderHook(() => usePlaceImage(osmWith({ image: "https://example.com/a.jpg", wikidata: "Q42" })))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("useResolvedAddress", () => {
  it("formats the place's own address without a network call", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const place = makePlace({ address: { street: "Hauptstraße", houseNumber: "5", postalCode: "10115", city: "Berlin", country: "DE" } })
    const { result } = renderHook(() => useResolvedAddress(place))
    expect(result.current).toBe("Hauptstraße 5, 10115 Berlin")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("reverse-geocodes when the place has no address", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ street: "Weg", houseNumber: "1", postalCode: "12345", city: "Ort" }) }))
    const { result } = renderHook(() => useResolvedAddress(makePlace()))
    await waitFor(() => expect(result.current).toBe("Weg 1, 12345 Ort"))
  })
})
