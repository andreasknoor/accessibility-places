import type { Place } from "../types"
import { fetchOsmElement, fetchStructureInfo, type OsmType, type StructureInfo } from "./osm-extra"
import { asAdapterResult, fetchApiPlaces, type ApiWarning } from "./pipeline"
import { serializePlace, type ApiPlace } from "./serialize"
import { osmRefOf } from "./tags"
import { nearestToiletM, toiletFeaturesFor } from "./toilets"
import type { ScoredPlace } from "./lookup"

// Shared enrichment for lookup + detail: entrance/elevator nodes of the OSM
// building, and the nearest wheelchair toilet within 500 m.

export async function enrichAndSerialize(items: ScoredPlace[], warnings: ApiWarning[]): Promise<ApiPlace[]> {
  if (items.length === 0) return []
  const refs = items.map((i) => osmRefOf(i.place)).filter((r): r is string => !!r)

  const [structure, toilets] = await Promise.all([
    fetchStructureInfo(refs, items[0].place.coordinates).catch(() => {
      warnings.push({ code: "structure_unavailable", message: "Entrance/elevator nodes could not be fetched; entrance_step_free and elevator use venue tags only." })
      return new Map<string, StructureInfo>()
    }),
    toiletFeaturesFor(items.map((i) => i.place.coordinates)),
  ])
  if (toilets.failed)  warnings.push({ code: "toilets_unavailable", message: "Toilet data could not be fetched for some results; nearest_wheelchair_toilet_m may be null." })
  if (toilets.skipped) warnings.push({ code: "nearest_toilet_not_computed", message: "Results are spread too far apart; nearest_wheelchair_toilet_m was only computed for the first clusters." })

  return items.map(({ place, score }) => {
    const ref = osmRefOf(place)
    const features = toilets.covered(place.coordinates)
    return serializePlace(place, {
      matchScore:     Number.isNaN(score) ? undefined : score,
      structure:      ref ? structure.get(ref) : undefined,
      nearestToiletM: features ? nearestToiletM(features, place.coordinates, ref) : undefined,
    })
  })
}

/** Parse "osm:node:123" (or "osm:node/123"). */
export function parsePlaceId(id: string): { type: OsmType; id: number } | null {
  const m = /^osm:(node|way|relation)[:/](\d{1,15})$/.exec(id)
  return m ? { type: m[1] as OsmType, id: Number(m[2]) } : null
}

export async function runDetail(type: OsmType, id: number): Promise<{ result: ApiPlace | null; warnings: ApiWarning[]; allFailed: boolean }> {
  const warnings: ApiWarning[] = []
  const element = await fetchOsmElement(type, id)
  if (!element) return { result: null, warnings, allFailed: false }

  // Other sources at the element's own location, merged with the OSM element.
  const ref = `${type}/${id}`
  const { places, warnings: w, allFailed } = await fetchApiPlaces({
    location:   element.coordinates,
    radiusKm:   0.15,
    categories: [element.category],
    sources:    { osm: false },
    extra:      [asAdapterResult("osm", Promise.resolve([element]))],
  })
  warnings.push(...w)
  const place: Place = places.find((p) => osmRefOf(p) === ref) ?? element
  const [result] = await enrichAndSerialize([{ place, score: NaN }], warnings)
  return { result, warnings, allFailed }
}
