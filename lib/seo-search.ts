import type { Place, SearchParams, SearchFilters, Category } from "./types"
import { fetchAllSources }          from "./adapters"
import { findMatch }                from "./matching/match"
import { mergePlaces, finalisePlaceConfidence, computeFilteredConfidence, passesFilters } from "./matching/merge"

// Fetch without any filter so all sources return their full result set.
const FETCH_FILTERS: SearchFilters = {
  entrance:      false,
  toilet:        false,
  parking:       false,
  seating:       false,
  onlyVerified:  false,
  acceptUnknown: true,
}

// Preferred display filter: entrance + toilet accessible (yes or limited).
const FILTERS_STRICT: SearchFilters = {
  entrance:      true,
  toilet:        true,
  parking:       false,
  seating:       false,
  onlyVerified:  false,
  acceptUnknown: false,
}

const SEO_SOURCES: SearchParams["sources"] = {
  osm:                 true,
  accessibility_cloud: true,
  reisen_fuer_alle:    true, // silently skipped when key absent
  ginto:               true, // silently skipped when key absent
  google_places:       false,
}

export async function fetchPlacesForSeoPage(
  lat:      number,
  lon:      number,
  category: Category,
  radiusKm  = 5,
): Promise<Place[]> {
  const params: SearchParams = {
    query:      category,
    location:   { lat, lon },
    radiusKm,
    categories: [category],
    filters:    FETCH_FILTERS,
    sources:    SEO_SOURCES,
    signal:     AbortSignal.timeout(30_000),
  }

  const results = await fetchAllSources(params)

  const canonical: Place[] = []
  for (const { places } of results) {
    for (const incoming of places) {
      const idx = findMatch(canonical, incoming)
      if (idx >= 0) canonical[idx] = mergePlaces(canonical[idx], incoming)
      else          canonical.push(finalisePlaceConfidence(incoming))
    }
  }

  const base = canonical.filter((p) => !p.dogPolicyOnly && p.category === category)
  const filtered = base.filter((p) => passesFilters(p, FILTERS_STRICT))

  return filtered
    .map((p) => ({ ...p, overallConfidence: computeFilteredConfidence(p, FILTERS_STRICT) }))
    .sort((a, b) => b.overallConfidence - a.overallConfidence)
    .slice(0, 25)
}
