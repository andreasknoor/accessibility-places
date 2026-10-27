import type { AmenityFeature } from "../types"
import { fetchOsmAccessibleAmenities } from "../adapters/osm"
import { dedupeToiletFeatures } from "../matching/nearby-parking"
import { haversineMetres } from "../matching/match"
import { TOILET_SEARCH_RADIUS_M, UPSTREAM_TIMEOUT_MS } from "./constants"

// Wheelchair toilets come from the same OSM query the app's 🚻 search uses
// (lib/adapters/osm.ts fetchOsmAccessibleAmenities): standalone
// amenity=toilets with wheelchair=yes|designated, plus any venue tagging
// toilets:wheelchair=yes|designated (access=private/no excluded).

type Point = { lat: number; lon: number }

export interface ApiToilet {
  id:             string | null
  kind:           "standalone" | "venue"
  name:           string | null
  location:       Point
  distance_m:     number
  wheelchair:     "designated" | "yes"
  euro_key:       boolean | null
  fee:            string | null
  opening_hours:  string | null
  access:         string | null
  changing_table: boolean | null
  links:          { osm: string | null }
}

export function osmApiId(ref: string): string {
  return `osm:${ref.replace("/", ":")}`
}

export function osmUrl(ref: string): string {
  return `https://www.openstreetmap.org/${ref}`
}

/**
 * Fetch deduplicated toilet features covering `radiusM` around `center`.
 * Note the helper always adds a 500 m buffer to the query radius — callers
 * must distance-filter the result themselves.
 */
export async function fetchToiletFeatures(center: Point, radiusM: number): Promise<AmenityFeature[]> {
  const { features } = await fetchOsmAccessibleAmenities(center, Math.max(radiusM - 500, 0) / 1000, ["toilet"], {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  return dedupeToiletFeatures(features)
}

export function toApiToilet(f: AmenityFeature, from: Point): ApiToilet {
  return {
    id:             f.osmId ? osmApiId(f.osmId) : null,
    kind:           f.host?.kind ?? "standalone",
    name:           f.host?.name ?? null,
    location:       { lat: f.lat, lon: f.lon },
    distance_m:     Math.round(haversineMetres(from, f)),
    wheelchair:     f.tier === "strong" ? "designated" : "yes",
    euro_key:       f.euroKey ?? null,
    fee:            f.fee ?? null,
    opening_hours:  f.openingHours ?? null,
    access:         f.access ?? f.host?.access ?? null,
    changing_table: f.changingTable ?? null,
    links:          { osm: f.osmId ? osmUrl(f.osmId) : null },
  }
}

/** Toilets within radiusM of `from`, nearest first. */
export function toiletsWithin(features: AmenityFeature[], from: Point, radiusM: number): ApiToilet[] {
  return features
    .map((f) => toApiToilet(f, from))
    .filter((t) => t.distance_m <= radiusM)
    .sort((a, b) => a.distance_m - b.distance_m)
}

/**
 * Distance (m) from a venue to the nearest wheelchair toilet within 500 m,
 * or null if none. `ownOsmRef` excludes the venue's own toilets:wheelchair
 * feature — whether the venue itself has one is decided by the caller from
 * the venue's resolved toilet value (resolved "yes" ⇒ 0).
 */
export function nearestToiletM(features: AmenityFeature[], from: Point, ownOsmRef?: string): number | null {
  let best = Infinity
  for (const f of features) {
    if (ownOsmRef && f.osmId === ownOsmRef) continue
    const d = haversineMetres(from, f)
    if (d < best) best = d
  }
  return best <= TOILET_SEARCH_RADIUS_M ? Math.round(best) : null
}

// ─── Toilet coverage for scattered points (lookup / detail) ────────────────
// Greedy clustering keeps the number of Overpass queries bounded: points
// within CLUSTER_M of a seed share one query that covers seed + CLUSTER_M + 500 m.

const CLUSTER_M    = 300
const MAX_CLUSTERS = 3

export async function toiletFeaturesFor(points: Point[]): Promise<{
  covered: (p: Point) => AmenityFeature[] | undefined
  failed:  boolean
  skipped: number
}> {
  const seeds: Point[] = []
  let skipped = 0
  for (const p of points) {
    if (seeds.some((s) => haversineMetres(s, p) <= CLUSTER_M)) continue
    if (seeds.length >= MAX_CLUSTERS) { skipped++; continue }
    seeds.push(p)
  }
  let failed = false
  const results = await Promise.all(seeds.map((s) =>
    fetchToiletFeatures(s, CLUSTER_M + TOILET_SEARCH_RADIUS_M).catch(() => { failed = true; return null }),
  ))
  return {
    covered: (p) => {
      const i = seeds.findIndex((s) => haversineMetres(s, p) <= CLUSTER_M)
      return i >= 0 ? results[i] ?? undefined : undefined
    },
    failed,
    skipped,
  }
}
