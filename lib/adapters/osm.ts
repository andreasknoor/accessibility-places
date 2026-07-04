import type {
  Place,
  SearchParams,
  A11yValue,
  AmenityType,
  AmenityTier,
  AmenityFeature,
  Category,
  EntranceDetails,
  ToiletDetails,
  ParkingDetails,
} from "../types"
import { buildAttribute, emptyAttribute } from "../matching/merge"
import { CATEGORY_OSM_TAGS, endpointsForCoordinates, PUBLIC_OVERPASS_ENDPOINTS } from "../config"
import { nanoid } from "../utils"

const OVERPASS_BASE_HEADERS: Record<string, string> = {
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent":   "AccessibleSpaces/1.0 (accessibility search; mailto:andreas.knoor@gmail.com)",
}

// Per-endpoint headers for the parallel Overpass race. Attaches the shared-secret
// `X-AP-Key` ONLY to the private (self-hosted) endpoint — never to public mirrors,
// which would leak the secret to a third party. Inert unless OVERPASS_PRIVATE_KEY
// is set, so the change is a no-op until the server enforces it (see
// docs/overpass-server.md for the lockout-free rollout order).
export function overpassHeaders(endpoint: string): Record<string, string> {
  const key = process.env.OVERPASS_PRIVATE_KEY
  if (key && !PUBLIC_OVERPASS_ENDPOINTS.includes(endpoint)) {
    return { ...OVERPASS_BASE_HEADERS, "X-AP-Key": key }
  }
  return OVERPASS_BASE_HEADERS
}

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
  const { location, radiusKm, categories, filters } = params
  const r   = radiusKm * 1000
  const lat = location.lat
  const lon = location.lon

  // ── Place-search: name-based query ───────────────────────────────────────
  // Used when the user searches for a specific known place by name.
  // No accessibility pre-filter — we want to find the place regardless of tags.
  if (params.placeSearch && params.nameHint) {
    const regex  = buildOverpassNameRegex(params.nameHint)
    const around = `(around:${r},${lat},${lon})`
    const nf     = `["name"~"${regex}"]`
    return `[out:json][timeout:12];(node${nf}${around};way${nf}${around};relation${nf}${around};);out 200 center tags;`
  }

  // ── Category-driven query ─────────────────────────────────────────────────
  // Collect all amenity, tourism, and shop values across requested categories
  const amenityVals = new Set<string>()
  const tourismVals = new Set<string>()
  const shopVals    = new Set<string>()

  for (const cat of categories) {
    const tags = CATEGORY_OSM_TAGS[cat]
    if (!tags) continue
    tags.amenity?.forEach((v) => amenityVals.add(v))
    tags.tourism?.forEach((v) => tourismVals.add(v))
    tags.shop?.forEach((v)    => shopVals.add(v))
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

  // Emit node + way clauses for each filter set. Relations are rare for
  // venues and expensive for Overpass to compute — omitting them has
  // negligible impact on result quality while speeding up server-side eval.
  function addClauses(tag: string, vals: string): void {
    const filter = `(around:${r},${lat},${lon})[${tag}~"^(${vals})$"]${wc}${verified};`
    clauses.push(`node${filter}`)
    clauses.push(`way${filter}`)
  }

  const clauses: string[] = []
  if (amenityVals.size > 0) addClauses("amenity", [...amenityVals].join("|"))
  if (tourismVals.size > 0) addClauses("tourism", [...tourismVals].join("|"))
  if (shopVals.size    > 0) addClauses("shop",    [...shopVals].join("|"))

  if (clauses.length === 0) return ""

  // timeout:12 — fail fast so the parallel endpoint race can declare a winner.
  return `[out:json][timeout:12];(${clauses.join("")});out 200 center tags;`
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
  if (tags["disabled"] === "designated") return "yes"
  return "unknown"
}

function osmCategory(tags: Record<string, string>): Category {
  const amenity = tags["amenity"] ?? ""
  const tourism = tags["tourism"] ?? ""
  const shop    = tags["shop"]    ?? ""
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
  if (amenity === "ice_cream")                                         return "cafe"  // merged into cafe
  if (amenity === "pharmacy")                                          return "pharmacy"
  if (amenity === "doctors" || amenity === "clinic")                   return "doctors"
  if (amenity === "dentist")                                           return "dentist"
  if (amenity === "veterinary")                                        return "veterinary"
  if (amenity === "hospital")                                          return "hospital"
  if (shop === "chemist")                                              return "chemist"
  if (shop === "supermarket")                                          return "supermarket"
  if (shop === "bakery")                                               return "bakery"
  if (shop === "hairdresser")                                          return "hairdresser"
  if (amenity === "bank")                                              return "bank"
  if (amenity === "post_office")                                       return "post_office"
  if (tourism === "zoo" || tourism === "aquarium")                     return "zoo"
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
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

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

  // OSM-style "type/id" — stable across requests so that selectedId/scrollToId
  // survive a "Filter anwenden" rerun.
  const externalId = `${el.type ?? "node"}/${el.id}`

  return {
    id: `osm:${externalId}`,
    name,
    category: osmCategory(tags),
    address: {
      street:      tags["addr:street"]     ?? "",
      houseNumber: tags["addr:housenumber"] ?? "",
      postalCode:  String(tags["addr:postcode"] ?? ""),
      city:        tags["addr:city"]        ?? tags["addr:town"] ?? "",
      country:     tags["addr:country"]     ?? undefined,
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
      externalId,
      fetchedAt:  new Date().toISOString(),
      raw:        tags,
      metadata:   tags,
    }],
  }
}

// ─── Public adapter function ───────────────────────────────────────────────

export async function fetchOsm(params: SearchParams): Promise<{ places: Place[]; winnerEndpoint: string }> {
  const query = buildOverpassQuery(params)
  if (!query) return { places: [], winnerEndpoint: "" }

  const body = `data=${encodeURIComponent(query)}`

  // Race all endpoints in parallel — the first successful response wins and
  // the rest are aborted. This removes the sequential worst-case latency
  // (28 s × 3 = 84 s) and naturally deprioritises slow mirrors at runtime.
  const cancelRace = new AbortController()
  const t0 = Date.now()
  // Region-aware endpoint set: outside DACH in international mode the DACH-only
  // private server is dropped so it cannot win the race with an empty response.
  const endpoints = endpointsForCoordinates(params.location.lat, params.location.lon, params.international ?? false)

  try {
    const { json, winner } = await Promise.any(
      endpoints.map(async (endpoint) => {
        const signal = params.signal
          ? AbortSignal.any([params.signal, cancelRace.signal, AbortSignal.timeout(20_000)])
          : AbortSignal.any([cancelRace.signal, AbortSignal.timeout(20_000)])

        const res = await fetch(endpoint, { method: "POST", body, headers: overpassHeaders(endpoint), signal })

        // Treat rate-limit and server errors as rejection so another endpoint
        // can win the race. Hard client errors (4xx other than 429) propagate.
        if (res.status === 429 || res.status >= 500)
          throw new Error(`Overpass ${endpoint} returned ${res.status}`)
        if (!res.ok) throw new Error(`Overpass API error: ${res.status}`)

        // Overpass sends an XML error page when it fails to parse the query
        // (before it sees [out:json]).  Detect and reject early so the race
        // can fall through to the other endpoint rather than surfacing a
        // confusing SyntaxError from res.json().
        // Only reject when content-type is explicitly non-JSON; when absent
        // (e.g. in test mocks) we try to parse anyway.
        const ct = res.headers?.get("content-type") ?? ""
        if (ct && !ct.includes("json")) throw new Error(`Overpass ${endpoint} returned non-JSON content-type: ${ct}`)

        return { json: await res.json(), winner: endpoint }
      }),
    )

    cancelRace.abort() // cancel any still-running fetches

    const places: Place[] = []
    for (const el of json.elements ?? []) {
      const place = elementToPlace(el)
      if (place) places.push(place)
    }
    return { places, winnerEndpoint: winner }
  } catch (err) {
    cancelRace.abort()
    // Unwrap AggregateError so the first underlying error (e.g. "returned 429",
    // "Overpass API error: 400") surfaces in logs rather than a generic message.
    if (err instanceof AggregateError) throw err.errors[0] ?? new Error("All Overpass endpoints failed")
    throw err
  }
}

// ─── Nearby accessible amenities fetch ────────────────────────────────────
//
// Fetches POI features (parking spots, wheelchair toilets) within a given
// radius for map display and optional venue enrichment.
// Failure of this query is non-fatal for the main search path.

// NearbyParkingFeature kept as a structural alias of AmenityFeature for
// callers that haven't migrated yet. amenityType defaults to "parking".
export type NearbyParkingFeature = AmenityFeature

// Parking enrichment is capped at 25 km regardless of the main search radius.
// Disabled parking beyond 25 km is irrelevant to a venue; the out-2000 cap
// is sufficient for dense DACH cities within this radius.
export const NEARBY_PARKING_MAX_RADIUS_KM = 25

export async function fetchOsmDisabledParking(
  location: { lat: number; lon: number },
  radiusKm: number,
  signal?: AbortSignal,
  // When true, additionally fetch the weak "accessible" tier: amenity=parking
  // lots tagged wheelchair=yes but WITHOUT any reserved-space tag (and excluding
  // pure street-side parking). Display-only — never used for venue enrichment.
  // Default false so callers that don't opt in (e.g. SEO pages) stay tier-A only.
  includeAccessibleTier = false,
  // Region-aware endpoint choice (mirrors the venue fetch): outside DACH in
  // international mode the private DACH-only server is dropped from the race.
  international = false,
): Promise<{ features: AmenityFeature[]; winnerEndpoint: string; durationMs: number }> {
  const r = Math.min(radiusKm + 0.5, NEARBY_PARKING_MAX_RADIUS_KM) * 1000
  const { lat, lon } = location

  // Six orthogonal disabled-parking signals in OSM. We union them so the
  // query catches both "lot with N disabled spaces" and "single dedicated
  // disabled parking space" features.
  // Keys containing ":" must be quoted in Overpass QL — unquoted colons are
  // a syntax error and cause a 400 response (silently swallowed by the caller).
  // 500 results: denser cities (Berlin, München) can have hundreds of
  // disabled-parking features; 200 was silently truncating at high density.
  // way only (not nwr): amenity=parking with capacity data is almost always a
  // polygon way; relations are rare multipolygons (<5% of DACH features) and
  // scanning them causes disproportionate Overpass load → 504s.
  // amenity=parking_space covers both node and way: iD editor creates polygon
  // ways for individual spaces when drawn as areas, not just point nodes.
  // Weak "accessible" tier (opt-in): amenity=parking lots that are merely tagged
  // wheelchair=yes, without any reserved-space marker, and excluding pure
  // street-side / lane parking (which is unspecific kerbside parking, not a lot).
  // way only — these are polygons like the other amenity=parking clauses.
  const accessibleClause = includeAccessibleTier
    ? `way(around:${r},${lat},${lon})[amenity=parking][wheelchair=yes]` +
      `[!"capacity:disabled"][!"capacity:wheelchair"]["disabled"!="designated"]` +
      `["parking"!~"street_side|lane"];`
    : ""

  const query = `[out:json][timeout:30];(` +
    `way(around:${r},${lat},${lon})[amenity=parking]["capacity:disabled"];` +
    `way(around:${r},${lat},${lon})[amenity=parking]["capacity:wheelchair"];` +
    `way(around:${r},${lat},${lon})[amenity=parking][disabled=designated];` +
    `node(around:${r},${lat},${lon})[amenity=parking_space][parking_space=disabled];` +
    `node(around:${r},${lat},${lon})[amenity=parking_space][wheelchair=designated];` +
    `way(around:${r},${lat},${lon})[amenity=parking_space][parking_space=disabled];` +
    `way(around:${r},${lat},${lon})[amenity=parking_space][wheelchair=designated];` +
    accessibleClause +
    `);out 2000 center tags;`

  const body = `data=${encodeURIComponent(query)}`

  function parseFeatures(json: { elements?: unknown[] }): AmenityFeature[] {
    const out: NearbyParkingFeature[] = []
    for (const el of json.elements ?? []) {
      const e = el as Record<string, unknown>
      // Lat/lon for nodes is on the element; for ways/relations Overpass
      // returns it under `center` because we requested `out center`.
      const center = e.center as Record<string, unknown> | undefined
      const featLat = typeof e.lat === "number" ? e.lat : typeof center?.lat === "number" ? center.lat : undefined
      const featLon = typeof e.lon === "number" ? e.lon : typeof center?.lon === "number" ? center.lon : undefined
      if (featLat === undefined || featLon === undefined) continue
      const tags = (e.tags ?? {}) as Record<string, string>
      const cap = parseInt(tags["capacity:disabled"] ?? tags["capacity:wheelchair"] ?? "", 10)
      // Skip features that explicitly declare zero (or negative) disabled spaces.
      // capacity:disabled=0 is a valid but contradictory tag; honour it by dropping
      // the feature rather than treating it as an implicit single space.
      const hasCapacityTag = "capacity:disabled" in tags || "capacity:wheelchair" in tags
      if (hasCapacityTag && Number.isFinite(cap) && cap <= 0) continue
      const fee     = tags["fee"]     || undefined
      const maxstay = tags["maxstay"] || undefined
      const access  = tags["access"]  || undefined
      // Tier inference from tags (the Overpass union doesn't reveal which clause
      // matched): a feature is the weak "accessible" tier only when it is an
      // amenity=parking lot tagged wheelchair=yes with NO reserved-space marker.
      // Everything else — capacity:disabled, parking_space=disabled,
      // *=designated — is the strong "disabled" tier.
      const isWeakTier =
        tags["amenity"] === "parking" &&
        tags["wheelchair"] === "yes" &&
        !hasCapacityTag &&
        tags["disabled"] !== "designated"
      const tier: AmenityTier = isWeakTier ? "weak" : "strong"
      const osmId = typeof e.id === "number" ? `${e.type ?? "node"}/${e.id}` : undefined
      out.push({ amenityType: "parking", lat: featLat, lon: featLon, capacity: cap > 0 ? cap : undefined, fee, maxstay, access, tier, osmId })
    }
    return out
  }

  // Race both endpoints in parallel (same strategy as the main OSM venue fetch).
  // First successful response wins; if both fail the caller gets [].
  const t0parking = Date.now()
  try {
    const sig = (endpoint: string) => signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000)

    const { features: rawFeatures, winner: parkingWinner } = await Promise.any(
      endpointsForCoordinates(lat, lon, international).map(async (endpoint) => {
        const res = await fetch(endpoint, { method: "POST", body, headers: overpassHeaders(endpoint), signal: sig(endpoint) })
        if (!res.ok) throw new Error(`[parking] ${endpoint} → HTTP ${res.status}`)
        const ct = res.headers?.get("content-type") ?? ""
        if (ct && !ct.includes("json")) throw new Error(`[parking] ${endpoint} returned non-JSON content-type: ${ct}`)
        return { features: parseFeatures(await res.json()), winner: endpoint }
      }),
    )
    const durationMs = Date.now() - t0parking
    return { features: rawFeatures, winnerEndpoint: parkingWinner, durationMs }
  } catch (err) {
    // AggregateError means both endpoints failed; log so Vercel Function Logs
    // capture the frequency, then re-throw so the caller can record a stat.
    const errors = err instanceof AggregateError ? err.errors : [err]
    for (const e of errors) console.warn("[parking] endpoint failed:", e instanceof Error ? e.message : String(e))
    throw err
  }
}

// ─── Generic accessible-amenities fetch ───────────────────────────────────
//
// Fetches one or more amenity types (parking, toilet) in a single Overpass
// round-trip. Parking clauses are identical to fetchOsmDisabledParking;
// toilet clauses cover both standalone WCs (amenity=toilets) and any venue
// that tags its own WC (toilets:wheelchair=yes/designated).
//
// WC Clause ①: standalone public toilets
//   node/way[amenity=toilets][wheelchair=yes|designated]
// WC Clause ②: venues with their own accessible WC
//   nwr[toilets:wheelchair=yes|designated][access!=private][access!=no]
//
// Both clauses produce AmenityFeature records with amenityType="toilet".
// Clause ② sets host={kind:"venue", name, access} for popup labelling.
// Dedup is NOT done here — caller can apply a distance-based dedup if needed.

export async function fetchOsmAccessibleAmenities(
  location: { lat: number; lon: number },
  radiusKm: number,
  types: AmenityType[],
  opts?: {
    signal?: AbortSignal
    includeWeakTier?: boolean  // include weak parking tier (display-only)
    international?: boolean     // region-aware endpoint choice (see endpointsForCoordinates)
  },
): Promise<{ features: AmenityFeature[]; winnerEndpoint: string; durationMs: number }> {
  const r = Math.min(radiusKm + 0.5, NEARBY_PARKING_MAX_RADIUS_KM) * 1000
  const { lat, lon } = location
  const { signal, includeWeakTier = false, international = false } = opts ?? {}

  const parkingClauses = types.includes("parking") ? [
    `way(around:${r},${lat},${lon})[amenity=parking]["capacity:disabled"];`,
    `way(around:${r},${lat},${lon})[amenity=parking]["capacity:wheelchair"];`,
    `way(around:${r},${lat},${lon})[amenity=parking][disabled=designated];`,
    `node(around:${r},${lat},${lon})[amenity=parking_space][parking_space=disabled];`,
    `node(around:${r},${lat},${lon})[amenity=parking_space][wheelchair=designated];`,
    `way(around:${r},${lat},${lon})[amenity=parking_space][parking_space=disabled];`,
    `way(around:${r},${lat},${lon})[amenity=parking_space][wheelchair=designated];`,
    ...(includeWeakTier ? [
      `way(around:${r},${lat},${lon})[amenity=parking][wheelchair=yes]` +
      `[!"capacity:disabled"][!"capacity:wheelchair"]["disabled"!="designated"]` +
      `["parking"!~"street_side|lane"];`,
    ] : []),
  ] : []

  // WC Clause ①: standalone public toilets (node + way)
  // WC Clause ②: any venue that tags its own WC (nwr = node+way+relation)
  //   access=private/no excluded — these are personal staff toilets.
  //   access=customers is intentionally included: user can ask to use it.
  const toiletClauses = types.includes("toilet") ? [
    `node(around:${r},${lat},${lon})[amenity=toilets][wheelchair=designated];`,
    `node(around:${r},${lat},${lon})[amenity=toilets][wheelchair=yes];`,
    `way(around:${r},${lat},${lon})[amenity=toilets][wheelchair=designated];`,
    `way(around:${r},${lat},${lon})[amenity=toilets][wheelchair=yes];`,
    `node(around:${r},${lat},${lon})["toilets:wheelchair"="designated"]["access"!="private"]["access"!="no"];`,
    `node(around:${r},${lat},${lon})["toilets:wheelchair"="yes"]["access"!="private"]["access"!="no"];`,
    `way(around:${r},${lat},${lon})["toilets:wheelchair"="designated"]["access"!="private"]["access"!="no"];`,
    `way(around:${r},${lat},${lon})["toilets:wheelchair"="yes"]["access"!="private"]["access"!="no"];`,
    `relation(around:${r},${lat},${lon})["toilets:wheelchair"="designated"]["access"!="private"]["access"!="no"];`,
    `relation(around:${r},${lat},${lon})["toilets:wheelchair"="yes"]["access"!="private"]["access"!="no"];`,
  ] : []

  const allClauses = [...parkingClauses, ...toiletClauses]
  if (allClauses.length === 0) return { features: [], winnerEndpoint: "", durationMs: 0 }

  const query = `[out:json][timeout:30];(${allClauses.join("")});out 1000 center tags;`
  const body  = `data=${encodeURIComponent(query)}`

  function parseAmenityFeatures(json: { elements?: unknown[] }): AmenityFeature[] {
    const out: AmenityFeature[] = []
    for (const el of json.elements ?? []) {
      const e      = el as Record<string, unknown>
      const center = e.center as Record<string, unknown> | undefined
      const featLat = typeof e.lat === "number" ? e.lat : typeof center?.lat === "number" ? center.lat : undefined
      const featLon = typeof e.lon === "number" ? e.lon : typeof center?.lon === "number" ? center.lon : undefined
      if (featLat === undefined || featLon === undefined) continue
      const tags   = (e.tags ?? {}) as Record<string, string>
      const osmId  = typeof e.id === "number" ? `${e.type ?? "node"}/${e.id}` : undefined

      // ── Determine amenity type from tags ──
      const isStandaloneToilet = tags["amenity"] === "toilets"
      const hasVenueToilet     = "toilets:wheelchair" in tags
      const isParking          = tags["amenity"] === "parking" || tags["amenity"] === "parking_space"

      if (isStandaloneToilet || hasVenueToilet) {
        // Toilet feature
        const twcVal   = tags["toilets:wheelchair"] ?? tags["wheelchair"] ?? ""
        const isStrong = twcVal === "designated" || twcVal === "yes"
        if (!isStrong) continue  // only yes/designated pass
        const access = tags["access"] || undefined
        if (access === "private" || access === "no") continue

        const tier: AmenityTier       = twcVal === "designated" ? "strong" : "weak"
        const euroKey                 = tags["centralkey"] === "eurokey" ? true : undefined
        const changingTable           = tags["changing_table"] === "yes" ? true : undefined
        const host: AmenityFeature["host"] = hasVenueToilet && !isStandaloneToilet
          ? { kind: "venue", name: tags["name"] || undefined, access }
          : { kind: "standalone" }

        out.push({ amenityType: "toilet", lat: featLat, lon: featLon, tier, access, osmId,
          ...(euroKey       ? { euroKey }       : {}),
          ...(changingTable ? { changingTable } : {}),
          host,
        })
      } else if (isParking) {
        // Parking feature (same logic as fetchOsmDisabledParking)
        const cap = parseInt(tags["capacity:disabled"] ?? tags["capacity:wheelchair"] ?? "", 10)
        const hasCapacityTag = "capacity:disabled" in tags || "capacity:wheelchair" in tags
        if (hasCapacityTag && Number.isFinite(cap) && cap <= 0) continue
        const isWeakTier =
          tags["amenity"] === "parking" &&
          tags["wheelchair"] === "yes" &&
          !hasCapacityTag &&
          tags["disabled"] !== "designated"
        const tier: AmenityTier = isWeakTier ? "weak" : "strong"
        const fee     = tags["fee"]     || undefined
        const maxstay = tags["maxstay"] || undefined
        const access  = tags["access"]  || undefined
        out.push({ amenityType: "parking", lat: featLat, lon: featLon, tier,
          ...(cap > 0   ? { capacity: cap } : {}),
          ...(fee       ? { fee }           : {}),
          ...(maxstay   ? { maxstay }       : {}),
          ...(access    ? { access }        : {}),
          ...(osmId     ? { osmId }         : {}),
        })
      }
    }
    return out
  }

  const t0 = Date.now()
  try {
    // Client abort must outlast the QL [timeout:30] above: at the 25 km max
    // radius a dense-area query can run long (measured ~15 s over Berlin
    // Mitte), and aborting client-side before the server's own deadline
    // discards completed Overpass work and shows a false "nothing found".
    // With 32 s the server verdict (result or its timeout error) always wins.
    const sig = () => signal
      ? AbortSignal.any([signal, AbortSignal.timeout(32_000)])
      : AbortSignal.timeout(32_000)

    const { features, winner } = await Promise.any(
      endpointsForCoordinates(lat, lon, international).map(async (endpoint) => {
        const res = await fetch(endpoint, { method: "POST", body, headers: overpassHeaders(endpoint), signal: sig() })
        if (!res.ok) throw new Error(`[amenities] ${endpoint} → HTTP ${res.status}`)
        const ct = res.headers?.get("content-type") ?? ""
        if (ct && !ct.includes("json")) throw new Error(`[amenities] ${endpoint} returned non-JSON: ${ct}`)
        return { features: parseAmenityFeatures(await res.json()), winner: endpoint }
      }),
    )
    return { features, winnerEndpoint: winner, durationMs: Date.now() - t0 }
  } catch (err) {
    const errors = err instanceof AggregateError ? err.errors : [err]
    for (const e of errors) console.warn("[amenities] endpoint failed:", e instanceof Error ? e.message : String(e))
    throw err
  }
}
