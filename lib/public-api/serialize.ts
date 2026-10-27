import type { A11yValue, ParkingDetails, Place } from "../types"
import type { ApiCategory } from "./constants"
import {
  fieldConfidence, resolveConservative, sourceValues,
  type ApiConfidence, type ApiConflict, type ApiSourceId, type SourceValue,
} from "./conflicts"
import {
  apiCategoriesOf, descriptionFromTags, elevatorFromTags, osmRefOf, osmTagsOf, osmVerifiedDate,
  stepFreeFromTags, surfaceNotesFromTags, type YesNoUnknown,
} from "./tags"
import type { StructureInfo } from "./osm-extra"
import { osmApiId, osmUrl } from "./toilets"

export interface ApiPlace {
  id:       string
  name:     string
  category: ApiCategory
  address:  { street: string | null; postcode: string | null; city: string | null }
  location: { lat: number; lon: number }
  distance_m?:  number
  match_score?: number
  accessibility: {
    wheelchair:                  A11yValue
    entrance_step_free:          YesNoUnknown
    elevator:                    YesNoUnknown
    toilet_wheelchair:           A11yValue
    nearest_wheelchair_toilet_m: number | null
    parking_disabled:            A11yValue
    parking_disabled_nearby_m:   number | null
    surface_notes:               string | null
    description:                 string | null
  }
  // Which source(s) each accessibility field came from (empty = no data).
  field_sources: Record<keyof ApiPlace["accessibility"], ApiSourceId[]>
  field_confidence: { wheelchair: ApiConfidence; toilet_wheelchair: ApiConfidence; parking_disabled: ApiConfidence }
  sources: {
    source:        ApiSourceId
    source_ref:    string
    fields:        string[]
    last_verified: string | null
    last_updated:  string | null
    url:           string | null
  }[]
  conflicts:  ApiConflict[]
  confidence: ApiConfidence
  links:      { website: string | null; osm: string | null; ginto: string | null }
}

export interface SerializeExtras {
  // undefined = not computed for this response (see warnings)
  nearestToiletM?: number | null
  // Entrance/elevator nodes of the venue's OSM building, when fetched.
  structure?: StructureInfo
  distanceM?: number
  matchScore?: number
}

export function apiPlaceId(place: Place): string {
  const ref = osmRefOf(place)
  if (ref) return osmApiId(ref)
  const ginto = place.sourceRecords.find((r) => r.sourceId === "ginto")
  if (ginto) return `ginto:${ginto.externalId}`
  return place.id
}

function sourcesOf(values: SourceValue[]): ApiSourceId[] {
  return [...new Set(values.map((v) => v.source))]
}

export function serializePlace(place: Place, extras: SerializeExtras = {}): ApiPlace {
  const tags     = osmTagsOf(place) ?? {}
  const osmRef   = osmRefOf(place)
  const hasOsm   = osmRef !== undefined
  const osmOnly  = (v: boolean): ApiSourceId[] => (v && hasOsm ? ["osm"] : [])
  const conflicts: ApiConflict[] = []

  const resolve = (field: string, values: SourceValue[]) => {
    const r = resolveConservative(field, values)
    if (r.conflict) conflicts.push(r.conflict)
    return r.value
  }

  const wheelchairValues = sourceValues(place.accessibility.entrance)
  const toiletValues     = sourceValues(place.accessibility.toilet)
  const parkingAttr      = place.accessibility.parking
  const parkingDetails   = parkingAttr.details as ParkingDetails
  const parkingValues    = sourceValues(parkingAttr)
  // "Yes, nearby": upgraded by the disabled-parking enrichment (an OSM parking
  // feature within ~150 m), which adds no per-source attribution of its own.
  const parkingNearby    = parkingDetails?.nearbyOnly === true && parkingValues.length === 0
  if (parkingNearby) parkingValues.push({ source: "osm", value: "yes" })

  const wheelchair = resolve("wheelchair", wheelchairValues)
  const toilet     = resolve("toilet_wheelchair", toiletValues)
  const parking    = resolve("parking_disabled", parkingValues)

  // Step-free entrance: venue tags first, then its entrance nodes.
  let stepFree = stepFreeFromTags(tags)
  if (stepFree === "unknown" && extras.structure) stepFree = extras.structure.stepFree
  let elevator = elevatorFromTags(tags)
  if (elevator === "unknown" && extras.structure?.elevator) elevator = "yes"

  const surface     = surfaceNotesFromTags(tags)
  const description = descriptionFromTags(tags)

  const nearestToilet = toilet === "yes" ? 0 : extras.nearestToiletM ?? null

  const accessibility: ApiPlace["accessibility"] = {
    wheelchair,
    entrance_step_free:          stepFree,
    elevator,
    toilet_wheelchair:           toilet,
    nearest_wheelchair_toilet_m: nearestToilet,
    parking_disabled:            parking,
    parking_disabled_nearby_m:   parkingNearby ? parkingDetails.nearbyParkingDistanceM ?? null : null,
    surface_notes:               surface,
    description,
  }

  const field_sources: ApiPlace["field_sources"] = {
    wheelchair:                  sourcesOf(wheelchairValues),
    entrance_step_free:          osmOnly(stepFree !== "unknown"),
    elevator:                    osmOnly(elevator !== "unknown"),
    toilet_wheelchair:           sourcesOf(toiletValues),
    nearest_wheelchair_toilet_m: nearestToilet === null ? [] : toilet === "yes" ? sourcesOf(toiletValues) : ["osm"],
    parking_disabled:            sourcesOf(parkingValues),
    parking_disabled_nearby_m:   osmOnly(parkingNearby),
    surface_notes:               osmOnly(surface !== null),
    description:                 osmOnly(description !== null),
  }

  const fieldsFrom = (source: ApiSourceId) =>
    (Object.keys(field_sources) as (keyof typeof field_sources)[]).filter((k) => field_sources[k].includes(source))

  const sources: ApiPlace["sources"] = []
  if (osmRef) {
    sources.push({
      source: "osm", source_ref: osmRef, fields: fieldsFrom("osm"),
      last_verified: osmVerifiedDate(tags), last_updated: null, url: osmUrl(osmRef),
    })
  }
  const gintoRec = place.sourceRecords.find((r) => r.sourceId === "ginto")
  if (gintoRec) {
    const updatedAt = gintoRec.metadata?.updatedAt
    sources.push({
      source: "ginto", source_ref: gintoRec.externalId, fields: fieldsFrom("ginto"),
      last_verified: null,
      last_updated:  typeof updatedAt === "string" ? updatedAt.slice(0, 10) : null,
      url:           place.gintoUrl ?? null,
    })
  }

  const hasConflict = (field: string) => conflicts.some((c) => c.field === field)
  const field_confidence = {
    wheelchair:        fieldConfidence(place.accessibility.entrance, hasConflict("wheelchair")),
    toilet_wheelchair: fieldConfidence(place.accessibility.toilet,   hasConflict("toilet_wheelchair")),
    parking_disabled:  parkingNearby ? "low" as const : fieldConfidence(parkingAttr, hasConflict("parking_disabled")),
  }

  const street = [place.address.street, place.address.houseNumber].filter(Boolean).join(" ")

  return {
    id:       apiPlaceId(place),
    name:     place.name,
    category: apiCategoriesOf(place).primary,
    address:  {
      street:   street || null,
      postcode: place.address.postalCode || null,
      city:     place.address.city || null,
    },
    location: { lat: place.coordinates.lat, lon: place.coordinates.lon },
    ...(extras.distanceM  !== undefined ? { distance_m:  Math.round(extras.distanceM) } : {}),
    ...(extras.matchScore !== undefined ? { match_score: Math.round(extras.matchScore * 100) / 100 } : {}),
    accessibility,
    field_sources,
    field_confidence,
    sources,
    conflicts,
    // The headline confidence describes the headline `wheelchair` value.
    confidence: field_confidence.wheelchair,
    links: {
      website: place.website ?? null,
      osm:     osmRef ? osmUrl(osmRef) : null,
      ginto:   place.gintoUrl ?? null,
    },
  }
}
