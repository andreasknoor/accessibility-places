/**
 * accessibility.cloud adapter
 * API key required: set ACCESSIBILITY_CLOUD_API_KEY in .env.local
 * Docs: https://www.accessibility.cloud/
 */
import type { Place, SearchParams, A11yValue, Category, EntranceDetails, ToiletDetails, ParkingDetails } from "../types"
import { buildAttribute } from "../matching/merge"
import { nanoid } from "../utils"
import * as Sentry from "@sentry/nextjs"

const BASE_URL = "https://accessibility-cloud-v2.freetls.fastly.net"

// Safe URL host extractor — returns "" when the input isn't a parseable URL
// so the caller doesn't have to wrap each access in a try/catch.
function safeHost(u: string): string {
  try { return new URL(u).host } catch { return "" }
}

// ─── LocalizedString helper ────────────────────────────────────────────────
// A11yJSON fields can be plain strings OR { de: "...", en: "..." } objects

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function localStr(v: any): string {
  if (!v) return ""
  if (typeof v === "string") return v
  if (typeof v === "object") return v.de ?? v.en ?? Object.values(v)[0] ?? ""
  return String(v)
}

// ─── A11yJSON helpers ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function a11yValue(props: any): A11yValue {
  const a = props?.accessibility
  if (!a) return "unknown"

  if (a.accessibleWith?.wheelchair === true)        return "yes"
  if (a.partiallyAccessibleWith?.wheelchair === true) return "limited"
  if (a.accessibleWith?.wheelchair === false)       return "no"

  // Infer from entrance data
  const entrance = a.entrances?.[0]
  if (entrance?.isLevel === true)  return "yes"
  if (entrance?.isLevel === false) return "no"

  return "unknown"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function a11yToiletValue(props: any): A11yValue {
  const restroom = props?.accessibility?.restrooms?.[0]
  if (!restroom) return "unknown"
  if (restroom.isAccessibleWithWheelchair === true)  return "yes"
  if (restroom.isAccessibleWithWheelchair === false) return "no"
  return "unknown"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function a11yParkingValue(props: any): A11yValue {
  const parking = props?.accessibility?.parking
  if (!parking) return "unknown"
  if (parking.forWheelchairUsers?.isAvailable === true)  return "yes"
  if (parking.forWheelchairUsers?.isAvailable === false) return "no"
  return "unknown"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function entranceDetails(props: any): EntranceDetails {
  const e = props?.accessibility?.entrances?.[0]
  if (!e) return {}
  return {
    isLevel:          e.isLevel,
    hasRamp:          e.hasFixedRamp ?? e.hasRemovableRamp,
    rampSlopePercent: e.slopeAngle?.value,
    doorWidthCm:      e.door?.width?.value,
    hasAutomaticDoor: e.door?.isAutomaticOrAlwaysOpen,
    hasHoist:         e.hasHoist,
    stepCount:        e.stairs?.stepCount,
    stepHeightCm:     e.stairs?.stepHeight?.value,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toiletDetails(props: any): ToiletDetails {
  const r = props?.accessibility?.restrooms?.[0]
  if (!r) return {}
  const gb = r.grabBars
  // grabBars object present → bars confirmed; absent → unknown (undefined, not false)
  const hasGrabBars = gb != null ? true : undefined
  return {
    hasGrabBars,
    // sub-attributes are meaningful only when grab bars are confirmed present
    grabBarsOnBothSides:    hasGrabBars ? (gb.onUsersLeftSide === true && gb.onUsersRightSide === true) : undefined,
    grabBarsFoldable:       hasGrabBars ? gb.foldable ?? undefined : undefined,
    turningRadiusCm:        r.turningSpaceInside?.width?.value,
    doorWidthCm:            r.entrance?.door?.width?.value ?? r.entrances?.[0]?.door?.width?.value,
    hasEmergencyPullstring: r.hasEmergencyPullstring === true ? true : undefined,
    // A.Cloud restrooms are implicitly inside the building
    isInside:               true,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parkingDetails(props: any): ParkingDetails {
  const p = props?.accessibility?.parking
  if (!p) return {}
  return {
    hasWheelchairSpaces: p.forWheelchairUsers?.isAvailable,
    spaceCount:          p.count,
  }
}

// ─── Category classification ───────────────────────────────────────────────
//
// EXACT-MATCH ONLY. This deliberately replaced a chain of `.includes()`
// substring tests, which silently mis-classified ~4.4% of all records because
// one source value can contain another as a substring:
//   "public_transport" → matched "pub"  → transit stops became pubs
//   "barber"           → matched "bar"  → hairdressers became bars
//   "public_art"       → matched "pub"  → public artworks became pubs
// A further ~4.4% were dropped despite having a valid target ("bread" →
// bakery, "icecream" → cafe, "sports_center" → the British-spelling-only
// check). Verified live against 6000 records across 6 DACH cities; the source
// vocabulary is closed and small (134 distinct plain-string values), so an
// exact-match table is both feasible and exhaustive. Substring matching must
// not be reintroduced here — see docs and the vocabulary fixture test.
// The key set is the UNION of two sources, deliberately: every value observed
// live (6000 records, 6 DACH cities) plus every key the previous substring
// chain was written against. The live sample is large but provably not
// exhaustive — it contained "coffee" but never "cafe", which the test fixtures
// show is also a real value. With exact matching, extra keys are free: they
// can only ever match themselves, so a superset costs nothing and guards
// against exactly that kind of sampling gap.
export const FROM_ACLOUD: Record<string, Category> = {
  // Gastronomy
  restaurant:        "restaurant",
  cafe:              "cafe",
  coffee:            "cafe",
  kaffee:            "cafe",
  icecream:          "cafe",        // ice cream is merged into cafe app-wide
  ice_cream:         "cafe",
  eisdiele:          "cafe",
  gelato:            "cafe",
  fastfood:          "fast_food",
  fast_food:         "fast_food",
  food_court:        "fast_food",
  pub:               "pub",
  kneipe:            "pub",
  bar:               "bar",
  biergarten:        "biergarten",
  // Accommodation
  hotel:             "hotel",
  lodging:           "hotel",
  motel:             "hotel",
  guest_house:       "hotel",
  hostel:            "hostel",
  apartment:         "apartment",
  ferienwohnung:     "apartment",
  caravan_site:      "camp_site",
  camp_site:         "camp_site",
  campingplatz:      "camp_site",
  camping:           "camp_site",
  // Culture & leisure
  museum:            "museum",
  theater:           "theater",
  theatre:           "theater",
  oper:              "theater",
  cinema:            "cinema",
  kino:              "cinema",
  library:           "library",
  bibliothek:        "library",
  art_gallery:       "gallery",
  gallery:           "gallery",
  galerie:           "gallery",
  attraction:        "attraction",
  theme_park:        "attraction",
  zoo:               "zoo",
  aquarium:          "zoo",
  tierpark:          "zoo",
  park:              "park",
  playground:        "playground",
  spielplatz:        "playground",
  swimming:          "swimming_pool",
  swimming_pool:     "swimming_pool",
  schwimmbad:        "swimming_pool",
  water_park:        "swimming_pool",
  fitness_centre:    "fitness_centre",
  fitness_center:    "fitness_centre",
  fitnessstudio:     "fitness_centre",
  sports_center:     "sports_centre",
  sports_centre:     "sports_centre",
  sports_complex:    "sports_centre",
  sporthalle:        "sports_centre",
  // Health
  pharmacy:          "pharmacy",
  apotheke:          "pharmacy",
  doctor:            "doctors",
  arztpraxis:        "doctors",
  clinic:            "doctors",
  praxis:            "doctors",
  dentist:           "dentist",
  zahnarzt:          "dentist",
  veterinary:        "veterinary",
  vet:               "veterinary",
  tierarzt:          "veterinary",
  hospital:          "hospital",
  krankenhaus:       "hospital",
  klinikum:          "hospital",
  rehabilitation:    "rehabilitation",
  reha:              "rehabilitation",
  physiotherapist:   "physiotherapist",
  physiotherapie:    "physiotherapist",
  hearing_aids:      "hearing_aids",
  "hörakustiker":    "hearing_aids",
  optician:          "optician",
  optiker:           "optician",
  medical_store:     "medical_supply",
  medical_supply:    "medical_supply",
  "sanitätshaus":    "medical_supply",
  // Shopping
  supermarket:       "supermarket",
  supermarkt:        "supermarket",
  bread:             "bakery",
  bakery:            "bakery",
  "bäckerei":        "bakery",
  backerei:          "bakery",
  butcher:           "butcher",
  metzgerei:         "butcher",
  fleischerei:       "butcher",
  chemist:           "chemist",
  drogerie:          "chemist",
  clothes:           "clothes",
  clothing_store:    "clothes",
  bekleidung:        "clothes",
  shoes:             "shoes",
  shoe_store:        "shoes",
  "schuhgeschäft":   "shoes",
  books:             "books",
  book_store:        "books",
  buchhandlung:      "books",
  furniture:         "furniture",
  "möbel":           "furniture",
  flowers:           "florist",
  florist:           "florist",
  blumen:            "florist",
  convenience_store: "convenience",
  convenience:       "convenience",
  bicycle_store:     "bicycle",
  bicycle_rental:    "bicycle",
  bicycle:           "bicycle",
  fahrrad:           "bicycle",
  // Everyday & services
  bank:              "bank",
  post_office:       "post_office",
  "post office":     "post_office",
  postamt:           "post_office",
  barber:            "hairdresser",
  hairdresser:       "hairdresser",
  friseur:           "hairdresser",
  "frisör":          "hairdresser",
  laundry:           "laundry",
  waschsalon:        "laundry",
  // Public & transit
  place_of_worship:  "place_of_worship",
  kirche:            "place_of_worship",
  church:            "place_of_worship",
  townhall:          "townhall",
  town_hall:         "townhall",
  rathaus:           "townhall",
  train_station:     "railway_station",
  railway_station:   "railway_station",
  bahnhof:           "railway_station",
  fuel:              "fuel",
  gas_station:       "fuel",
  tankstelle:        "fuel",
}

// Source values we have SEEN and deliberately do not adopt. Kept explicit so
// an unrecognised value can be told apart from a known-and-skipped one — the
// former means the source added something new and the table needs a decision,
// the latter is settled. Both are dropped; only the former is reported.
export const ACLOUD_KNOWN_UNMAPPED = new Set<string>([
  // Not a venue: transit infrastructure, street furniture, markers
  "undefined", "other", "public_transport", "bus_stop", "bus_station", "tram_stop",
  "subway_station", "platform", "train", "transport", "ferry", "parking", "atm",
  "toilets", "elevator", "drinkingwater", "memorial", "public_art", "viewpoint",
  "archaeological_site", "hiking", "house", "car_sharing", "car_rental",
  // Institutions / offices — out of scope for a venue search
  "government_office", "official", "police", "court", "embassy", "school",
  "university", "college", "kindergarten", "driving_school", "social_facility",
  "communitycentre", "association", "company", "insurance", "lawyer",
  // Real venues, but no matching Category in this app (yet)
  "jewelry", "department_store", "mall", "shopping", "electronics", "computers",
  "mobile_phones", "toys", "gifts", "stationery", "photography", "textiles",
  "art_shop", "instruments", "tools", "sports_shop", "pet_store", "garden_center",
  "interior_decoration", "video_store", "copyshop", "travel_agency", "kiosk",
  "currencyexchange", "2nd_hand", "alcohol", "beverages", "tea_shop", "deli",
  "organic_food", "food", "confectionery", "nightclub", "stripclub", "massage",
  "beautysalon", "ophthalmologist", "alternative_medicine", "bed_breakfast",
  "accommodation", "arts_center", "culture", "tourism", "leisure", "health",
])

// Object.hasOwn guard — REQUIRED whenever a lookup table like FROM_ACLOUD is
// indexed with an unsanitized external string. Plain-object bracket access
// inherits the Object.prototype chain: `FROM_ACLOUD["constructor"]` resolves
// to the Object constructor function, `FROM_ACLOUD["__proto__"]` to `{}` —
// both truthy, both would be silently returned in place of a real Category if
// a source ever emits one of those two literal strings. Verified live against
// the exported table; a plain `if (table[key])` check does not catch this.
function safeLookup<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined
}

// One-time-per-value reporting of vocabulary drift. Without this, a new source
// category is indistinguishable from a deliberately-skipped one and silently
// costs records — exactly how "bread" (a bakery) went unnoticed while being
// dropped. Module-scoped so a busy search doesn't repeat the same warning.
// Reported to GlitchTip (not just console.warn) at "info" level — matching the
// existing lib/search-rate-limit.ts convention — since a Vercel function's
// console output alone is not something anyone actively watches; without this,
// "the table needs updating" only becomes visible to someone who happens to be
// looking at logs, which is a materially weaker guarantee than the intent here.
const reportedUnknownCategories = new Set<string>()
function reportUnknownAcloudCategory(key: string) {
  if (reportedUnknownCategories.has(key)) return
  reportedUnknownCategories.add(key)
  console.warn(`[accessibility.cloud] unknown category "${key}" — record dropped; add it to FROM_ACLOUD or ACLOUD_KNOWN_UNMAPPED`)
  Sentry.captureMessage(`accessibility.cloud: unknown category "${key}"`, {
    level: "info",
    tags:  { area: "adapter-vocabulary", source: "accessibility_cloud", value: key },
  })
}

function classifyAcloudCategory(raw: unknown): Category | undefined {
  // Documented as a plain string in every one of 6000 sampled records, but the
  // array form is tolerated defensively: try every value rather than only the
  // first, since joining them (the old approach) is what made substring
  // collisions possible in the first place.
  const candidates = Array.isArray(raw) ? raw.map(String) : [String(raw ?? "")]
  const keys = candidates.map((c) => c.trim().toLowerCase()).filter(Boolean)

  for (const key of keys) {
    const mapped = safeLookup(FROM_ACLOUD, key)
    if (mapped) return mapped
  }

  // Only report once EVERY candidate has failed to match — reporting inside
  // the loop above would warn "record dropped" for an early candidate even
  // when a later one in the same array goes on to classify the record
  // successfully, which is simply an inaccurate message about what happened.
  for (const key of keys) {
    if (!ACLOUD_KNOWN_UNMAPPED.has(key)) reportUnknownAcloudCategory(key)
  }
  return undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCategory(props: any): Category | undefined {
  return classifyAcloudCategory(props?.category)
}

// ─── Parse one place from API response ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPlace(feature: any): Place | null {
  const props = feature.properties
  if (!props?.name) return null

  const coords = feature.geometry?.coordinates
  if (!coords) return null
  const [lon, lat] = coords

  const name = localStr(props.name)
  if (!name) return null

  const category = mapCategory(props)
  if (!category) return null   // unknown / off-topic A.Cloud category — drop the record

  // Records mirrored from Wheelmap are dropped entirely — see
  // docs/analysis/acloud-wheelmap-origin-2026-07.md. Wheelmap.org is itself
  // just an editing UI on OpenStreetMap (infoPageUrl → wheelmap.org/nodes/
  // {OSM node ID}), and the app's own OSM adapter already queries that exact
  // node live. Measured across 12 DACH locations: 83% of A.Cloud's records
  // here are this Wheelmap/OSM mirror, never richer than OSM (0% additional
  // structured detail — same bare entrance/toilet/parking yes/no OSM already
  // has), and 25% of the referenced OSM nodes had already been deleted
  // (verified live against the OSM API: HTTP 410) — A.Cloud simply hadn't
  // re-synced. Serving these would only ever duplicate or stale-shadow what
  // fetchOsm() returns fresh. Genuinely A.Cloud-only records (~9% of DACH
  // volume — small local accessibility surveys with no OSM/Ginto counterpart,
  // concentrated in rural AT/CH) are unaffected: they have no infoPageUrl
  // pointing at wheelmap.org. Other infoPageUrl hosts (e.g. Pfotenpiloten,
  // still used for the dog-policy enrichment below) are untouched by this.
  const infoPage = typeof props.infoPageUrl === "string" ? props.infoPageUrl : undefined
  if (infoPage && /(^|\.)wheelmap\.org$/i.test(safeHost(infoPage))) return null

  const addr = props.address ?? {}

  // Pull animal-policy info from any A.Cloud source that exposes it
  // (Pfotenpiloten is the main one). Attached as enrichment to the merged
  // place — does not get a top-level filter or source toggle.
  const a = props.accessibility ?? {}
  const allowsDogsRaw = a.animalPolicy?.allowsDogs
  const allowsDogs = allowsDogsRaw === true ? true : allowsDogsRaw === false ? false : undefined

  const hasWheelchairData =
    a.accessibleWith?.wheelchair          !== undefined ||
    a.partiallyAccessibleWith?.wheelchair !== undefined ||
    a.entrances?.[0]                      !== undefined ||
    a.restrooms?.[0]                      !== undefined ||
    a.parking                             !== undefined
  const dogPolicyOnly = allowsDogs !== undefined && !hasWheelchairData

  const externalId = feature._id ?? feature.id ?? ""

  return {
    id: externalId ? `accessibility_cloud:${externalId}` : nanoid(),
    name,
    category,
    address: {
      street:      localStr(addr.street),
      houseNumber: localStr(addr.housenumber),
      postalCode:  localStr(addr.postalCode),
      city:        localStr(addr.city ?? addr.locality),
      country:     localStr(addr.country) || "DE",
      raw:         localStr(addr.full) || undefined,
    },
    coordinates: { lat, lon },
    website: props.placeWebsiteUrl ?? undefined,
    phone:   props.phoneNumber     ?? undefined,
    // No wheelmapUrl here — any record that would have one is a Wheelmap
    // mirror and already returned null above.
    ...(allowsDogs    !== undefined ? { allowsDogs }    : {}),
    ...(dogPolicyOnly                ? { dogPolicyOnly } : {}),
    accessibility: {
      entrance: buildAttribute("accessibility_cloud", a11yValue(props),        "a11y-cloud", entranceDetails(props)),
      toilet:   buildAttribute("accessibility_cloud", a11yToiletValue(props),  "a11y-cloud", toiletDetails(props)),
      parking:  buildAttribute("accessibility_cloud", a11yParkingValue(props), "a11y-cloud", parkingDetails(props)),
    },
    overallConfidence: 0,
    primarySource: "accessibility_cloud",
    sourceRecords: [{
      sourceId:   "accessibility_cloud",
      externalId,
      fetchedAt:  new Date().toISOString(),
      raw:        props,
      metadata:   props,
    }],
  }
}

// ─── Public adapter function ───────────────────────────────────────────────

export async function fetchAccessibilityCloud(params: SearchParams): Promise<Place[]> {
  const apiKey = process.env.ACCESSIBILITY_CLOUD_API_KEY
  if (!apiKey) {
    console.warn("[accessibility.cloud] No API key — skipping")
    return []
  }

  const url = new URL(`${BASE_URL}/place-infos.json`)
  url.searchParams.set("appToken",  apiKey)
  url.searchParams.set("latitude",  String(params.location.lat))
  url.searchParams.set("longitude", String(params.location.lon))
  url.searchParams.set("radius",    String(params.radiusKm * 1000))
  url.searchParams.set("limit",     "100")

  url.searchParams.set("accessibilityPreset", "at-least-partially-accessible-by-wheelchair")

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: params.signal
      ? AbortSignal.any([params.signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  })

  if (!res.ok) throw new Error(`accessibility.cloud error: ${res.status}`)
  const json = await res.json()

  const places: Place[] = []
  for (const feature of json.features ?? []) {
    const place = toPlace(feature)
    if (place) places.push(place)
  }
  return places
}
