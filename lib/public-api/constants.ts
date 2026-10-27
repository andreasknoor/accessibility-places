import type { ActiveSources, Category, SearchFilters } from "../types"

// Public, read-only JSON API (/api/v1/*). Licensing decisions behind the
// source set are documented in docs/public-api.md — in short: only ODbL-
// compatible data is republished, so the response as a whole is ODbL.
//   osm    ✔ ODbL
//   ginto  ✔ ODbL, and only entries flagged licenseInfo.isOpenData
//   accessibility.cloud ✘ per-source licences, unverified (pending Sozialhelden)
//   google_places       ✘ ToS forbids caching/redistribution
//   reisen_fuer_alle    ✘ contractual data, no redistribution right
//   acceslibre          ✘ France-only; the API is DACH-scoped
export const API_SOURCES: ActiveSources = {
  osm:                 true,
  ginto:               true,
  accessibility_cloud: false,
  google_places:       false,
  reisen_fuer_alle:    false,
  acceslibre:          false,
}

export const API_VERSION = "1"
export const API_LICENSE = "ODbL-1.0"

export const OSM_ATTRIBUTION =
  "© OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright"
export const GINTO_ATTRIBUTION =
  "Contains information from ginto (https://www.ginto.guide), made available under the ODbL 1.0 — https://opendatacommons.org/licenses/odbl/1-0/"

// Every upstream call (Overpass, Ginto, Photon) is aborted after this long.
// A timed-out source becomes a `warnings[]` entry, not a failed request.
export const UPSTREAM_TIMEOUT_MS = 8_000

// Fetch everything; the API filters on its own output fields afterwards.
export const API_FETCH_FILTERS: SearchFilters = {
  entrance:          false,
  toilet:            false,
  parking:           false,
  parkingNearby:     true,
  seating:           false,
  onlyVerified:      false,
  acceptUnknown:     true,
  alwaysShowParking: false,
  alwaysShowToilets: false,
  openNowOnly:       false,
}

// ─── Category vocabulary ──────────────────────────────────────────────────
// API categories = the app's own categories (with OSM's "theatre" spelling
// instead of the app-internal "theater") plus four API-only categories the
// app has no chip for. API-only categories are fetched with an extra OSM
// query (see osm-extra.ts) and recognised from the raw OSM tags.
export const API_ONLY_CATEGORIES = ["castle", "garden", "concert_hall", "arts_centre"] as const
export type ApiOnlyCategory = typeof API_ONLY_CATEGORIES[number]
export type ApiCategory = Exclude<Category, "theater"> | "theatre" | ApiOnlyCategory

// API category → app categories to run through the normal adapters.
export const API_TO_APP_CATEGORIES: Partial<Record<ApiCategory, Category[]>> = {
  theatre:      ["theater"],
  concert_hall: ["theater"],   // most concert halls are amenity=theatre + theatre:type=concert_hall
  arts_centre:  ["gallery"],   // the app's gallery category covers amenity=arts_centre
  garden:       ["park"],      // botanical gardens are often leisure=park + garden:type=botanical
  castle:       [],            // extra OSM query only
}

// Used when /places/nearby gets no `category` parameter: the culture and
// leisure set this API was built for, not all 50+ app categories (an
// all-categories Overpass query over a 5 km radius in a city is truncated).
export const DEFAULT_NEARBY_CATEGORIES: ApiCategory[] = [
  "museum", "theatre", "concert_hall", "cinema", "arts_centre", "gallery",
  "castle", "garden", "park", "zoo", "attraction", "library",
]

// ─── Limits ───────────────────────────────────────────────────────────────
export const LOOKUP_RADIUS_KM        = 0.5   // around each candidate point
export const LOOKUP_WIDE_RADIUS_KM   = 5     // city-only fallback when no venue candidate was found
export const LOOKUP_MAX_ANCHORS      = 3
export const TOILET_SEARCH_RADIUS_M  = 500   // nearest_wheelchair_toilet_m search radius
// nearest_wheelchair_toilet_m on /places/nearby is only computed up to this
// radius: one toilet query must cover radius + 500 m, and in a dense city the
// `out 1000` cap would otherwise truncate it and yield wrong "nearest" values.
export const NEARBY_TOILET_MAX_RADIUS_M = 1_000
export const RATE_LIMIT_PER_MINUTE   = 60
