import type { Place, SearchParams } from "./types"
import { fetchAllSources, type AdapterResult } from "./adapters"
import { fetchOsmDisabledParking, type NearbyParkingFeature } from "./adapters/osm"
import { findMatch } from "./matching/match"
import { mergePlaces, finalisePlaceConfidence } from "./matching/merge"
import { enrichWithNearbyParking } from "./matching/nearby-parking"

// Shared fetch → match → merge → nearby-parking core for the non-streaming
// callers (SEO ISR pages and the public /api/v1 routes). The streaming
// /api/search route keeps its own copy of these steps because it interleaves
// per-source events, stats and Sentry reporting between them.
//
// Must stay side-effect-free (no trackCall/trackError): ISR renders call it,
// and a no-store Upstash fetch would demote those pages to dynamic.

export interface PipelineOptions {
  // Fetch disabled parking in parallel and upgrade unknown parking values
  // ("yes, nearby"). Default true.
  nearbyParking?: boolean
  // Extra pre-fetched results merged like any adapter (e.g. the public API's
  // OSM-only extra categories).
  extra?: Promise<AdapterResult>[]
  // Pre-merge filter on each adapter place — lets a caller drop records it
  // must not use (e.g. non-open-data Ginto entries for the public API).
  keep?: (place: Place) => boolean
}

export interface PipelineResult {
  // Canonical merged places, dog-policy-only records already dropped.
  places:   Place[]
  // Per-source failures, for callers that report partial results.
  failures: { sourceId: string; error: string }[]
}

export async function fetchAndMerge(params: SearchParams, opts: PipelineOptions = {}): Promise<PipelineResult> {
  const { nearbyParking = true, extra = [], keep } = opts

  // Kick off nearby-parking fetch in parallel with the adapter fetches.
  // Non-fatal: failure leaves parking values as the adapters reported them.
  // SKIP_NEARBY_ENRICHMENT=1 is set by scripts/check-seo-validity.ts to avoid
  // doubling Overpass load during bulk validity checks (not a user-facing toggle).
  const nearbyParkingPromise = !nearbyParking || process.env.SKIP_NEARBY_ENRICHMENT === "1"
    ? Promise.resolve([] as NearbyParkingFeature[])
    : fetchOsmDisabledParking(params.location, params.radiusKm, AbortSignal.timeout(20_000))
        .then(r => r.features)
        .catch(() => [])

  const results = await Promise.all([fetchAllSources(params), ...extra.map((p) => p.then((r) => [r]))])
    .then((groups) => groups.flat())

  const canonical: Place[] = []
  for (const { places } of results) {
    for (const incoming of places) {
      if (keep && !keep(incoming)) continue
      const idx = findMatch(canonical, incoming)
      if (idx >= 0) canonical[idx] = mergePlaces(canonical[idx], incoming)
      else          canonical.push(finalisePlaceConfidence(incoming))
    }
  }

  enrichWithNearbyParking(canonical, await nearbyParkingPromise)

  return {
    places:   canonical.filter((p) => !p.dogPolicyOnly),
    failures: results.filter((r) => r.error).map((r) => ({ sourceId: r.sourceId, error: r.error! })),
  }
}
