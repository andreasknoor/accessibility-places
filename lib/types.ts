// ─── Core value type ───────────────────────────────────────────────────────
export type A11yValue = "yes" | "limited" | "no" | "unknown"

export type SourceId =
  | "accessibility_cloud"
  | "osm"
  | "reisen_fuer_alle"
  | "google_places"

export type Category =
  | "cafe" | "restaurant" | "bar" | "fast_food"
  | "hotel"
  | "museum" | "theater" | "library" | "gallery" | "attraction"

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any
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
  acceptUnknown: boolean
}

export interface ActiveSources {
  accessibility_cloud: boolean
  osm: boolean
  reisen_fuer_alle: boolean
  google_places: boolean
}

export interface SearchParams {
  query: string
  location: { lat: number; lon: number }
  radiusKm: number
  categories: Category[]
  filters: SearchFilters
  sources: ActiveSources
}

// ─── LLM query parse result ────────────────────────────────────────────────

export interface ParsedQuery {
  locationQuery: string
  categories: Category[]
  freeTextHint: string
  nameHint: string
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
  summary: string
  durationMs: number
  sourceStats: Record<SourceId, number>
  location: { lat: number; lon: number }
  locationLabel: string
  filterDebug?: FilterDebug
  nameHint?: string
}
