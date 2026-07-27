/**
 * Reisen für Alle adapter
 * API access via DSFT/Natko — request at: https://www.reisen-fuer-alle.de
 * Set REISEN_FUER_ALLE_API_KEY and REISEN_FUER_ALLE_API_BASE in .env.local
 *
 * The API returns certified tourism businesses with structured criteria results.
 * Certification is based on physical on-site inspection → highest reliability.
 */
import type {
  Place,
  SearchParams,
  A11yValue,
  Category,
  EntranceDetails,
  ToiletDetails,
  ParkingDetails,
} from "../types"
import { buildAttribute } from "../matching/merge"
import { nanoid } from "../utils"
import * as Sentry from "@sentry/nextjs"

// ─── Certification criteria codes used by Reisen für Alle ─────────────────
// These are illustrative — exact codes depend on the API contract.
// Update when you receive the API documentation.
const CRITERIA = {
  entrance: ["E01", "E02", "E03"],    // step-free, door width, ramp
  toilet:   ["T01", "T02", "T03"],    // grab bars, turning radius, door width
  parking:  ["P01"],                   // wheelchair parking spaces
} as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function criteriaValue(data: any, codes: readonly string[]): A11yValue {
  if (!data?.criteria) return "unknown"
  const relevant = data.criteria.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) => codes.includes(c.code),
  )
  if (relevant.length === 0) return "unknown"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const met    = relevant.filter((c: any) => c.fulfilled === true).length
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notMet = relevant.filter((c: any) => c.fulfilled === false).length
  if (met === relevant.length)           return "yes"
  if (met > 0 && notMet < relevant.length) return "limited"
  if (notMet === relevant.length)        return "no"
  return "unknown"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildEntranceDetails(data: any): EntranceDetails {
  if (!data?.criteria) return {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = (code: string) => data.criteria.find((c: any) => c.code === code)
  return {
    isLevel:          get("E01")?.fulfilled,
    doorWidthCm:      get("E02")?.value,
    hasRamp:          get("E03")?.fulfilled,
    hasAutomaticDoor: get("E04")?.fulfilled,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildToiletDetails(data: any): ToiletDetails {
  if (!data?.criteria) return {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = (code: string) => data.criteria.find((c: any) => c.code === code)
  return {
    hasGrabBars:           get("T01")?.fulfilled,
    grabBarsOnBothSides:   get("T01")?.value === "both",
    turningRadiusCm:       get("T02")?.value,
    doorWidthCm:           get("T03")?.value,
    hasEmergencyPullstring: get("T04")?.fulfilled,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildParkingDetails(data: any): ParkingDetails {
  if (!data?.criteria) return {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = (code: string) => data.criteria.find((c: any) => c.code === code)
  return {
    hasWheelchairSpaces: get("P01")?.fulfilled,
    spaceCount:          get("P01")?.value,
    distanceToEntranceM: get("P02")?.value,
  }
}

// ─── Category classification ───────────────────────────────────────────────
//
// EXACT MATCHING ONLY — never `.includes()`. The previous substring chain had
// the same latent defect proven live in the accessibility.cloud adapter (see
// FROM_ACLOUD's comment there: "public_transport" matched "pub", "barber"
// matched "bar"). Here the danger is acute and German-specific: `"bar"` is a
// substring of **"barrierefrei"** — the single most likely word to appear in
// a German accessibility certifier's type labels. Any such value would have
// been classified as a bar.
//
// Matching is two-stage, both stages exact:
//   1. the whole normalised value
//   2. any single token of it (split on non-letters)
// Stage 2 exists because this API's vocabulary is NOT verified — unlike
// A.Cloud, RfA's endpoint is not generally reachable, so a compound label
// like "Gastronomie / Restaurant" is plausible and would fail a whole-string
// match. Token matching handles that without ever matching inside a word:
// "barrierefrei" is one token and therefore cannot match the "bar" key.
const FROM_RFA: Record<string, Category> = {
  // Gastronomy
  cafe: "cafe", kaffee: "cafe", bistro: "cafe",
  restaurant: "restaurant", gastronomie: "restaurant",
  biergarten: "biergarten",
  pub: "pub", kneipe: "pub",
  bar: "bar",
  imbiss: "fast_food", schnellrestaurant: "fast_food",
  fastfood: "fast_food", fast_food: "fast_food",
  // Accommodation
  hostel: "hostel",
  apartment: "apartment", ferienwohnung: "apartment",
  hotel: "hotel", beherbergung: "hotel", unterkunft: "hotel", pension: "hotel",
  // Culture & leisure
  museum: "museum",
  kino: "cinema", cinema: "cinema",
  theater: "theater", oper: "theater",
  bibliothek: "library", "bücherei": "library",
  galerie: "gallery", gallery: "gallery",
  zoo: "zoo", tierpark: "zoo", aquarium: "zoo",
  sporthalle: "sports_centre", sports_centre: "sports_centre", sports_complex: "sports_centre",
  // Health
  apotheke: "pharmacy", pharmacy: "pharmacy",
  reha: "rehabilitation", rehabilitation: "rehabilitation",
  arzt: "doctors", arztpraxis: "doctors", praxis: "doctors", klinik: "doctors",
  zahnarzt: "dentist", dental: "dentist",
  tierarzt: "veterinary", veterinary: "veterinary",
  krankenhaus: "hospital", klinikum: "hospital", hospital: "hospital",
  // Shopping
  drogerie: "chemist", chemist: "chemist",
  supermarkt: "supermarket", supermarket: "supermarket", lebensmittel: "supermarket",
  "bäckerei": "bakery", "bäcker": "bakery", bakery: "bakery",
  metzgerei: "butcher", fleischerei: "butcher", butcher: "butcher",
  blumen: "florist", florist: "florist",
  buchhandlung: "books", books: "books",
  "schuhgeschäft": "shoes", shoes: "shoes",
  bekleidung: "clothes", clothes: "clothes",
  kiosk: "convenience", convenience: "convenience",
  fahrrad: "bicycle", bicycle: "bicycle",
  "möbel": "furniture", furniture: "furniture",
  // Everyday & services
  friseur: "hairdresser", "frisör": "hairdresser", hairdresser: "hairdresser",
  bank: "bank", sparkasse: "bank",
  postamt: "post_office", post: "post_office", post_office: "post_office", "post office": "post_office",
  waschsalon: "laundry", laundry: "laundry",
  tankstelle: "fuel", fuel: "fuel",
  fast: "fast_food",
}

// Same guard as the A.Cloud adapter's counterpart (see there for the full
// rationale): plain-object bracket access with an external string inherits
// Object.prototype, so `FROM_RFA["constructor"]`/`["__proto__"]` would
// otherwise resolve truthy instead of `undefined`.
function safeLookup<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined
}

// Same rationale as the A.Cloud adapter's counterpart: make vocabulary drift
// visible instead of letting it silently degrade categories. Doubly important
// here because unmatched values fall back to "attraction" rather than being
// dropped — a wrong-but-plausible category is harder to notice than a missing
// record. Module-scoped so one value warns once, not once per result. Also
// reported to GlitchTip at "warning" (not "info" like A.Cloud's) — an RfA miss
// silently mislabels a certified record as "attraction" rather than dropping
// it, which is a worse outcome than A.Cloud's drop-and-report.
const reportedUnknownRfaTypes = new Set<string>()
function reportUnknownRfaType(raw: string) {
  if (reportedUnknownRfaTypes.has(raw)) return
  reportedUnknownRfaTypes.add(raw)
  console.warn(`[reisen-fuer-alle] unclassified type "${raw}" — falling back to "attraction"; add it to FROM_RFA`)
  Sentry.captureMessage(`reisen-fuer-alle: unclassified type "${raw}"`, {
    level: "warning",
    tags:  { area: "adapter-vocabulary", source: "reisen_fuer_alle", value: raw },
  })
}

// Suffixes of common German shop compounds, stripped only when the remaining
// root is itself an exact FROM_RFA key. Deliberately short and curated — NOT
// a general substring-matching mechanism, which is exactly the class of bug
// this whole file was rewritten to eliminate. "haus" is deliberately excluded:
// far too many unrelated German words end in it to be a safe compound marker.
const COMPOUND_SUFFIXES = ["laden", "geschaeft", "geschäft", "markt", "zentrum", "praxis", "verleih"]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCategory(item: any): Category {
  const raw = String(item.type ?? item.category ?? "").trim().toLowerCase()
  if (!raw) return "attraction"

  const whole = safeLookup(FROM_RFA, raw)
  if (whole) return whole

  // Split on anything that isn't a letter/digit, keeping German umlauts and ß
  // as word characters so "bäckerei" survives as one token. Tokens are tried
  // in FROM_RFA's own declared key order (not the order they appear in `raw`)
  // so a compound like "Restaurant Bar" resolves deterministically to whichever
  // category this table lists first, an author-controlled priority — not an
  // incidental property of how the source happened to word the label.
  const tokens = new Set(raw.split(/[^a-z0-9äöüß]+/).filter(Boolean))
  for (const key of Object.keys(FROM_RFA)) {
    if (tokens.has(key)) {
      const mapped = safeLookup(FROM_RFA, key)
      if (mapped) return mapped
    }
  }

  // Stage 3: undelimited German compounds ("Fahrradladen", "Blumengeschäft")
  // stay as a single token after the split above and never hit stage 2. Try
  // stripping a known shop suffix and matching the bare root exactly.
  for (const suffix of COMPOUND_SUFFIXES) {
    if (raw.length > suffix.length && raw.endsWith(suffix)) {
      const root = raw.slice(0, raw.length - suffix.length)
      const mapped = safeLookup(FROM_RFA, root)
      if (mapped) return mapped
    }
  }

  reportUnknownRfaType(raw)
  return "attraction"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPlace(item: any): Place | null {
  if (!item?.name) return null
  const lat = parseFloat(item.lat ?? item.latitude ?? "")
  const lon = parseFloat(item.lon ?? item.longitude ?? "")
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

  const entranceVal = criteriaValue(item, CRITERIA.entrance)
  const toiletVal   = criteriaValue(item, CRITERIA.toilet)
  const parkingVal  = criteriaValue(item, CRITERIA.parking)

  const externalId = String(item.id ?? item.businessId ?? "")

  return {
    id: externalId ? `reisen_fuer_alle:${externalId}` : nanoid(),
    name:     item.name,
    category: mapCategory(item),
    address: {
      street:      item.street      ?? item.address?.street      ?? "",
      houseNumber: item.houseNumber ?? item.address?.houseNumber ?? "",
      postalCode:  String(item.zip ?? item.address?.zip ?? ""),
      city:        item.city        ?? item.address?.city        ?? "",
      country:     item.country     ?? "DE",
    },
    coordinates: { lat, lon },
    website: item.website ?? undefined,
    phone:   item.phone   ?? undefined,
    accessibility: {
      entrance: buildAttribute("reisen_fuer_alle", entranceVal, "rfa-certified", buildEntranceDetails(item)),
      toilet:   buildAttribute("reisen_fuer_alle", toiletVal,   "rfa-certified", buildToiletDetails(item)),
      parking:  buildAttribute("reisen_fuer_alle", parkingVal,  "rfa-certified", buildParkingDetails(item)),
    },
    overallConfidence: 0,
    primarySource: "reisen_fuer_alle",
    sourceRecords: [{
      sourceId:   "reisen_fuer_alle",
      externalId,
      fetchedAt:  new Date().toISOString(),
      raw:        item,
      metadata:   item,
    }],
  }
}

// ─── Public adapter function ───────────────────────────────────────────────

export async function fetchReisenFuerAlle(params: SearchParams): Promise<Place[]> {
  const apiKey  = process.env.REISEN_FUER_ALLE_API_KEY
  const apiBase = process.env.REISEN_FUER_ALLE_API_BASE

  // Skip silently when either value is missing or still a `your_…` placeholder.
  // Without this guard the live fetch produces a noisy ENOTFOUND stack on every
  // search since the public RfA API endpoint is not generally reachable.
  const isPlaceholder = (v?: string) => !v || v.startsWith("your_")
  if (isPlaceholder(apiKey) || isPlaceholder(apiBase)) return []

  const url = new URL(`${apiBase}/businesses`)
  url.searchParams.set("lat",    String(params.location.lat))
  url.searchParams.set("lon",    String(params.location.lon))
  url.searchParams.set("radius", String(params.radiusKm * 1000))
  url.searchParams.set("limit",  "100")

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept:        "application/json",
    },
    signal: params.signal
      ? AbortSignal.any([params.signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  })

  if (!res.ok) throw new Error(`Reisen für Alle API error: ${res.status}`)
  const json = await res.json()

  const places: Place[] = []
  for (const item of json.data ?? json.results ?? json ?? []) {
    const place = toPlace(item)
    if (place) places.push(place)
  }
  return places
}
