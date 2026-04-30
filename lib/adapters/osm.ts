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

  // onlyVerified narrows the query to places that carry *any* check_date tag
  // (`check_date`, `check_date:wheelchair`, `check_date:toilets:wheelchair`, …).
  // The regex-on-key syntax matches all variants in one clause; the post-fetch
  // adapter logic then validates the actual ≤ 2 years-old constraint and
  // discards places whose only check_date is on an unrelated tag (e.g.
  // `check_date:opening_hours`). Net effect: the 100-result cap fills with
  // ~2× as many genuinely verified places.
  const verified = filters.onlyVerified ? `[~"^check_date"~"."]` : ""

  const clauses: string[] = []
  if (amenityVals.size > 0) {
    const vals = [...amenityVals].join("|")
    clauses.push(`nwr(around:${r},${lat},${lon})[amenity~"^(${vals})$"]${wc}${verified};`)
  }
  if (tourismVals.size > 0) {
    const vals = [...tourismVals].join("|")
    clauses.push(`nwr(around:${r},${lat},${lon})[tourism~"^(${vals})$"]${wc}${verified};`)
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
  if (amenity === "bar")                                               return "bar"
  if (amenity === "pub")                                               return "pub"
  if (amenity === "biergarten")                                        return "biergarten"
  if (["fast_food","food_court"].includes(amenity))                    return "fast_food"
  if (["hotel","motel","guest_house"].includes(tourism))               return "hotel"
  if (tourism === "hostel")                                            return "hostel"
  if (tourism === "apartment")                                         return "apartment"
  if (tourism === "museum")                                            return "museum"
  if (amenity === "theatre")                                           return "theater"
  if (amenity === "cinema")                                            return "cinema"
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

// OSM `dog=*` convention: yes / no / leashed / outside / unknown.
// We map this to "may I bring my dog INSIDE the venue?". `outside` means dogs
// are tolerated only on the terrace/garden, which doesn't help when the user
// wants to actually sit indoors with their dog → treated as false.
export function osmAllowsDogs(tags: Record<string, string>): boolean | undefined {
  const v = (tags["dog"] ?? tags["dogs"] ?? "").toLowerCase()
  if (v === "yes" || v === "leashed") return true
  if (v === "no"  || v === "outside") return false
  return undefined
}

// OSM diet:* convention: `yes` (has options), `only` (exclusively that diet),
// `no` (none). We treat both `yes` and `only` as friendly. Vegan implies
// vegetarian-friendly even when `diet:vegetarian` isn't tagged separately.
export function osmDiet(tags: Record<string, string>): {
  isVegetarianFriendly?: boolean
  isVeganFriendly?: boolean
} {
  const parse = (v: string | undefined): boolean | undefined => {
    if (!v) return undefined
    const s = v.toLowerCase()
    if (s === "yes" || s === "only") return true
    if (s === "no") return false
    return undefined
  }
  const vegan = parse(tags["diet:vegan"])
  let vegetarian = parse(tags["diet:vegetarian"])
  if (vegan === true) vegetarian = true
  return {
    isVegetarianFriendly: vegetarian,
    isVeganFriendly:      vegan,
  }
}

function osmParkingDetails(tags: Record<string, string>): ParkingDetails {
  const count = parseInt(tags["capacity:disabled"] ?? tags["capacity:wheelchair"] ?? "0", 10)
  return {
    hasWheelchairSpaces: count > 0 || tags["parking_space"] === "disabled" ? true : undefined,
    spaceCount: count > 0 ? count : undefined,
  }
}

// ─── User-verified freshness boost ────────────────────────────────────────
// Wheelmap.org users (and OSM editors generally) write `check_date:wheelchair`
// when they confirm a wheelchair tag on-site. A recent date is a strong
// "this was actually verified" signal — boost the OSM weight 1.2× when the
// confirmation is < 2 years old. The buildAttribute helper caps the final
// weight at 1.0, so this only matters when the base weight isn't already there.

const RECENT_VERIFICATION_BOOST = 1.2
const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000

export function isRecentlyVerified(checkDate: string | undefined, now: number = Date.now()): boolean {
  if (!checkDate) return false
  const t = Date.parse(checkDate)
  if (Number.isNaN(t)) return false
  return now - t < TWO_YEARS_MS
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

  // Per-attribute Wheelmap/OSM verification: prefer the attribute-specific
  // check_date tag, fall back to the generic check_date covering the whole node.
  const entranceCheckDate = tags["check_date:wheelchair"]         ?? tags["check_date"]
  const toiletCheckDate   = tags["check_date:toilets:wheelchair"] ?? tags["check_date"]
  const entranceVerified  = isRecentlyVerified(entranceCheckDate)
  const toiletVerified    = isRecentlyVerified(toiletCheckDate)
  const entranceBoost     = entranceVerified ? RECENT_VERIFICATION_BOOST : 1.0
  const toiletBoost       = toiletVerified   ? RECENT_VERIFICATION_BOOST : 1.0

  // OSM wheelchair= is a whole-place proxy → lower weight for entrance
  const entrance = buildAttribute("osm", wheelchairVal, tags["wheelchair"] ?? "", entranceDetails, true,  entranceBoost, entranceVerified ? entranceCheckDate : undefined)
  const toilet   = buildAttribute("osm", toiletVal,     tags["toilets:wheelchair"] ?? "", toiletDetails, false, toiletBoost,   toiletVerified   ? toiletCheckDate   : undefined)
  const parking  = buildAttribute("osm", parkingVal,    tags["capacity:disabled"] ?? tags["parking_space"] ?? "", parkingDetails)

  const allowsDogs = osmAllowsDogs(tags)
  const diet       = osmDiet(tags)

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
    ...(allowsDogs !== undefined ? { allowsDogs } : {}),
    ...(diet.isVegetarianFriendly !== undefined ? { isVegetarianFriendly: diet.isVegetarianFriendly } : {}),
    ...(diet.isVeganFriendly      !== undefined ? { isVeganFriendly:      diet.isVeganFriendly }      : {}),
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
      // OSM-style "type/id" so consumers (e.g. Wheelmap deep-link) can
      // distinguish nodes/ways/relations.
      externalId: `${el.type ?? "node"}/${el.id}`,
      fetchedAt:  new Date().toISOString(),
      raw:        tags,
    }],
  }
}

// ─── Public adapter function ───────────────────────────────────────────────

export async function fetchOsm(
  params: SearchParams,
  onAttempt?: (attempt: number, of: number) => void,
): Promise<Place[]> {
  const query = buildOverpassQuery(params)
  if (!query) return []

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent":   "AccessibleSpaces/1.0 (accessibility search app)",
  }
  const body = `data=${encodeURIComponent(query)}`
  const total = OVERPASS_ENDPOINTS.length

  let lastError: Error | null = null
  for (let i = 0; i < total; i++) {
    const endpoint = OVERPASS_ENDPOINTS[i]
    onAttempt?.(i + 1, total)
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
      const e   = err as Error
      const msg = e.message ?? ""
      const name = e.name    ?? ""
      // Retry on transient failures: timeouts, aborted fetches, network blips,
      // or the 429/5xx error above. Permanent errors (4xx other than 429,
      // malformed JSON, …) still propagate immediately.
      const transient =
        name === "TimeoutError"        ||
        name === "AbortError"          ||
        msg.includes("aborted")        ||
        msg.includes("fetch failed")   ||
        msg.includes("network")        ||
        (msg.includes("Overpass") && msg.includes("returned"))
      if (transient) {
        lastError = e
        continue
      }
      throw err
    }
  }

  throw lastError ?? new Error("All Overpass endpoints failed")
}
