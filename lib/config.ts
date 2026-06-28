import type { SourceId, Category } from "./types"

// User-visible app version, shown in the header next to the subtitle.
// Bump on every meaningful release.
export const APP_VERSION = "9.4"

export const RELIABILITY_WEIGHTS: Record<SourceId, number> = {
  reisen_fuer_alle:    1.00,
  ginto:               0.90,
  acceslibre:          0.90,
  accessibility_cloud: 0.70,
  osm:                 0.75,
  google_places:       0.35,
  osm_parking:         0,  // stats-only; never used as a place-attribution source
  osm_parking_private: 0,  // stats-only
  osm_parking_public:  0,  // stats-only
  osm_private:         0,  // stats-only; tracks requests won by private Overpass server
  osm_public:          0,  // stats-only; tracks requests won by public Overpass mirrors
  nominatim:           0,  // stats-only
}

// Ginto entries get higher weights for stronger approval levels
// (qualityInfo.approvalLevels: who vouches for the data — operator vs. external audit)
export const GINTO_SELF_DECLARED_WEIGHT = 0.94
export const GINTO_AUDITED_WEIGHT       = 1.0

// OSM wheelchair= main tag is a whole-place proxy, not entrance-specific
// → reduce its effective weight for entrance criterion
export const OSM_ENTRANCE_WEIGHT_FACTOR = 0.90

export const CONFIDENCE_THRESHOLDS = {
  high:   0.70,
  medium: 0.40,
} as const

export const DEFAULT_RADIUS_KM = 5
export const RADIUS_MIN_KM = 1
export const RADIUS_MAX_KM = 50

// Geo matching: two records within this distance are match candidates
export const GEO_MATCH_RADIUS_M = 80

// Trigram similarity threshold for name matching
export const NAME_SIMILARITY_THRESHOLD = 0.55

// Weighted match-score threshold to consider two records the same place
export const MATCH_SCORE_THRESHOLD = 0.72

export const SOURCE_LABELS: Record<SourceId, string> = {
  accessibility_cloud: "accessibility.cloud",
  osm:                 "OpenStreetMap",
  reisen_fuer_alle:    "Reisen für Alle",
  ginto:               "Ginto",
  acceslibre:          "AccèsLibre",
  google_places:       "Google Places",
  osm_parking:         "OSM Parking",
  osm_parking_private: "↳ Parking privat",
  osm_parking_public:  "↳ Parking öffentlich",
  osm_private:         "OpenStreetMap (privat)",
  osm_public:          "OpenStreetMap (öffentlich)",
  nominatim:           "Nominatim",
}

// Raced in parallel — the first successful response wins.
// Mirror history (all verified with REAL data queries, not just `out count`):
//   • overpass.osm.ch — Swiss-only data (0 results outside CH) → unusable as a
//     general mirror (it would win the race with an empty response).
//   • overpass.private.coffee / overpass.kumi.systems — same dead backend.
//   • overpass.openstreetmap.fr — returns HTTP 403 "only available to white-listed
//     usages" for real venue/parking queries (only trivial `out count` passes).
//     Removed 2026-06-16; it broke OSM outside DACH (where the private server is
//     intentionally dropped) and as the prod fallback #3.
// overpass-api.de is the only reliably-open public mirror; outside DACH it is the
// single available endpoint (its own per-IP fair-use limit can surface as 429).
//
// Set OVERPASS_ENDPOINTS (comma-separated) to put the private Overpass server
// first, e.g. "https://overpass.example.com/api/interpreter,https://overpass-api.de/api/interpreter".
// Multiple URLs retain the parallel-race behaviour. When unset, only the public
// mirror is used.
const _overpassEnv = process.env.OVERPASS_ENDPOINTS
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean)

export const OVERPASS_ENDPOINTS: string[] = _overpassEnv?.length
  ? _overpassEnv
  : [
      "https://overpass-api.de/api/interpreter",
    ]

export const OVERPASS_ENDPOINT = OVERPASS_ENDPOINTS[0]

// Well-known public Overpass mirrors — used to distinguish private self-hosted
// endpoints from public ones in health checks and stats tracking.
export const PUBLIC_OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
]

// ─── Supported regions (DACH + opt-in international allowlist) ───────────────
//
// Single source of truth for every geo gate in the app: region detection, the
// Nominatim `countrycodes` constraint (both forward-geocode paths), the Photon
// country-code filter in unified-suggest, and the OSM Overpass endpoint choice.
//
// DACH is always available. The international countries below are only reachable
// when the user opts into `internationalMode` (AppSettings, default off). Boxes
// are deliberately generous but must NOT extend into the DACH box — otherwise a
// border point could resolve to "intl" and lose the fast private Overpass server.
//
// Adding a country = one `{ code, bbox }` entry here + one regionForCoordinates
// unit test. Everything else derives from this list. SEO pages stay DACH-only.

export type BBox = readonly [number, number, number, number] // [minLon, minLat, maxLon, maxLat]

export const DACH_BBOX: BBox = [5.87, 45.82, 17.17, 55.06]
// String form for Photon's `bbox=` query param (forward geocoding autocomplete).
export const DACH_BBOX_STR = "5.87,45.82,17.17,55.06"
export const DACH_CODES = ["DE", "AT", "CH"] as const

// International countries (outside DACH), available only in international mode.
// bboxes from docs/plans/international-search.md (density-driven recommendation).
// Overseas territories deliberately excluded to keep boxes usable.
export const INTL_COUNTRIES: readonly { code: string; bbox: BBox }[] = [
  { code: "FR", bbox: [-5.14, 41.33,  9.56, 51.09] },
  { code: "GB", bbox: [-8.65, 49.84,  1.77, 60.86] },
  { code: "NL", bbox: [ 3.36, 50.75,  7.23, 53.56] },
  { code: "ES", bbox: [-18.16, 27.64, 4.33, 43.79] },
  { code: "IT", bbox: [ 6.63, 35.49, 18.52, 47.09] },
  { code: "US", bbox: [-124.85, 24.40, -66.88, 49.38] },
] as const

// All ISO-2 codes the app accepts when international mode is on.
export const SUPPORTED_COUNTRY_CODES = [
  ...DACH_CODES,
  ...INTL_COUNTRIES.map((c) => c.code),
] as const

export type Region = "dach" | "intl" | "outside"

function bboxContains(bbox: BBox, lat: number, lon: number): boolean {
  const [minLon, minLat, maxLon, maxLat] = bbox
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat
}

/**
 * Classifies a coordinate as DACH (private server + all sources), an in-allowlist
 * international country (public mirrors + global sources), or outside the
 * supported set. DACH is checked first so border overlaps resolve to DACH.
 */
export function regionForCoordinates(lat: number, lon: number): Region {
  if (bboxContains(DACH_BBOX, lat, lon)) return "dach"
  if (INTL_COUNTRIES.some((c) => bboxContains(c.bbox, lat, lon))) return "intl"
  return "outside"
}

/**
 * Classifies an ISO-3166 alpha-2 country code (e.g. Vercel's x-vercel-ip-country)
 * into the same three tiers, for the access-location-based international hint:
 *   "dach"    → fully supported, no hint
 *   "intl"    → in the opt-in allowlist (full support once enabled)
 *   "outside" → not in the allowlist (nearby works, name search does not)
 *   null      → unknown country (no header) → no hint
 */
export function accessTierForCountry(country: string | null | undefined): Region | null {
  if (!country) return null
  const c = country.toUpperCase()
  if ((DACH_CODES as readonly string[]).includes(c)) return "dach"
  if (INTL_COUNTRIES.some((x) => x.code === c)) return "intl"
  return "outside"
}

/** Nominatim `countrycodes` value (lowercase, comma-separated) for the active mode. */
export function countryCodesParam(international: boolean): string {
  const codes = international ? SUPPORTED_COUNTRY_CODES : DACH_CODES
  return codes.map((c) => c.toLowerCase()).join(",")
}

/**
 * Overpass endpoints to race for a given coordinate. In DACH (or when
 * international mode is off) the full list is used — the private Hetzner server
 * wins on speed. Outside DACH in international mode the private DACH-only server
 * is dropped so it cannot win the race with a valid-but-empty response; only the
 * public global mirrors are raced.
 */
export function endpointsForCoordinates(lat: number, lon: number, international: boolean): string[] {
  if (!international || regionForCoordinates(lat, lon) === "dach") return OVERPASS_ENDPOINTS
  const publicOnly = OVERPASS_ENDPOINTS.filter((e) => PUBLIC_OVERPASS_ENDPOINTS.includes(e))
  return publicOnly.length ? publicOnly : OVERPASS_ENDPOINTS
}

// Set NOMINATIM_ENDPOINT to point to a private Nominatim instance.
// Trailing slash is stripped to keep URL construction consistent.
export const NOMINATIM_ENDPOINT =
  process.env.NOMINATIM_ENDPOINT?.replace(/\/$/, "") ??
  "https://nominatim.openstreetmap.org"

// OSM category → amenity/tourism tags
export const CATEGORY_OSM_TAGS: Record<Category, { amenity?: readonly string[]; tourism?: readonly string[]; shop?: readonly string[] }> = {
  cafe:        { amenity: ["cafe"] },
  restaurant:  { amenity: ["restaurant"] },
  bar:         { amenity: ["bar"] },
  pub:         { amenity: ["pub"] },
  biergarten:  { amenity: ["biergarten"] },
  fast_food:   { amenity: ["fast_food", "food_court"] },
  hotel:       { tourism: ["hotel", "motel", "guest_house"] },
  hostel:      { tourism: ["hostel"] },
  apartment:   { tourism: ["apartment"] },
  museum:      { tourism: ["museum"] },
  theater:     { amenity: ["theatre"] },
  cinema:      { amenity: ["cinema"] },
  library:     { amenity: ["library"] },
  gallery:     { tourism: ["gallery"], amenity: ["arts_centre"] },
  attraction:  { tourism: ["attraction", "theme_park"] },
  ice_cream:   { amenity: ["ice_cream"] },
  pharmacy:    { amenity: ["pharmacy"] },
  doctors:     { amenity: ["doctors", "clinic"] },
  dentist:     { amenity: ["dentist"] },
  veterinary:  { amenity: ["veterinary"] },
  hospital:    { amenity: ["hospital"] },
  chemist:     { shop: ["chemist"] },
  supermarket: { shop: ["supermarket"] },
  bakery:      { shop: ["bakery"] },
  hairdresser: { shop: ["hairdresser"] },
  bank:        { amenity: ["bank"] },
  post_office: { amenity: ["post_office"] },
  zoo:         { tourism: ["zoo", "aquarium"] },
}
