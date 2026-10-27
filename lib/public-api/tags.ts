import type { Place } from "../types"
import type { ApiCategory, ApiOnlyCategory } from "./constants"

// Pure OSM tag → API field mapping. Every function returns "unknown" / null
// when the tags carry no explicit evidence — values are never inferred from
// unrelated tags (e.g. wheelchair=yes does NOT imply a step-free entrance here).

export type Tags = Record<string, string>
export type YesNoUnknown = "yes" | "no" | "unknown"

/** Raw OSM tags of a (possibly merged) place, or undefined for non-OSM places. */
export function osmTagsOf(place: Place): Tags | undefined {
  const rec = place.sourceRecords.find((r) => r.sourceId === "osm")
  return rec?.metadata as Tags | undefined
}

/** OSM "type/id" of a place's OSM record, e.g. "way/31622818". */
export function osmRefOf(place: Place): string | undefined {
  return place.sourceRecords.find((r) => r.sourceId === "osm")?.externalId
}

// ─── Category ─────────────────────────────────────────────────────────────

/** The API-only category a tag set describes, if any (most specific first). */
export function apiOnlyCategoryFromTags(tags: Tags): ApiOnlyCategory | undefined {
  if (tags["amenity"] === "concert_hall" || tags["theatre:type"] === "concert_hall") return "concert_hall"
  if (tags["historic"] === "castle" || tags["historic"] === "palace" || "castle_type" in tags) return "castle"
  if (tags["leisure"] === "garden" || tags["garden:type"] === "botanical") return "garden"
  if (tags["amenity"] === "arts_centre") return "arts_centre"
  return undefined
}

/** Primary API category + every category the place should match in a filter. */
export function apiCategoriesOf(place: Place): { primary: ApiCategory; all: Set<ApiCategory> } {
  const base: ApiCategory = place.category === "theater" ? "theatre" : place.category
  const tags = osmTagsOf(place)
  const specific = tags ? apiOnlyCategoryFromTags(tags) : undefined
  const all = new Set<ApiCategory>([base])
  if (specific) all.add(specific)
  return { primary: specific ?? base, all }
}

// ─── POI filter (lookup noise) ────────────────────────────────────────────
// A name-regex Overpass search returns everything carrying the name: bus
// stops, route relations, taxi ranks, info boards, entrance nodes. Only real
// venues should come back from /places/lookup.

const POI_KEYS = ["amenity", "tourism", "historic", "leisure", "shop", "healthcare", "office", "club", "craft"]
const NON_VENUE_AMENITY = new Set([
  "taxi", "parking", "parking_space", "parking_entrance", "bicycle_parking", "motorcycle_parking",
  "mobility_hub", "bus_station", "bench", "waste_basket", "vending_machine", "atm", "post_box",
  "telephone", "charging_station", "bicycle_rental", "car_sharing", "drinking_water", "fountain",
  "recycling", "shelter", "clock", "toilets",
])
const NON_VENUE_TOURISM = new Set(["information", "viewpoint", "artwork", "picnic_site"])

export function isVenueTags(tags: Tags): boolean {
  if (tags["type"] === "route" || tags["type"] === "route_master" || tags["public_transport"]) return false
  if (tags["highway"] || tags["railway"] === "platform") return false
  if (NON_VENUE_AMENITY.has(tags["amenity"] ?? "")) return false
  if (NON_VENUE_TOURISM.has(tags["tourism"] ?? "") && !tags["amenity"] && !tags["historic"]) return false
  if (tags["historic"] === "yes" && !("castle_type" in tags) && !tags["tourism"] && !tags["amenity"]) return false
  return POI_KEYS.some((k) => k in tags)
}

// ─── Accessibility fields ─────────────────────────────────────────────────

/** Step-free entrance from the venue's own tags. */
export function stepFreeFromTags(tags: Tags): YesNoUnknown {
  const ramp = tags["ramp:wheelchair"] ?? tags["ramp"]
  const steps = parseInt(tags["step_count"] ?? tags["entrance:step_count"] ?? "", 10)
  if (Number.isFinite(steps)) {
    if (steps === 0) return "yes"
    return ramp === "yes" ? "yes" : "no"
  }
  if (ramp === "yes") return "yes"
  return "unknown"
}

/** Step-free judgement of one OSM entrance node. */
export function stepFreeFromEntranceNode(tags: Tags): YesNoUnknown {
  const own = stepFreeFromTags(tags)
  if (own !== "unknown") return own
  // On an entrance node, wheelchair=* describes passing that very door.
  if (tags["wheelchair"] === "yes" || tags["wheelchair"] === "designated") return "yes"
  if (tags["wheelchair"] === "no") return "no"
  return "unknown"
}

/**
 * Combine entrance nodes: one step-free entrance is enough for "yes"; "no"
 * only when every entrance with data says no.
 */
export function combineEntrances(values: YesNoUnknown[]): YesNoUnknown {
  if (values.includes("yes")) return "yes"
  if (values.includes("no")) return "no"
  return "unknown"
}

export function elevatorFromTags(tags: Tags): YesNoUnknown {
  const v = tags["elevator:wheelchair"] ?? tags["elevator"]
  if (v === "yes" || v === "designated") return "yes"
  if (v === "no") return "no"
  return "unknown"
}

/** A highway=elevator node counts unless it is explicitly not wheelchair-usable. */
export function isUsableElevatorNode(tags: Tags): boolean {
  return tags["highway"] === "elevator" && tags["wheelchair"] !== "no"
}

const DIFFICULT_SURFACES = new Set([
  "cobblestone", "sett", "unhewn_cobblestone", "pebblestone", "gravel", "fine_gravel",
  "unpaved", "dirt", "ground", "earth", "grass", "sand", "mud", "woodchips", "compacted",
])

export function surfaceNotesFromTags(tags: Tags): string | null {
  const parts: string[] = []
  const surface = tags["surface"]
  if (surface) parts.push(`surface=${surface}${DIFFICULT_SURFACES.has(surface) ? " (difficult for wheelchairs)" : ""}`)
  if (tags["smoothness"]) parts.push(`smoothness=${tags["smoothness"]}`)
  if (tags["incline"])    parts.push(`incline=${tags["incline"]}`)
  return parts.length ? parts.join("; ") : null
}

export function descriptionFromTags(tags: Tags): string | null {
  const seen = new Set<string>()
  for (const k of ["wheelchair:description", "wheelchair:description:de", "wheelchair:description:en"]) {
    const v = tags[k]?.trim()
    if (v) seen.add(v)
  }
  return seen.size ? [...seen].join(" / ") : null
}

/** check_date of the wheelchair data as YYYY-MM-DD, if tagged. */
export function osmVerifiedDate(tags: Tags): string | null {
  const v = tags["check_date:wheelchair"] ?? tags["check_date"] ?? tags["survey:date"]
  return v && /^\d{4}-\d{2}(-\d{2})?$/.test(v) ? v : null
}
