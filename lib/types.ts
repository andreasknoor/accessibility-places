// ─── Core value type ───────────────────────────────────────────────────────
export type A11yValue = "yes" | "limited" | "no" | "unknown"

export type SourceId =
  | "accessibility_cloud"
  | "osm"
  | "reisen_fuer_alle"
  | "google_places"
  | "ginto"

export type Category =
  | "cafe" | "restaurant" | "bar" | "pub" | "biergarten" | "fast_food"
  | "hotel" | "hostel" | "apartment"
  | "museum" | "theater" | "cinema" | "library" | "gallery" | "attraction"
  | "ice_cream"

// ─── Sub-attributes per criterion ──────────────────────────────────────────

export interface EntranceDetails {
  isLevel?: boolean
  hasRamp?: boolean
  rampSlopePercent?: number
  doorWidthCm?: number
  stepCount?: number
  stepHeightCm?: number
  hasAutomaticDoor?: boolean
  hasHoist?: boolean
  description?: string
}

export interface ToiletDetails {
  isDesignated?: boolean
  hasGrabBars?: boolean
  grabBarsOnBothSides?: boolean
  grabBarsFoldable?: boolean
  turningRadiusCm?: number
  doorWidthCm?: number
  hasEmergencyPullstring?: boolean
  isInside?: boolean
}

export interface ParkingDetails {
  hasWheelchairSpaces?: boolean
  spaceCount?: number
  distanceToEntranceM?: number
  // Set when parking.value was upgraded from "unknown" to "yes" because a
  // disabled-parking OSM feature (capacity:disabled>0 or parking_space=disabled)
  // exists within ~150 m of the venue. The venue's own data still says nothing
  // about parking — this only signals that nearby accessible parking exists.
  // The UI renders "Ja, in der Nähe" / "Yes, nearby" when this is true.
  nearbyOnly?: boolean
  // Distance in meters from the venue to the nearest matched parking feature.
  // Only set when nearbyOnly is true.
  nearbyParkingDistanceM?: number
}

export interface SeatingDetails {
  isAccessible?: boolean
}

// ─── Unified accessibility attribute ───────────────────────────────────────

export interface SourceAttribution {
  sourceId: SourceId
  value: A11yValue
  rawValue: string
  reliabilityWeight: number
  details?: EntranceDetails | ToiletDetails | ParkingDetails | SeatingDetails
  // Set when this source was confidence-boosted because the underlying record
  // carries a recent user-verification marker (e.g. OSM `check_date:wheelchair`
  // written by Wheelmap surveys). Drives the verified badge in the UI.
  verifiedRecently?: boolean
  // ISO date string (YYYY-MM-DD) of the verification when known. Surfaced in
  // the verified-badge tooltip ("manuell verifiziert am …").
  verifiedAt?: string
}

export interface AccessibilityAttribute {
  value: A11yValue
  confidence: number
  conflict: boolean
  sources: SourceAttribution[]
  details: EntranceDetails | ToiletDetails | ParkingDetails | SeatingDetails
}

// ─── Normalised address ────────────────────────────────────────────────────

export interface NormalizedAddress {
  street: string
  houseNumber: string
  postalCode: string
  city: string
  country: "DE" | "AT" | "CH" | string
  raw?: string
}

// ─── Source record (raw data from one source) ──────────────────────────────

export interface SourceRecord {
  sourceId: SourceId
  externalId: string
  fetchedAt: string
  // Structured fields that survive stripRaw() in production.
  // Adapters populate this to expose key data in the debug sheet.
  metadata?: Record<string, unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw?: any
}

// ─── Canonical place ───────────────────────────────────────────────────────

export interface Place {
  id: string
  name: string
  category: Category
  address: NormalizedAddress
  coordinates: { lat: number; lon: number }
  website?: string
  phone?: string
  // Authoritative Wheelmap.org page URL when at least one source (typically
  // accessibility.cloud's `infoPageUrl` for Wheelmap-derived places) hands one
  // back. Used in preference to a manually constructed Wheelmap link.
  wheelmapUrl?: string
  gintoUrl?: string

  // Bonus info from supplementary A.Cloud datasets (e.g. Pfotenpiloten):
  // does the place welcome dogs? `undefined` = unknown.
  allowsDogs?: boolean
  // Internal flag — true when this Place was constructed solely from a
  // supplementary dog-policy record (no wheelchair data). The route drops
  // such records unless they merged with a real wheelchair-data source.
  dogPolicyOnly?: boolean

  // Diet flags. Set when a source explicitly signals vegetarian/vegan
  // friendliness — OSM `diet:vegetarian|vegan` (yes / only) or Google Places
  // type `vegetarian_restaurant` / `vegan_restaurant`. `undefined` = unknown.
  // `vegan === true` implies `vegetarian === true` (set automatically).
  isVegetarianFriendly?: boolean
  isVeganFriendly?: boolean

  accessibility: {
    entrance: AccessibilityAttribute
    toilet: AccessibilityAttribute
    parking: AccessibilityAttribute
    seating?: AccessibilityAttribute
  }

  overallConfidence: number
  primarySource: SourceId
  sourceRecords: SourceRecord[]

  // Flag: record from OSM where wheelchair= covers whole place, not just entrance
  osmWheelchairIsOverall?: boolean
}

// ─── Search parameters ─────────────────────────────────────────────────────

export interface SearchFilters {
  entrance: boolean
  toilet: boolean
  parking: boolean
  seating: boolean
  // Restrict results to places where at least one source attribution is
  // marked `verifiedRecently` (= a check_date:wheelchair tag within 2 years).
  onlyVerified: boolean
  acceptUnknown: boolean
  // Display option: show all disabled-parking OSM nodes in the search area on
  // the map, capped at 10 km radius. Does not affect filtering or enrichment.
  alwaysShowParking: boolean
}

export interface ActiveSources {
  accessibility_cloud: boolean
  osm: boolean
  reisen_fuer_alle: boolean
  ginto: boolean
  google_places: boolean
}

export interface SearchParams {
  query: string
  location: { lat: number; lon: number }
  radiusKm: number
  categories: Category[]
  filters: SearchFilters
  sources: ActiveSources
  signal?: AbortSignal
}

// ─── LLM query parse result ────────────────────────────────────────────────

export interface ParsedQuery {
  locationQuery: string
  categories: Category[]
  freeTextHint: string
}

// ─── Per-source live state (emitted incrementally during streaming search) ─

export type SourceStatus = "loading" | "ok" | "error"

export interface SourceState {
  status: SourceStatus
  // Raw places returned by the adapter — before merge, category filter,
  // name filter, and accessibility filters. This is what the streaming
  // `event.type === "source"` event carries (`r.places.length`).
  rawCount?: number
  // Places in the *final* result list whose primarySource is this source.
  // Computed client-side once the `event.type === "result"` event arrives.
  finalCount?: number
  error?: string
  durationMs?: number
}

// ─── API response ──────────────────────────────────────────────────────────

export interface FilterDebug {
  total: number
  passed: number
  failedBy: {
    entrance: number
    toilet:   number
    parking:  number
    seating:  number
  }
  toiletValueCounts: Record<A11yValue, number>
}

export interface SearchResult {
  places: Place[]
  durationMs: number
  sourceStats: Record<SourceId, number>
  location: { lat: number; lon: number }
  locationLabel: string
  filterDebug?: FilterDebug
  nameHint?: string
  parkingSpots?: { lat: number; lon: number; capacity?: number }[]
}
