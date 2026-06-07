import type { SourceId, Category } from "./types"

// User-visible app version, shown in the header next to the subtitle.
// Bump on every meaningful release.
export const APP_VERSION = "3.142"

export const RELIABILITY_WEIGHTS: Record<SourceId, number> = {
  reisen_fuer_alle:    1.00,
  ginto:               0.90,
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

// Ginto entries get higher weights for more thoroughly documented detail levels
export const GINTO_LEVEL2_WEIGHT = 0.95
export const GINTO_LEVEL3_WEIGHT = 0.97

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
  google_places:       "Google Places",
  osm_parking:         "OSM Parking",
  osm_parking_private: "↳ Parking privat",
  osm_parking_public:  "↳ Parking öffentlich",
  osm_private:         "OpenStreetMap (privat)",
  osm_public:          "OpenStreetMap (öffentlich)",
  nominatim:           "Nominatim",
}

// Both are raced in parallel — the first successful response wins.
// overpass.osm.ch removed: returns 0 results for any non-CH query (Swiss-only data).
// overpass.private.coffee removed: same operator as kumi.systems, unreachable.
//
// Set OVERPASS_ENDPOINTS (comma-separated) to point to a private Overpass server,
// e.g. "https://overpass.example.com/api/interpreter". Multiple URLs retain the
// parallel-race behaviour. When unset, the two public mirrors are used.
const _overpassEnv = process.env.OVERPASS_ENDPOINTS
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean)

export const OVERPASS_ENDPOINTS: string[] = _overpassEnv?.length
  ? _overpassEnv
  : [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
    ]

export const OVERPASS_ENDPOINT = OVERPASS_ENDPOINTS[0]

// The two well-known public Overpass mirrors — used to distinguish private
// self-hosted endpoints from public ones in health checks and stats tracking.
export const PUBLIC_OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
]

// Set NOMINATIM_ENDPOINT to point to a private Nominatim instance.
// Trailing slash is stripped to keep URL construction consistent.
export const NOMINATIM_ENDPOINT =
  process.env.NOMINATIM_ENDPOINT?.replace(/\/$/, "") ??
  "https://nominatim.openstreetmap.org"

// OSM category → amenity/tourism tags
export const CATEGORY_OSM_TAGS: Record<Category, { amenity?: readonly string[]; tourism?: readonly string[] }> = {
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
}
