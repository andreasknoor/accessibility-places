import type { Place, SearchParams, SearchFilters, Category } from "./types"
import { SEO_CATEGORY_SLUGS } from "./cities"
import { fetchAllSources }                                   from "./adapters"
import { fetchOsmDisabledParking }                           from "./adapters/osm"
import { findMatch }                                         from "./matching/match"
import { mergePlaces, finalisePlaceConfidence, computeFilteredConfidence, passesFilters } from "./matching/merge"
import { enrichWithNearbyParking }                           from "./matching/nearby-parking"

// Fetch without any filter so all sources return their full result set.
const FETCH_FILTERS: SearchFilters = {
  entrance:          false,
  toilet:            false,
  parking:           false,
  seating:           false,
  onlyVerified:      false,
  acceptUnknown:     true,
  alwaysShowParking: false,
}

// Preferred display filter: entrance + toilet accessible (yes or limited).
const FILTERS_STRICT: SearchFilters = {
  entrance:          true,
  toilet:            true,
  parking:           false,
  seating:           false,
  onlyVerified:      false,
  acceptUnknown:     false,
  alwaysShowParking: false,
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

  // Kick off nearby-parking fetch in parallel with the adapter fetches.
  // Non-fatal: failure leaves parking values as the adapters reported them.
  const nearbyParkingEnabled = process.env.ENABLE_NEARBY_PARKING === "1"
  const nearbyParkingPromise = nearbyParkingEnabled
    ? fetchOsmDisabledParking({ lat, lon }, radiusKm, AbortSignal.timeout(20_000)).catch(() => [])
    : Promise.resolve([] as Awaited<ReturnType<typeof fetchOsmDisabledParking>>)

  const results = await fetchAllSources(params)

  const canonical: Place[] = []
  for (const { places } of results) {
    for (const incoming of places) {
      const idx = findMatch(canonical, incoming)
      if (idx >= 0) canonical[idx] = mergePlaces(canonical[idx], incoming)
      else          canonical.push(finalisePlaceConfidence(incoming))
    }
  }

  if (nearbyParkingEnabled) {
    enrichWithNearbyParking(canonical, await nearbyParkingPromise)
  }

  const base = canonical.filter((p) => !p.dogPolicyOnly && p.category === category)
  const filtered = base.filter((p) => passesFilters(p, FILTERS_STRICT))

  return filtered
    .map((p) => ({ ...p, overallConfidence: computeFilteredConfidence(p, FILTERS_STRICT) }))
    .sort((a, b) => b.overallConfidence - a.overallConfidence || a.name.localeCompare(b.name))
    .slice(0, 25)
}

// ─── City guide ───────────────────────────────────────────────────────────────

export const CITY_GUIDE_PLACES_PER_CATEGORY = 4

export interface CityGuideSection {
  categorySlug: string
  places: Place[]
}

// Fetch top places for every SEO category in parallel and return non-empty
// sections sorted by the canonical SEO category order.
// Each category is independent: a failure in one leaves the others unaffected.
export async function fetchPlacesForCityGuide(
  lat:     number,
  lon:     number,
  radiusKm = 5,
): Promise<CityGuideSection[]> {
  const entries = Object.entries(SEO_CATEGORY_SLUGS)
  const settled = await Promise.allSettled(
    entries.map(async ([slug, category]) => {
      const places = await fetchPlacesForSeoPage(lat, lon, category as Category, radiusKm)
      return { categorySlug: slug, places: places.slice(0, CITY_GUIDE_PLACES_PER_CATEGORY) }
    }),
  )
  return settled
    .filter((r): r is PromiseFulfilledResult<CityGuideSection> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((s) => s.places.length > 0)
}
