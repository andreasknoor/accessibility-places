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
// The value equals the OSM reliability weight: the data quality of a parking
// spot is the same regardless of how far away it sits from the venue.

import type { Place } from "../types"
import type { NearbyParkingFeature } from "../adapters/osm"

export const DEFAULT_MAX_NEARBY_PARKING_M = 250

// Wider radius used only for map display: show parking spots that are within
// this distance of any found place, even if too far to trigger enrichment.
// Gives users a useful "parking nearby" overview without polluting the whole city.
export const NEARBY_PARKING_DISPLAY_RADIUS_M = 500

// OSM parking data quality is constant regardless of distance to the venue;
// only the spatial relevance changes, and that is already gated by maxDistanceM.
export const NEARBY_PARKING_CONFIDENCE = 0.75 // matches OSM reliability weight

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
  // Only the strong "disabled" tier may upgrade a venue's parking value. The
  // weak "accessible" tier (wheelchair=yes lot without reserved bays) is
  // display-only and must never enrich — a feature with tier "accessible"
  // says nothing about reserved disabled parking for the venue.
  // tier may be undefined on legacy/test features → treat as "disabled".
  const features_ = features.filter((f) => f.tier !== "accessible")
  if (features_.length === 0) return
  for (const place of places) {
    if (place.accessibility.parking.value !== "unknown") continue
    let bestDist = Infinity
    for (const f of features_) {
      const d = haversineMeters(place.coordinates, f)
      if (d < bestDist) bestDist = d
      if (bestDist === 0) break
    }
    if (bestDist > maxDistanceM) continue
    place.accessibility.parking.value      = "yes"
    place.accessibility.parking.confidence = NEARBY_PARKING_CONFIDENCE
    place.accessibility.parking.details    = {
      ...place.accessibility.parking.details,
      nearbyOnly:             true,
      nearbyParkingDistanceM: Math.round(bestDist),
    }
  }
}
