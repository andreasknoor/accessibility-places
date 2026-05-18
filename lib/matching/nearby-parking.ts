// Enrich already-merged places with "nearby disabled parking" information from
// a separate OSM fetch. See lib/adapters/osm.ts → fetchOsmDisabledParking for
// the data side; this module is the matching/post-processing side.
//
// Behaviour: places whose own parking attribute is "unknown" get upgraded to
// "yes" with `details.nearbyOnly = true` IF a disabled-parking OSM feature
// exists within `maxDistanceM`. We deliberately do NOT add a new
// SourceAttribution: the source-attributed value list (and thus the
// per-source filter-pass count from passesFiltersForSource) keeps reflecting
// what the venue's own data says.
//
// Confidence is set explicitly to NEARBY_PARKING_CONFIDENCE (not derived from
// sources) because computeFilteredConfidence reads attr.confidence directly.
// Without this, a place enriched to parking="yes" would still show 0 %
// when parking is the only active filter — the original confidence was 0
// (no known source attributed parking to the venue itself).

import type { Place } from "../types"
import type { NearbyParkingFeature } from "../adapters/osm"

export const DEFAULT_MAX_NEARBY_PARKING_M = 300

// Wider radius used only for map display: show parking spots that are within
// this distance of any found place, even if too far to trigger enrichment.
// Gives users a useful "parking nearby" overview without polluting the whole city.
export const NEARBY_PARKING_DISPLAY_RADIUS_M = 500

// Confidence for a parking attribute upgraded via a nearby OSM spot.
// Piecewise linear through four calibrated points — steepest drop in the
// 100–150 m zone where "around the corner" becomes "somewhat far away".
// Always lower than a direct on-site source (OSM wheelchair=yes ≈ 0.75).
const NEARBY_PARKING_BREAKPOINTS: [number, number][] = [
  [0,   0.75],
  [100, 0.70],
  [150, 0.50],
  [300, 0.25],
]

export function nearbyParkingConfidence(
  distanceM:    number,
  maxDistanceM: number = DEFAULT_MAX_NEARBY_PARKING_M,
): number {
  const d = Math.min(distanceM, maxDistanceM)
  for (let i = 1; i < NEARBY_PARKING_BREAKPOINTS.length; i++) {
    const [x0, y0] = NEARBY_PARKING_BREAKPOINTS[i - 1]
    const [x1, y1] = NEARBY_PARKING_BREAKPOINTS[i]
    if (d <= x1) {
      const t = (d - x0) / (x1 - x0)
      return Math.round((y0 + t * (y1 - y0)) * 100) / 100
    }
  }
  return NEARBY_PARKING_BREAKPOINTS[NEARBY_PARKING_BREAKPOINTS.length - 1][1]
}

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
    place.accessibility.parking.value      = "yes"
    place.accessibility.parking.confidence = nearbyParkingConfidence(bestDist, maxDistanceM)
    place.accessibility.parking.details    = {
      ...place.accessibility.parking.details,
      nearbyOnly:             true,
      nearbyParkingDistanceM: Math.round(bestDist),
    }
  }
}
