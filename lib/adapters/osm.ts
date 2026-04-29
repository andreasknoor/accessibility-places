import type {
  Place,
  SearchParams,
  A11yValue,
  Category,
  EntranceDetails,
  ToiletDetails,
  ParkingDetails,
} from "../types"
import { buildAttribute, emptyAttribute } from "../matching/merge"
import { OVERPASS_ENDPOINTS, CATEGORY_OSM_TAGS } from "../config"
import { nanoid } from "../utils"

// ─── Overpass query builder ────────────────────────────────────────────────

// Build a case-insensitive Overpass regex for the user-supplied name hint.
// We do NOT use Overpass' `,i` flag: empirically, on overpass-api.de the flag
// silently returns zero results when combined with the multi-alternation
// amenity/tourism filter we use. Building a `[aA][bB][cC]` character-class
// regex is portable and behaves identically across Overpass mirrors.
// ASCII letters are case-paired; non-ASCII passes through (rare in OSM keys).
function buildOverpassNameRegex(hint: string): string {
  const escaped = hint.replace(/[\\^$.*+?()[\]{}|"]/g, "\\$&")
  return Array.from(escaped).map((ch) =>
    /[a-zA-Z]/.test(ch) ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : ch,
  ).join("")
}

export function buildOverpassQuery(params: SearchParams): string {
  const { location, radiusKm, categories, filters, nameHint } = params
  const r   = radiusKm * 1000
  const lat = location.lat
  const lon = location.lon

  // ── Name-targeted query ──────────────────────────────────────────────────
  // When the user is searching for a specific named place, skip the heavy
  // multi-alternation amenity/tourism filter and let Overpass use its name
  // index. Constrain to features that carry a POI key so streets and address
  // points named "Meiereiweg" etc. don't pollute results.
  if (nameHint) {
    const nm = `[name~"${buildOverpassNameRegex(nameHint)}"]`
    const poiKeys = ["amenity", "tourism", "shop", "craft", "leisure"] as const
    const clauses = poiKeys.map(
      (k) => `nwr(around:${r},${lat},${lon})${nm}[${k}];`,
    )
    return `[out:json][timeout:25];(${clauses.join("")});out 100 center tags;`
  }

  // ── Default category-driven query ────────────────────────────────────────
  // Collect all amenity and tourism values across requested categories
  const amenityVals = new Set<string>()
  const tourismVals = new Set<string>()

  for (const cat of categories) {
    const tags = CATEGORY_OSM_TAGS[cat]
    if (!tags) continue
    tags.amenity?.forEach((v) => amenityVals.add(v))
    tags.tourism?.forEach((v) => tourismVals.add(v))
  }

  // Pre-filter: when at least one accessibility criterion is active and unknown
  // places are excluded, restrict OSM results to wheelchair-tagged places.
  // This prevents fetching 100 untagged places that all fail post-processing.
  // OSM wheelchair= is a whole-place signal — sufficient as a pre-filter proxy.
  const anyActive = filters.entrance || filters.toilet || filters.parking
  const wc = (!filters.acceptUnknown && anyActive)
    ? `[wheelchair~"^(yes|limited|designated)$"]`
    : ""

  const clauses: string[] = []
  if (amenityVals.size > 0) {
    const vals = [...amenityVals].join("|")
    clauses.push(`nwr(around:${r},${lat},${lon})[amenity~"^(${vals})$"]${wc};`)
  }
  if (tourismVals.size > 0) {
    const vals = [...tourismVals].join("|")
    clauses.push(`nwr(around:${r},${lat},${lon})[tourism~"^(${vals})$"]${wc};`)
  }

  if (clauses.length === 0) return ""

  return `[out:json][timeout:25];(${clauses.join("")});out 100 center tags;`
}

// ─── OSM tag → A11yValue mapping ──────────────────────────────────────────

export function osmWheelchair(tags: Record<string, string>): A11yValue {
  const v = tags["wheelchair"]
  if (v === "yes" || v === "designated") return "yes"
  if (v === "limited") return "limited"
  if (v === "no") return "no"
  return "unknown"
}

export function osmToilet(tags: Record<string, string>): A11yValue {
  const v = tags["toilets:wheelchair"]
  if (v === "yes" || v === "designated") return "yes"
  if (v === "limited") return "limited"
  if (v === "no") return "no"
  return "unknown"
}

export function osmParking(tags: Record<string, string>): A11yValue {
  const cap = parseInt(tags["capacity:disabled"] ?? tags["capacity:wheelchair"] ?? "0", 10)
  if (cap > 0) return "yes"
  if (tags["parking_space"] === "disabled") return "yes"
  return "unknown"
}

function osmCategory(tags: Record<string, string>): Category {
  const amenity = tags["amenity"] ?? ""
  const tourism = tags["tourism"] ?? ""
  if (amenity === "cafe")                                              return "cafe"
  if (amenity === "restaurant")                                        return "restaurant"
  if (["bar","pub","biergarten"].includes(amenity))                    return "bar"
  if (["fast_food","food_court"].includes(amenity))                    return "fast_food"
  if (["hotel","motel","hostel","guest_house","apartment"].includes(tourism)) return "hotel"
  if (tourism === "museum")                                            return "museum"
  if (["theatre","cinema"].includes(amenity))                          return "theater"
  if (amenity === "library")                                           return "library"
  if (tourism === "gallery" || amenity === "arts_centre")              return "gallery"
  return "attraction"
}

function osmEntranceDetails(tags: Record<string, string>): EntranceDetails {
  return {
    isLevel:          tags["step_count"] === "0" ? true : undefined,
    hasRamp:          tags["ramp:wheelchair"] === "yes" ? true :
                      tags["ramp:wheelchair"] === "no"  ? false : undefined,
    stepCount:        tags["step_count"] ? parseInt(tags["step_count"], 10) : undefined,
    doorWidthCm:      tags["door:width"]  ? parseFloat(tags["door:width"])  : undefined,
    hasAutomaticDoor: tags["automatic_door"] === "yes" ? true :
                      tags["automatic_door"] === "no"  ? false : undefined,
    description:      tags["wheelchair:description"] ?? tags["wheelchair:description:de"] ?? undefined,
  }
}

function osmToiletDetails(tags: Record<string, string>): ToiletDetails {
  const val = tags["toilets:wheelchair"]
  const designated = val === "designated"
  return {
    isDesignated: designated ? true : undefined,
    // "designated" implies purpose-built accessible toilet → infer grab bars
    hasGrabBars:  designated ? true : undefined,
    isInside:     tags["toilets"] === "yes" ? true : undefined,
  }
}

function osmParkingDetails(tags: Record<string, string>): ParkingDetails {
  const count = parseInt(tags["capacity:disabled"] ?? tags["capacity:wheelchair"] ?? "0", 10)
  return {
    hasWheelchairSpaces: count > 0 || tags["parking_space"] === "disabled" ? true : undefined,
    spaceCount: count > 0 ? count : undefined,
  }
}

// ─── Parse Overpass element → Place ───────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function elementToPlace(el: any): Place | null {
  const tags: Record<string, string> = el.tags ?? {}
  const name = tags["name"] ?? tags["brand"] ?? ""
  if (!name) return null

  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  if (!lat || !lon) return null

  const wheelchairVal    = osmWheelchair(tags)
  const toiletVal        = osmToilet(tags)
  const parkingVal       = osmParking(tags)
  const entranceDetails  = osmEntranceDetails(tags)
  const toiletDetails    = osmToiletDetails(tags)
  const parkingDetails   = osmParkingDetails(tags)

  // OSM wheelchair= is a whole-place proxy → lower weight for entrance
  const entrance = buildAttribute("osm", wheelchairVal, tags["wheelchair"] ?? "", entranceDetails, true)
  const toilet   = buildAttribute("osm", toiletVal,     tags["toilets:wheelchair"] ?? "", toiletDetails)
  const parking  = buildAttribute("osm", parkingVal,    tags["capacity:disabled"] ?? tags["parking_space"] ?? "", parkingDetails)

  return {
    id: nanoid(),
    name,
    category: osmCategory(tags),
    address: {
      street:      tags["addr:street"]     ?? "",
      houseNumber: tags["addr:housenumber"] ?? "",
      postalCode:  String(tags["addr:postcode"] ?? ""),
      city:        tags["addr:city"]        ?? tags["addr:town"] ?? "",
      country:     tags["addr:country"]     ?? "DE",
      raw:         [tags["addr:street"], tags["addr:housenumber"], tags["addr:city"]].filter(Boolean).join(", "),
    },
    coordinates: { lat, lon },
    website: tags["website"] ?? tags["contact:website"] ?? undefined,
    phone:   tags["phone"]   ?? tags["contact:phone"]   ?? undefined,
    accessibility: {
      entrance,
      toilet,
      parking,
    },
    overallConfidence: 0,
    primarySource: "osm",
    osmWheelchairIsOverall: wheelchairVal !== "unknown",
    sourceRecords: [{
      sourceId:   "osm",
      externalId: String(el.id),
      fetchedAt:  new Date().toISOString(),
      raw:        tags,
    }],
  }
}

// ─── Public adapter function ───────────────────────────────────────────────

export async function fetchOsm(params: SearchParams): Promise<Place[]> {
  const query = buildOverpassQuery(params)
  if (!query) return []

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent":   "AccessibleSpaces/1.0 (accessibility search app)",
  }
  const body = `data=${encodeURIComponent(query)}`

  let lastError: Error | null = null
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body,
        headers,
        signal: AbortSignal.timeout(28_000),
      })
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`Overpass ${endpoint} returned ${res.status}`)
        continue
      }
      if (!res.ok) throw new Error(`Overpass API error: ${res.status}`)
      const json = await res.json()
      const places: Place[] = []
      for (const el of json.elements ?? []) {
        const place = elementToPlace(el)
        if (place) places.push(place)
      }
      return places
    } catch (err) {
      if ((err as Error).message?.includes("Overpass") && (err as Error).message?.includes("returned")) {
        lastError = err as Error
        continue
      }
      throw err
    }
  }

  throw lastError ?? new Error("All Overpass endpoints failed")
}
