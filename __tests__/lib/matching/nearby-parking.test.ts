import { describe, it, expect } from "vitest"
import {
  enrichWithNearbyParking,
  haversineMeters,
  DEFAULT_MAX_NEARBY_PARKING_M,
  NEARBY_PARKING_CONFIDENCE,
} from "@/lib/matching/nearby-parking"
import type { Place, ParkingDetails } from "@/lib/types"

// `attr.details` is typed as a union of all four detail types — narrow it for
// tests that read parking-only fields.
function parkingDetails(p: Place): ParkingDetails {
  return p.accessibility.parking.details as ParkingDetails
}

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "test-id",
    name: "Test Hotel",
    category: "hotel",
    address: { street: "Hauptstraße", houseNumber: "1", postalCode: "35037", city: "Marburg", country: "DE" },
    coordinates: { lat: 50.8021, lon: 8.7666 },
    accessibility: {
      entrance: { value: "yes",     confidence: 1, conflict: false, sources: [], details: {} },
      toilet:   { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
      parking:  { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
    },
    overallConfidence: 0,
    primarySource: "osm",
    sourceRecords: [],
    ...overrides,
  }
}

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters({ lat: 50, lon: 8 }, { lat: 50, lon: 8 })).toBe(0)
  })

  it("matches expected distance within ~1% for short ranges", () => {
    // ~111 m due north at this latitude (1 arcsecond ~ 30 m)
    const d = haversineMeters({ lat: 50.802100, lon: 8.7666 }, { lat: 50.803100, lon: 8.7666 })
    expect(d).toBeGreaterThan(108)
    expect(d).toBeLessThan(115)
  })
})

describe("enrichWithNearbyParking", () => {
  it("upgrades unknown parking → yes when a feature is within range", () => {
    const place   = makePlace()
    const feature = { lat: place.coordinates.lat + 0.0005, lon: place.coordinates.lon } // ~55 m north
    enrichWithNearbyParking([place], [feature])

    expect(place.accessibility.parking.value).toBe("yes")
    expect(place.accessibility.parking.details).toMatchObject({ nearbyOnly: true })
    expect(parkingDetails(place).nearbyParkingDistanceM).toBeGreaterThan(40)
    expect(parkingDetails(place).nearbyParkingDistanceM).toBeLessThan(70)
  })

  it("leaves parking untouched when the nearest feature is past the threshold", () => {
    const place   = makePlace()
    const feature = { lat: place.coordinates.lat + 0.005, lon: place.coordinates.lon } // ~556 m north
    enrichWithNearbyParking([place], [feature])

    expect(place.accessibility.parking.value).toBe("unknown")
    expect(parkingDetails(place).nearbyOnly).toBeUndefined()
  })

  it("does not overwrite a venue's own non-unknown parking value", () => {
    const place = makePlace({
      accessibility: {
        entrance: { value: "yes", confidence: 1, conflict: false, sources: [], details: {} },
        toilet:   { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
        parking:  { value: "no",  confidence: 0.7, conflict: false, sources: [], details: {} },
      },
    })
    const feature = { lat: place.coordinates.lat, lon: place.coordinates.lon } // co-located
    enrichWithNearbyParking([place], [feature])

    expect(place.accessibility.parking.value).toBe("no")
    expect(parkingDetails(place).nearbyOnly).toBeUndefined()
  })

  it("is a no-op when the feature list is empty", () => {
    const place = makePlace()
    enrichWithNearbyParking([place], [])

    expect(place.accessibility.parking.value).toBe("unknown")
    expect(parkingDetails(place).nearbyOnly).toBeUndefined()
  })

  it("respects an explicit maxDistanceM override", () => {
    const place    = makePlace()
    const feature  = { lat: place.coordinates.lat + 0.0009, lon: place.coordinates.lon } // ~100 m
    enrichWithNearbyParking([place], [feature], 50)

    expect(place.accessibility.parking.value).toBe("unknown")
  })

  it("uses the closest feature when several are within range", () => {
    const place    = makePlace()
    const far      = { lat: place.coordinates.lat + 0.0010, lon: place.coordinates.lon } // ~111 m
    const close    = { lat: place.coordinates.lat + 0.0003, lon: place.coordinates.lon } // ~33 m
    enrichWithNearbyParking([place], [far, close])

    expect(parkingDetails(place).nearbyParkingDistanceM).toBeGreaterThan(25)
    expect(parkingDetails(place).nearbyParkingDistanceM).toBeLessThan(45)
  })

  it("default threshold matches the documented constant", () => {
    expect(DEFAULT_MAX_NEARBY_PARKING_M).toBe(300)
  })

  it("sets confidence to NEARBY_PARKING_CONFIDENCE after upgrade", () => {
    // confidence was 0 before enrichment (no known source attributed parking).
    // Without this fix, computeFilteredConfidence returns 0 % when parking is
    // the only active filter — the upgraded value="yes" is included in `known`
    // but confidence=0 drags the score to zero.
    const place   = makePlace()
    const feature = { lat: place.coordinates.lat, lon: place.coordinates.lon }
    enrichWithNearbyParking([place], [feature])

    expect(place.accessibility.parking.value).toBe("yes")
    expect(place.accessibility.parking.confidence).toBe(NEARBY_PARKING_CONFIDENCE)
    expect(NEARBY_PARKING_CONFIDENCE).toBeGreaterThan(0)
  })

  it("confidence is lower than a direct OSM on-site signal (0.75)", () => {
    // Nearby parking is a weaker signal than wheelchair=yes on the venue itself.
    expect(NEARBY_PARKING_CONFIDENCE).toBeLessThan(0.75)
  })
})

describe("nearbyOnly vs on-site parking distinction", () => {
  it("on-site yes parking has no nearbyOnly flag", () => {
    const place = makePlace({
      accessibility: {
        entrance: { value: "yes", confidence: 1, conflict: false, sources: [], details: {} },
        toilet:   { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
        parking:  { value: "yes", confidence: 0.75, conflict: false, sources: [], details: {} },
      },
    })
    const feature = { lat: place.coordinates.lat, lon: place.coordinates.lon }
    enrichWithNearbyParking([place], [feature])

    // on-site yes must not be overwritten and must not get nearbyOnly flag
    expect(place.accessibility.parking.value).toBe("yes")
    expect(parkingDetails(place).nearbyOnly).toBeUndefined()
  })

  it("on-site limited parking is not changed by enrichment", () => {
    const place = makePlace({
      accessibility: {
        entrance: { value: "yes",     confidence: 1,   conflict: false, sources: [], details: {} },
        toilet:   { value: "unknown", confidence: 0,   conflict: false, sources: [], details: {} },
        parking:  { value: "limited", confidence: 0.6, conflict: false, sources: [], details: {} },
      },
    })
    enrichWithNearbyParking([place], [{ lat: place.coordinates.lat, lon: place.coordinates.lon }])

    expect(place.accessibility.parking.value).toBe("limited")
    expect(parkingDetails(place).nearbyOnly).toBeUndefined()
  })

  it("only unknown-parking places get enriched; known values are untouched", () => {
    const placeYes     = makePlace({ id: "yes-place", accessibility: {
      entrance: { value: "yes", confidence: 1,    conflict: false, sources: [], details: {} },
      toilet:   { value: "yes", confidence: 1,    conflict: false, sources: [], details: {} },
      parking:  { value: "yes", confidence: 0.75, conflict: false, sources: [], details: {} },
    }})
    const placeNo      = makePlace({ id: "no-place", accessibility: {
      entrance: { value: "yes", confidence: 1,   conflict: false, sources: [], details: {} },
      toilet:   { value: "yes", confidence: 1,   conflict: false, sources: [], details: {} },
      parking:  { value: "no",  confidence: 0.7, conflict: false, sources: [], details: {} },
    }})
    const placeUnknown = makePlace({ id: "unknown-place" }) // parking: unknown

    const feature = { lat: placeYes.coordinates.lat, lon: placeYes.coordinates.lon }
    enrichWithNearbyParking([placeYes, placeNo, placeUnknown], [feature])

    expect(placeYes.accessibility.parking.value).toBe("yes")
    expect(parkingDetails(placeYes).nearbyOnly).toBeUndefined()

    expect(placeNo.accessibility.parking.value).toBe("no")
    expect(parkingDetails(placeNo).nearbyOnly).toBeUndefined()

    // only the unknown-parking place is upgraded
    expect(placeUnknown.accessibility.parking.value).toBe("yes")
    expect(parkingDetails(placeUnknown).nearbyOnly).toBe(true)
  })

  it("nearbyOnly=true place records the distance in nearbyParkingDistanceM", () => {
    const place   = makePlace()
    const feature = { lat: place.coordinates.lat + 0.001, lon: place.coordinates.lon } // ~111 m
    enrichWithNearbyParking([place], [feature])

    expect(parkingDetails(place).nearbyOnly).toBe(true)
    expect(parkingDetails(place).nearbyParkingDistanceM).toBeGreaterThan(100)
    expect(parkingDetails(place).nearbyParkingDistanceM).toBeLessThan(125)
  })

  it("on-site parking never has nearbyParkingDistanceM", () => {
    const place = makePlace({
      accessibility: {
        entrance: { value: "yes", confidence: 1,    conflict: false, sources: [], details: {} },
        toilet:   { value: "yes", confidence: 1,    conflict: false, sources: [], details: {} },
        parking:  { value: "yes", confidence: 0.75, conflict: false, sources: [], details: {} },
      },
    })
    enrichWithNearbyParking([place], [{ lat: place.coordinates.lat, lon: place.coordinates.lon }])

    expect(parkingDetails(place).nearbyParkingDistanceM).toBeUndefined()
  })
})
