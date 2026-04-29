import { describe, it, expect } from "vitest"
import {
  normaliseString,
  trigramSimilarity,
  haversineMetres,
  findMatch,
} from "@/lib/matching/match"
import type { Place } from "@/lib/types"

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "test-id",
    name: "Test Restaurant",
    category: "restaurant",
    address: { street: "Teststraße", houseNumber: "1", postalCode: "10115", city: "Berlin", country: "DE" },
    coordinates: { lat: 52.52, lon: 13.405 },
    accessibility: {
      entrance: { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
      toilet:   { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
      parking:  { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
    },
    overallConfidence: 0,
    primarySource: "osm",
    sourceRecords: [],
    ...overrides,
  }
}

// ─── normaliseString ─────────────────────────────────────────────────────────

describe("normaliseString", () => {
  it("lowercases and normalises German umlauts", () => {
    expect(normaliseString("Straße")).toBe("str.")
    expect(normaliseString("Österreich")).toContain("oe")
    expect(normaliseString("München")).toContain("muenchen")
  })

  it("collapses extra whitespace", () => {
    expect(normaliseString("  hello   world  ")).toBe("hello world")
  })

  it("handles LocalizedString objects { de, en }", () => {
    expect(normaliseString({ de: "Berlin", en: "Berlin" })).toBe("berlin")
    expect(normaliseString({ en: "Vienna" })).toBe("vienna")
  })

  it("handles de-only LocalizedString", () => {
    expect(normaliseString({ de: "München" })).toContain("muenchen")
  })

  it("returns empty string for null / undefined / empty", () => {
    expect(normaliseString(null as unknown as string)).toBe("")
    expect(normaliseString(undefined as unknown as string)).toBe("")
    expect(normaliseString("")).toBe("")
  })

  it("returns empty string for non-string non-object", () => {
    expect(normaliseString(42 as unknown as string)).toBe("")
  })

  it("handles ß → ss", () => {
    expect(normaliseString("Straße")).toBe("str.")
    expect(normaliseString("Weißwurst")).toContain("weisswurst")
  })
})

// ─── trigramSimilarity ───────────────────────────────────────────────────────

describe("trigramSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(trigramSimilarity("pizza", "pizza")).toBe(1)
  })

  it("returns 0 for completely different strings", () => {
    expect(trigramSimilarity("abc", "xyz")).toBe(0)
  })

  it("returns a value in (0, 1) for similar strings", () => {
    const score = trigramSimilarity("Restaurante", "Restaurant")
    expect(score).toBeGreaterThan(0.5)
    expect(score).toBeLessThan(1)
  })

  it("returns 0 for empty string inputs", () => {
    expect(trigramSimilarity("", "hello")).toBe(0)
    expect(trigramSimilarity("hello", "")).toBe(0)
  })

  it("is symmetric", () => {
    const a = trigramSimilarity("Zur Linde", "Linde")
    const b = trigramSimilarity("Linde", "Zur Linde")
    expect(a).toBeCloseTo(b, 5)
  })

  it("handles German restaurant name variations", () => {
    const score = trigramSimilarity("Restaurant Zur Linde", "Zur Linde")
    expect(score).toBeGreaterThan(0.4)
  })
})

// ─── haversineMetres ─────────────────────────────────────────────────────────

describe("haversineMetres", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMetres({ lat: 52.52, lon: 13.405 }, { lat: 52.52, lon: 13.405 })).toBe(0)
  })

  it("is approximately correct for Berlin → Hamburg (~255 km)", () => {
    const dist = haversineMetres(
      { lat: 52.52,  lon: 13.405 }, // Berlin
      { lat: 53.551, lon: 9.993  }, // Hamburg
    )
    expect(dist).toBeGreaterThan(240_000)
    expect(dist).toBeLessThan(270_000)
  })

  it("is symmetric", () => {
    const a = haversineMetres({ lat: 48.137, lon: 11.576 }, { lat: 52.52, lon: 13.405 })
    const b = haversineMetres({ lat: 52.52, lon: 13.405 }, { lat: 48.137, lon: 11.576 })
    expect(a).toBeCloseTo(b, 0)
  })

  it("short distance < 100 m is correct order of magnitude", () => {
    // ~111 m per 0.001° latitude
    const dist = haversineMetres({ lat: 52.520, lon: 13.405 }, { lat: 52.521, lon: 13.405 })
    expect(dist).toBeGreaterThan(80)
    expect(dist).toBeLessThan(130)
  })
})

// ─── findMatch ───────────────────────────────────────────────────────────────

describe("findMatch", () => {
  it("returns -1 for empty canonical list", () => {
    expect(findMatch([], makePlace())).toBe(-1)
  })

  it("matches identical place", () => {
    const place = makePlace({ id: "a" })
    const idx = findMatch([place], makePlace({ id: "b" }))
    expect(idx).toBe(0)
  })

  it("returns -1 when place is far away", () => {
    const berlin  = makePlace({ name: "Café Berlin", coordinates: { lat: 52.52,  lon: 13.405 } })
    const hamburg = makePlace({ name: "Café Berlin", coordinates: { lat: 53.551, lon: 9.993  } })
    expect(findMatch([berlin], hamburg)).toBe(-1)
  })

  it("returns -1 for completely different name nearby", () => {
    const a = makePlace({ name: "Pizzeria Roma",    coordinates: { lat: 52.5200, lon: 13.4050 } })
    const b = makePlace({ name: "Japanisches Bad",  coordinates: { lat: 52.5201, lon: 13.4051 } })
    expect(findMatch([a], b)).toBe(-1)
  })

  it("matches place with slight name variation within 80 m", () => {
    const existing = makePlace({
      name: "Café Zur Linde",
      coordinates: { lat: 52.5200, lon: 13.4050 },
    })
    const incoming = makePlace({
      name: "Cafe Zur Linde",
      coordinates: { lat: 52.5201, lon: 13.4051 },
    })
    expect(findMatch([existing], incoming)).toBe(0)
  })

  it("returns index of best match when multiple candidates", () => {
    const a = makePlace({ name: "Sushi Bar", coordinates: { lat: 52.5200, lon: 13.4050 } })
    const b = makePlace({ name: "Pizza Roma", coordinates: { lat: 52.5200, lon: 13.4050 } })
    const incoming = makePlace({ name: "Sushi Bar", coordinates: { lat: 52.5201, lon: 13.4051 } })
    expect(findMatch([a, b], incoming)).toBe(0)
  })
})
