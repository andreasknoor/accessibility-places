// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  regionForCoordinates,
  endpointsForCoordinates,
  countryCodesParam,
  PUBLIC_OVERPASS_ENDPOINTS,
  OVERPASS_ENDPOINTS,
} from "@/lib/config"

describe("regionForCoordinates", () => {
  it("classifies DACH cities as 'dach'", () => {
    expect(regionForCoordinates(52.52, 13.405)).toBe("dach")  // Berlin
    expect(regionForCoordinates(48.21, 16.37)).toBe("dach")   // Vienna
    expect(regionForCoordinates(47.37, 8.54)).toBe("dach")    // Zurich
  })

  it("classifies in-allowlist international cities as 'intl'", () => {
    expect(regionForCoordinates(48.857, 2.352)).toBe("intl")   // Paris
    expect(regionForCoordinates(51.507, -0.128)).toBe("intl")  // London
    expect(regionForCoordinates(52.37, 4.90)).toBe("intl")     // Amsterdam
    expect(regionForCoordinates(40.42, -3.70)).toBe("intl")    // Madrid
    expect(regionForCoordinates(41.90, 12.50)).toBe("intl")    // Rome
    expect(regionForCoordinates(40.71, -74.0)).toBe("intl")    // New York
  })

  it("classifies out-of-allowlist coordinates as 'outside'", () => {
    expect(regionForCoordinates(59.33, 18.06)).toBe("outside")  // Stockholm (not in allowlist)
    expect(regionForCoordinates(-33.87, 151.21)).toBe("outside") // Sydney
    expect(regionForCoordinates(35.68, 139.76)).toBe("outside")  // Tokyo
  })

  it("resolves DACH-border overlaps to 'dach' (FR box overlaps Switzerland)", () => {
    // Geneva sits inside both the DACH box and the FR box; DACH must win so the
    // private server is used and the empty-race edge case is avoided.
    expect(regionForCoordinates(46.20, 6.14)).toBe("dach")
  })
})

describe("endpointsForCoordinates", () => {
  it("returns the full list (private server included) for DACH regardless of mode", () => {
    expect(endpointsForCoordinates(52.52, 13.405, false)).toEqual(OVERPASS_ENDPOINTS)
    expect(endpointsForCoordinates(52.52, 13.405, true)).toEqual(OVERPASS_ENDPOINTS)
  })

  it("returns the full list when international mode is off, even outside DACH", () => {
    expect(endpointsForCoordinates(48.857, 2.352, false)).toEqual(OVERPASS_ENDPOINTS)
  })

  it("drops the private (non-public) server outside DACH in international mode", () => {
    const eps = endpointsForCoordinates(48.857, 2.352, true) // Paris
    // Every returned endpoint must be a known public mirror.
    for (const e of eps) expect(PUBLIC_OVERPASS_ENDPOINTS).toContain(e)
    // And it must not contain anything that isn't public (e.g. a private server).
    const privateOnes = OVERPASS_ENDPOINTS.filter((e) => !PUBLIC_OVERPASS_ENDPOINTS.includes(e))
    for (const p of privateOnes) expect(eps).not.toContain(p)
  })
})

describe("countryCodesParam", () => {
  it("returns only DACH codes when international mode is off", () => {
    expect(countryCodesParam(false)).toBe("de,at,ch")
  })

  it("includes the international allowlist when on", () => {
    const codes = countryCodesParam(true).split(",")
    expect(codes).toContain("de")
    expect(codes).toContain("fr")
    expect(codes).toContain("us")
    expect(codes).toContain("gb")
  })
})
