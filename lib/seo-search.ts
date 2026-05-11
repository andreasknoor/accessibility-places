import type { Place, SearchParams, SearchFilters, Category } from "./types"
import { fetchAllSources }          from "./adapters"
import { findMatch }                from "./matching/match"
import { mergePlaces, finalisePlaceConfidence, computeFilteredConfidence } from "./matching/merge"

const NO_FILTERS: SearchFilters = {
  entrance:      false,
  toilet:        false,
  parking:       false,
  seating:       false,
  onlyVerified:  false,
  acceptUnknown: true,
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
    filters:    NO_FILTERS,
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

  return canonical
    .filter((p) => !p.dogPolicyOnly && p.category === category)
    .map((p) => ({ ...p, overallConfidence: computeFilteredConfidence(p, NO_FILTERS) }))
    .sort((a, b) => b.overallConfidence - a.overallConfidence)
    .slice(0, 25)
}
