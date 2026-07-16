import { describe, it, expect } from "vitest"
import {
  rerunTarget,
  expandRadiusTarget,
  canShowResultsRadiusPicker,
  clampAmenityRadiusKm,
  snapAmenityRadiusKm,
  clampVenueRadiusKm,
  snapVenueRadiusKm,
  venueViewportOrigin,
  amenityViewportOrigin,
  amenitySpotKey,
  formatRadiusKm,
  headerRadiusControl,
  RADIUS_PRESETS_KM,
  AMENITY_RADIUS_PRESETS_KM,
  AMENITY_RADIUS_MIN_KM,
  AMENITY_RADIUS_MAX_KM,
} from "@/lib/search-ui"
import { SETTINGS_PARKING_RADIUS_MAX_KM } from "@/lib/settings"
import { RADIUS_MIN_KM, RADIUS_MAX_KM } from "@/lib/config"

const center = { lat: 52.5, lon: 13.4 }

describe("rerunTarget — finding F2 (Rerun must never resurrect a stale venue search during an amenity search)", () => {
  it("targets the amenity search when one is active, regardless of a leftover venue query", () => {
    expect(rerunTarget({
      amenityActive: true,
      amenitySearch: "parking",
      amenitySearchCenter: center,
      lastQuery: "Restaurants in Berlin",
    })).toBe("amenity")
  })

  it("does not target venue when amenity is active even though lastQuery is set", () => {
    const result = rerunTarget({
      amenityActive: true,
      amenitySearch: "toilet",
      amenitySearchCenter: center,
      lastQuery: "Cafés in Hamburg",
    })
    expect(result).not.toBe("venue")
  })

  it("targets venue when no amenity search is active — regardless of chat mode (text or nearby): 'Filter anwenden' is the only way to re-run a search after a filter change since the old always-visible search button was removed, so it can't be restricted to nearby mode alone", () => {
    expect(rerunTarget({
      amenityActive: false,
      amenitySearch: null,
      amenitySearchCenter: undefined,
      lastQuery: "Restaurants in Berlin",
    })).toBe("venue")
  })

  it("targets none when amenity is active but its search center is unknown", () => {
    expect(rerunTarget({
      amenityActive: true,
      amenitySearch: "parking",
      amenitySearchCenter: undefined,
      lastQuery: undefined,
    })).toBe("none")
  })

  it("targets none with no amenity search and no query", () => {
    expect(rerunTarget({
      amenityActive: false,
      amenitySearch: null,
      amenitySearchCenter: undefined,
      lastQuery: undefined,
    })).toBe("none")
  })
})

describe("expandRadiusTarget — finding F6a (amenity empty state needs its own expand action)", () => {
  it("targets the amenity search when active and not yet at the max radius", () => {
    expect(expandRadiusTarget({
      amenityActive: true,
      amenitySearch: "parking",
      amenitySearchCenter: center,
      amenityRadiusKm: 1,
      lastQuery: undefined,
      radiusKm: 5,
    })).toBe("amenity")
  })

  it("targets amenity even when a stale venue lastQuery exists", () => {
    const result = expandRadiusTarget({
      amenityActive: true,
      amenitySearch: "toilet",
      amenitySearchCenter: center,
      amenityRadiusKm: 1,
      lastQuery: "Restaurants in Berlin",
      radiusKm: 5,
    })
    expect(result).not.toBe("venue")
    expect(result).toBe("amenity")
  })

  it("is available for a first-ever amenity search with no prior venue query at all", () => {
    expect(expandRadiusTarget({
      amenityActive: true,
      amenitySearch: "parking",
      amenitySearchCenter: center,
      amenityRadiusKm: 0.5,
      lastQuery: undefined,
      radiusKm: 5,
    })).toBe("amenity")
  })

  it("targets none for amenity already at the max radius", () => {
    expect(expandRadiusTarget({
      amenityActive: true,
      amenitySearch: "parking",
      amenitySearchCenter: center,
      amenityRadiusKm: AMENITY_RADIUS_MAX_KM,
      lastQuery: undefined,
      radiusKm: 5,
    })).toBe("none")
  })

  it("targets venue when no amenity search is active and a venue query exists below max radius", () => {
    expect(expandRadiusTarget({
      amenityActive: false,
      amenitySearch: null,
      amenitySearchCenter: undefined,
      amenityRadiusKm: 4,
      lastQuery: "Restaurants in Berlin",
      radiusKm: 5,
    })).toBe("venue")
  })
})

describe("canShowResultsRadiusPicker — finding F3/F4 (single radius source of truth)", () => {
  it("is hidden during an amenity search (radius is set via FilterPanel's amenity slider only)", () => {
    expect(canShowResultsRadiusPicker(true)).toBe(false)
  })

  it("is shown for a normal venue search", () => {
    expect(canShowResultsRadiusPicker(false)).toBe(true)
  })
})

describe("clampAmenityRadiusKm", () => {
  it("clamps below the minimum", () => {
    expect(clampAmenityRadiusKm(0)).toBe(AMENITY_RADIUS_MIN_KM)
  })

  it("clamps above the maximum", () => {
    expect(clampAmenityRadiusKm(99)).toBe(AMENITY_RADIUS_MAX_KM)
  })

  it("passes through an in-range value", () => {
    expect(clampAmenityRadiusKm(2)).toBe(2)
  })
})

describe("snapAmenityRadiusKm — viewport radius reads cleanly in the results list", () => {
  it("snaps a many-decimal viewport float to 0.1 km", () => {
    expect(snapAmenityRadiusKm(0.3478234123)).toBe(0.3)
    expect(snapAmenityRadiusKm(1.2487)).toBe(1.2)
  })

  it("produces a value that stringifies without float noise (the reported bug)", () => {
    // n/10 always round-trips to the shortest clean decimal in JS, unlike 0.1+0.2.
    expect(`${snapAmenityRadiusKm(0.3478234123)} km`).toBe("0.3 km")
  })

  it("still respects the amenity clamp bounds", () => {
    expect(snapAmenityRadiusKm(99)).toBe(AMENITY_RADIUS_MAX_KM)
    expect(snapAmenityRadiusKm(0.01)).toBe(AMENITY_RADIUS_MIN_KM)
  })
})

describe("clampVenueRadiusKm — viewport-origin venue chip stays in the 1-50km domain", () => {
  it("clamps to the venue bounds", () => {
    expect(clampVenueRadiusKm(0.2)).toBe(RADIUS_MIN_KM)
    expect(clampVenueRadiusKm(999)).toBe(RADIUS_MAX_KM)
    expect(clampVenueRadiusKm(12)).toBe(12)
  })
})

describe("venueViewportOrigin / amenityViewportOrigin — map-viewport-as-search-origin", () => {
  const vp = { center: { lat: 52.5, lon: 13.4 }, radiusKm: 8.4 }

  it("returns null when there is no pending pan (cold map / focus mode / post-search — MapView reports null)", () => {
    expect(venueViewportOrigin(null)).toBeNull()
    expect(venueViewportOrigin(undefined)).toBeNull()
    expect(amenityViewportOrigin(null)).toBeNull()
    expect(amenityViewportOrigin(undefined)).toBeNull()
  })

  it("passes the centre through unchanged so the search is centred on the visible area", () => {
    expect(venueViewportOrigin(vp)?.center).toEqual(vp.center)
    expect(amenityViewportOrigin(vp)?.center).toEqual(vp.center)
  })

  it("clamps the venue radius into 1-50km", () => {
    expect(venueViewportOrigin({ center: vp.center, radiusKm: 0.2 })?.radiusKm).toBe(RADIUS_MIN_KM)
    expect(venueViewportOrigin({ center: vp.center, radiusKm: 80 })?.radiusKm).toBe(RADIUS_MAX_KM)
    expect(venueViewportOrigin(vp)?.radiusKm).toBe(8.4)
  })

  it("snaps the venue radius to one decimal so the FilterPanel slider stays clean", () => {
    expect(venueViewportOrigin({ center: vp.center, radiusKm: 12.3478234123 })?.radiusKm).toBe(12.3)
    expect(snapVenueRadiusKm(12.3478234123)).toBe(12.3)
    expect(snapVenueRadiusKm(7.96)).toBe(8)
  })

  it("snaps + clamps the amenity radius into the 0.05-25km domain", () => {
    // 8.4 km viewport passes through since the client max matches the server
    // cap (25 km) — the point of "search this area" on a zoomed-out map.
    expect(amenityViewportOrigin(vp)?.radiusKm).toBe(8.4)
    expect(amenityViewportOrigin({ center: vp.center, radiusKm: 80 })?.radiusKm).toBe(AMENITY_RADIUS_MAX_KM)
    expect(amenityViewportOrigin({ center: vp.center, radiusKm: 0.3478 })?.radiusKm).toBe(0.3)
    expect(amenityViewportOrigin({ center: vp.center, radiusKm: 0.001 })?.radiusKm).toBe(AMENITY_RADIUS_MIN_KM)
  })
})

describe("amenitySpotKey — stable identity shared by map markers and result list (map↔list highlight)", () => {
  it("prefers the OSM id when present", () => {
    expect(amenitySpotKey({ osmId: "node/123", lat: 52.5, lon: 13.4 })).toBe("node/123")
  })

  it("falls back to coordinates when there is no OSM id", () => {
    expect(amenitySpotKey({ lat: 52.5, lon: 13.4 })).toBe("52.5,13.4")
  })

  it("is index-independent so a marker (which has no list index) and its card resolve to the same key", () => {
    const spot = { osmId: "way/42", lat: 48.1, lon: 11.6 }
    // The marker passes only osmId/lat/lon; the list passes the full feature.
    expect(amenitySpotKey(spot)).toBe(amenitySpotKey({ ...spot, capacity: 3 } as never))
  })
})

describe("formatRadiusKm — venue domain (default, amenityMode omitted/false)", () => {
  it("rounds to a whole km number — the venue radiusKm can be a raw viewport-derived float after 'Hier suchen'", () => {
    expect(formatRadiusKm(12.3)).toBe("12 km")
    expect(formatRadiusKm(12.6)).toBe("13 km")
    expect(formatRadiusKm(8.5)).toBe("9 km") // round-half-up, same as Math.round
  })

  it("never renders a metres value, even for a sub-1km input", () => {
    expect(formatRadiusKm(0.4)).not.toMatch(/ m$/)
    expect(formatRadiusKm(0.99)).not.toMatch(/ m$/)
  })

  it("floors any sub-1km value to '1 km' (the venue domain's own floor, RADIUS_MIN_KM)", () => {
    expect(formatRadiusKm(0.4)).toBe("1 km")
    expect(formatRadiusKm(0.99)).toBe("1 km")
    expect(formatRadiusKm(0)).toBe("1 km")
  })

  it("renders already-whole km values unchanged", () => {
    expect(formatRadiusKm(1)).toBe("1 km")
    expect(formatRadiusKm(5)).toBe("5 km")
    expect(formatRadiusKm(50)).toBe("50 km")
  })
})

describe("formatRadiusKm — amenity domain (amenityMode=true), unchanged sub-km metres display", () => {
  it("renders sub-km radii in metres", () => {
    expect(formatRadiusKm(0.25, true)).toBe("250 m")
    expect(formatRadiusKm(0.1, true)).toBe("100 m")
    expect(formatRadiusKm(0.05, true)).toBe("50 m")
  })

  it("renders 1km and above in kilometres, never as a metres value", () => {
    expect(formatRadiusKm(1, true)).toBe("1 km")
    expect(formatRadiusKm(5, true)).toBe("5 km")
  })

  it("rounds fractional metres to the nearest whole metre", () => {
    expect(formatRadiusKm(0.3478, true)).toBe("348 m")
  })

  it("does NOT round a fractional km value (unlike the venue domain)", () => {
    expect(formatRadiusKm(2.7, true)).toBe("2.7 km")
  })
})

describe("radius preset lists — sanity + no cross-domain leakage", () => {
  it("venue presets are ascending and inside the venue domain (RADIUS_MIN_KM-RADIUS_MAX_KM)", () => {
    expect([...RADIUS_PRESETS_KM]).toEqual([...RADIUS_PRESETS_KM].sort((a, b) => a - b))
    for (const km of RADIUS_PRESETS_KM) {
      expect(km).toBeGreaterThanOrEqual(RADIUS_MIN_KM)
      expect(km).toBeLessThanOrEqual(RADIUS_MAX_KM)
    }
  })

  it("amenity presets are ascending and inside the persisted-default domain (AMENITY_RADIUS_MIN_KM-SETTINGS_PARKING_RADIUS_MAX_KM)", () => {
    expect([...AMENITY_RADIUS_PRESETS_KM]).toEqual([...AMENITY_RADIUS_PRESETS_KM].sort((a, b) => a - b))
    for (const km of AMENITY_RADIUS_PRESETS_KM) {
      expect(km).toBeGreaterThanOrEqual(AMENITY_RADIUS_MIN_KM)
      expect(km).toBeLessThanOrEqual(SETTINGS_PARKING_RADIUS_MAX_KM)
    }
  })

  it("includes the persisted parkingRadiusKm default, so a first-time header-pill open highlights an active preset", async () => {
    const { DEFAULT_APP_SETTINGS } = await import("@/lib/settings")
    expect(AMENITY_RADIUS_PRESETS_KM as readonly number[]).toContain(DEFAULT_APP_SETTINGS.parkingRadiusKm)
  })
})

describe("headerRadiusControl — always-visible header radius pill's domain switch", () => {
  it("picks the venue presets + onRadiusChange when no amenity search is active", () => {
    const onRadiusChange = () => {}
    const onAmenityRadius = () => {}
    const result = headerRadiusControl({ amenityActive: false, onRadiusChange, onAmenityRadius })
    expect(result.presets).toBe(RADIUS_PRESETS_KM)
    expect(result.onChange).toBe(onRadiusChange)
    expect(result.amenityMode).toBe(false)
  })

  it("picks the amenity presets + onAmenityRadius when an amenity search is active", () => {
    const onRadiusChange = () => {}
    const onAmenityRadius = () => {}
    const result = headerRadiusControl({ amenityActive: true, onRadiusChange, onAmenityRadius })
    expect(result.presets).toBe(AMENITY_RADIUS_PRESETS_KM)
    expect(result.onChange).toBe(onAmenityRadius)
    expect(result.amenityMode).toBe(true)
  })

  it("never returns the venue handler while amenity-active, even though both are supplied (no cross-domain wiring)", () => {
    const onRadiusChange = () => {}
    const onAmenityRadius = () => {}
    const result = headerRadiusControl({ amenityActive: true, onRadiusChange, onAmenityRadius })
    expect(result.onChange).not.toBe(onRadiusChange)
  })

  it("degrades to a non-interactive trigger (onChange undefined) when the matching handler is absent", () => {
    expect(headerRadiusControl({ amenityActive: false, onAmenityRadius: () => {} }).onChange).toBeUndefined()
    expect(headerRadiusControl({ amenityActive: true, onRadiusChange: () => {} }).onChange).toBeUndefined()
  })
})
