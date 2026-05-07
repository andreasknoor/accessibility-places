// Enrich already-merged places with "nearby disabled parking" information from
// a separate OSM fetch. See lib/adapters/osm.ts → fetchOsmDisabledParking for
// the data side; this module is the matching/post-processing side.
//
// Behaviour: places whose own parking attribute is "unknown" get upgraded to
// "yes" with `details.nearbyOnly = true` IF a disabled-parking OSM feature
// exists within `maxDistanceM`. We deliberately do NOT add a new
// SourceAttribution: the source-attributed value list (and thus the
// per-source filter-pass count from passesFiltersForSource) keeps reflecting
// what the venue's own data says. Confidence calculations are likewise
// unaffected because they read from `attr.sources`, which is untouched.

import type { Place } from "../types"
import type { NearbyParkingFeature } from "../adapters/osm"

export const DEFAULT_MAX_NEARBY_PARKING_M = 150

// Haversine distance in meters between two lat/lon points. Plenty accurate at
// the ~100 m scale we care about; cheaper than a geodesic-correct formula.
export function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000 // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function enrichWithNearbyParking(
  places: Place[],
  features: NearbyParkingFeature[],
  maxDistanceM: number = DEFAULT_MAX_NEARBY_PARKING_M,
): void {
  if (features.length === 0) return
  for (const place of places) {
    if (place.accessibility.parking.value !== "unknown") continue
    let bestDist = Infinity
    for (const f of features) {
      const d = haversineMeters(place.coordinates, f)
      if (d < bestDist) bestDist = d
      if (bestDist === 0) break
    }
    if (bestDist > maxDistanceM) continue
    place.accessibility.parking.value = "yes"
    place.accessibility.parking.details = {
      ...place.accessibility.parking.details,
      nearbyOnly:             true,
      nearbyParkingDistanceM: Math.round(bestDist),
    }
  }
}
