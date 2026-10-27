import type { Place, SearchParams, SearchFilters, Category } from "./types"
import { SEO_CATEGORY_SLUGS } from "./cities"
import { fetchAndMerge }                                     from "./place-pipeline"
import { computeFilteredConfidence, passesFilters }          from "./matching/merge"

// Fetch without any filter so all sources return their full result set.
const FETCH_FILTERS: SearchFilters = {
  entrance:          false,
  toilet:            false,
  parking:           false,
  parkingNearby:     true,
  seating:           false,
  onlyVerified:      false,
  acceptUnknown:     true,
  alwaysShowParking: false,
  alwaysShowToilets: false, openNowOnly: false,
}

// Preferred display filter: entrance + toilet accessible (yes or limited).
const FILTERS_STRICT: SearchFilters = {
  entrance:          true,
  toilet:            true,
  parking:           false,
  parkingNearby:     true,
  seating:           false,
  onlyVerified:      false,
  acceptUnknown:     false,
  alwaysShowParking: false,
  alwaysShowToilets: false, openNowOnly: false,
}

const SEO_SOURCES: SearchParams["sources"] = {
  osm:                 true,
  accessibility_cloud: true,
  reisen_fuer_alle:    true, // silently skipped when key absent
  ginto:               true, // silently skipped when key absent
  acceslibre:          false, // FR-only; SEO pages are DACH-scoped
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

  const { places: canonical } = await fetchAndMerge(params)

  const base = canonical.filter((p) => p.category === category)
  const filtered = base.filter((p) => passesFilters(p, FILTERS_STRICT))

  return filtered
    .map((p) => ({ ...p, overallConfidence: computeFilteredConfidence(p, FILTERS_STRICT) }))
    .sort((a, b) => b.overallConfidence - a.overallConfidence || a.name.localeCompare(b.name))
    .slice(0, 25)
}
