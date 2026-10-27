import type { A11yValue, AmenityFeature, Category, Place } from "../types"
import { haversineMetres } from "../matching/match"
import {
  API_ONLY_CATEGORIES, API_TO_APP_CATEGORIES, NEARBY_TOILET_MAX_RADIUS_M, TOILET_SEARCH_RADIUS_M,
  type ApiCategory, type ApiOnlyCategory,
} from "./constants"
import { fetchExtraCategoryPlaces } from "./osm-extra"
import { asAdapterResult, fetchApiPlaces, type ApiWarning } from "./pipeline"
import { serializePlace, type ApiPlace } from "./serialize"
import { apiCategoriesOf, osmRefOf } from "./tags"
import { fetchToiletFeatures, nearestToiletM } from "./toilets"

export interface NearbyQuery {
  lat:        number
  lon:        number
  radiusM:    number
  categories: ApiCategory[]
  wheelchair?: A11yValue[]
  limit:      number
}

export function appCategoriesFor(categories: ApiCategory[]): Category[] {
  const out = new Set<Category>()
  for (const c of categories) {
    const mapped = API_TO_APP_CATEGORIES[c]
    if (mapped) mapped.forEach((m) => out.add(m))
    else out.add(c as Category)
  }
  return [...out]
}

export async function runNearby(q: NearbyQuery): Promise<{ results: ApiPlace[]; warnings: ApiWarning[]; allFailed: boolean }> {
  const center   = { lat: q.lat, lon: q.lon }
  const radiusKm = q.radiusM / 1000
  const extraCats = q.categories.filter((c): c is ApiOnlyCategory => (API_ONLY_CATEGORIES as readonly string[]).includes(c))
  const appCats   = appCategoriesFor(q.categories)

  const wantToilets = q.radiusM <= NEARBY_TOILET_MAX_RADIUS_M
  let toiletsFailed = false
  const toiletsPromise: Promise<AmenityFeature[] | null> = wantToilets
    ? fetchToiletFeatures(center, q.radiusM + TOILET_SEARCH_RADIUS_M).catch(() => { toiletsFailed = true; return null })
    : Promise.resolve(null)

  const [{ places, warnings, allFailed }, toilets] = await Promise.all([
    fetchApiPlaces({
      location:   center,
      radiusKm,
      categories: appCats,
      extra:      extraCats.length ? [asAdapterResult("osm", fetchExtraCategoryPlaces(extraCats, center, radiusKm))] : [],
    }),
    toiletsPromise,
  ])

  if (!wantToilets) {
    warnings.push({
      code:    "nearest_toilet_not_computed",
      message: `nearest_wheelchair_toilet_m is only computed for radius ≤ ${NEARBY_TOILET_MAX_RADIUS_M} m; use /api/v1/toilets/nearby per venue.`,
    })
  } else if (toiletsFailed) {
    warnings.push({ code: "toilets_unavailable", message: "Toilet data could not be fetched; nearest_wheelchair_toilet_m is null." })
  }

  const requested = new Set<ApiCategory>(q.categories)
  const wanted = (p: Place) => [...apiCategoriesOf(p).all].some((c) => requested.has(c))

  const results = places
    .filter(wanted)
    .map((p) => ({ p, d: haversineMetres(center, p.coordinates) }))
    .filter(({ d }) => d <= q.radiusM)
    .map(({ p, d }) => serializePlace(p, {
      distanceM:      d,
      nearestToiletM: toilets ? nearestToiletM(toilets, p.coordinates, osmRefOf(p)) : undefined,
    }))
    .filter((r) => !q.wheelchair || q.wheelchair.includes(r.accessibility.wheelchair))
    .sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0))
    .slice(0, q.limit)

  return { results, warnings, allFailed }
}
