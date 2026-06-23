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

import type { Place, AmenityFeature } from "../types"

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
  features: AmenityFeature[],
  maxDistanceM: number = DEFAULT_MAX_NEARBY_PARKING_M,
): void {
  // Only the strong tier may upgrade a venue's parking value. The weak tier
  // (wheelchair=yes lot without reserved bays) is display-only and must never
  // enrich — it says nothing about reserved disabled parking for the venue.
  // tier may be undefined on legacy/test features → treat as "strong".
  const features_ = features.filter((f) => f.tier !== "weak")
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

// Radius within which two toilet features are considered the same physical WC.
// The standalone (amenity=toilets) and venue (toilets:wheelchair) clauses can
// return the same toilet twice; a node + its containing way/relation likewise.
export const TOILET_DEDUP_RADIUS_M = 25

// Upper bound on WC features shipped in the /api/search payload. The fetch is
// capped at `out 1000` server-side; in dense cities that is far more than can be
// rendered and bloats every response (markers are display-only). We dedup, sort
// by distance to the search centre, and keep the nearest N so the payload stays
// bounded while the closest WCs — the ones a user actually needs — survive.
export const TOILET_DISPLAY_CAP = 300

// Collapse duplicate WC features that point at the same physical toilet.
// Preference order when two features collide: strong tier over weak, then
// standalone over venue (a standalone public toilet is the clearer signal).
// Non-toilet features pass through untouched.
export function dedupeToiletFeatures(
  features: AmenityFeature[],
  radiusM: number = TOILET_DEDUP_RADIUS_M,
): AmenityFeature[] {
  const toilets = features.filter((f) => f.amenityType === "toilet")
  const others  = features.filter((f) => f.amenityType !== "toilet")
  if (toilets.length <= 1) return features

  const rank = (f: AmenityFeature) =>
    (f.tier === "strong" ? 2 : 0) + (f.host?.kind === "standalone" ? 1 : 0)
  // Sort preferred-first so the kept feature is always the better one.
  const sorted = [...toilets].sort((a, b) => rank(b) - rank(a))

  const kept: AmenityFeature[] = []
  for (const t of sorted) {
    const dup = kept.some((k) => haversineMeters(k, t) <= radiusM)
    if (!dup) kept.push(t)
  }
  return [...others, ...kept]
}

// Radius within which two parking features are treated as the same physical lot.
// OSM routinely tags a parking area as BOTH a node and a way (plus occasional
// overlapping capacity:disabled nodes) — Overpass returns each, producing
// stacked map pins. 20 m collapses these without merging genuinely separate bays.
export const PARKING_DEDUP_RADIUS_M = 20

// Upper bound on parking features shipped in the /api/search payload, mirroring
// TOILET_DISPLAY_CAP. Bounds payload size in dense areas (markers are display-only).
export const PARKING_DISPLAY_CAP = 200

// Collapse duplicate parking features that point at the same physical lot, then
// cap the count. Preference order when two collide: strong tier over weak, then
// higher reserved capacity (the richer, more useful record survives).
// Non-parking features pass through untouched.
export function dedupeParkingFeatures(
  features: AmenityFeature[],
  radiusM: number = PARKING_DEDUP_RADIUS_M,
  cap: number = PARKING_DISPLAY_CAP,
): AmenityFeature[] {
  const parking = features.filter((f) => f.amenityType === "parking")
  const others  = features.filter((f) => f.amenityType !== "parking")
  if (parking.length <= 1) return features

  const rank = (f: AmenityFeature) =>
    (f.tier === "strong" ? 1000 : 0) + (f.capacity ?? 0)
  // Sort preferred-first so the kept feature is always the better one.
  const sorted = [...parking].sort((a, b) => rank(b) - rank(a))

  const kept: AmenityFeature[] = []
  for (const p of sorted) {
    const dup = kept.some((k) => haversineMeters(k, p) <= radiusM)
    if (!dup) kept.push(p)
  }
  return [...others, ...kept.slice(0, cap)]
}
