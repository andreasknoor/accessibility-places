import type {
  Place,
  AccessibilityAttribute,
  A11yValue,
  SourceAttribution,
  SourceId,
  EntranceDetails,
  ToiletDetails,
  ParkingDetails,
  SeatingDetails,
} from "../types"
import { RELIABILITY_WEIGHTS, OSM_ENTRANCE_WEIGHT_FACTOR, CONFIDENCE_THRESHOLDS } from "../config"

// ─── Merge two AccessibilityAttribute objects from different sources ────────

function mergeAttribute(
  existing: AccessibilityAttribute,
  incoming: SourceAttribution,
): AccessibilityAttribute {
  // Avoid double-adding same source
  const alreadyPresent = existing.sources.some((s) => s.sourceId === incoming.sourceId)
  const sources: SourceAttribution[] = alreadyPresent
    ? existing.sources.map((s) => (s.sourceId === incoming.sourceId ? incoming : s))
    : [...existing.sources, incoming]

  return computeAttribute(sources, existing.details, incoming.details)
}

// ─── Weighted vote over all source attributions ────────────────────────────

function computeAttribute(
  sources: SourceAttribution[],
  existingDetails: AccessibilityAttribute["details"],
  incomingDetails?: SourceAttribution["details"],
): AccessibilityAttribute {
  const details = mergeDetails(existingDetails, incomingDetails)
  const known   = sources.filter((s) => s.value !== "unknown")

  if (known.length === 0) {
    return { value: "unknown", confidence: 0, conflict: false, sources, details }
  }

  const scores: Record<A11yValue, number> = { yes: 0, limited: 0, no: 0, unknown: 0 }
  for (const s of known) {
    scores[s.value] += s.reliabilityWeight
  }

  const total   = scores.yes + scores.limited + scores.no
  const winner  = (["yes", "limited", "no"] as const).reduce((a, b) =>
    scores[a] >= scores[b] ? a : b,
  )
  const baseConf   = Math.min(scores[winner], 1.0)
  const confidence = winner === "yes" || winner === "limited"
    ? toiletConfidence(details, baseConf, sources)
    : baseConf

  // Conflict: runner-up has more than half the winner's weight
  const runnerUp = (["yes", "limited", "no"] as const)
    .filter((v) => v !== winner)
    .reduce((a, b) => (scores[a] >= scores[b] ? a : b))
  const conflict = scores[runnerUp] / (scores[winner] || 1) > 0.5

  return { value: winner, confidence, conflict, sources, details }
}

// ─── Merge detail objects (keep all defined sub-attributes) ────────────────

function mergeDetails(
  a: AccessibilityAttribute["details"],
  b?: SourceAttribution["details"],
): AccessibilityAttribute["details"] {
  if (!b) return a
  // Shallow merge: b only overwrites if a's field is undefined
  return { ...b, ...Object.fromEntries(
    Object.entries(a as object).filter(([, v]) => v !== undefined),
  ) } as AccessibilityAttribute["details"]
}

// ─── Build empty attribute ─────────────────────────────────────────────────

export function emptyAttribute(details: AccessibilityAttribute["details"] = {}): AccessibilityAttribute {
  return { value: "unknown", confidence: 0, conflict: false, sources: [], details }
}

// ─── Merge a new place into an existing canonical place ────────────────────

export function mergePlaces(existing: Place, incoming: Place): Place {
  const merged: Place = { ...existing }

  // Merge source records
  const existingSourceIds = new Set(existing.sourceRecords.map((r) => r.sourceId))
  merged.sourceRecords = [
    ...existing.sourceRecords,
    ...incoming.sourceRecords.filter((r) => !existingSourceIds.has(r.sourceId)),
  ]

  // Merge each accessibility attribute
  for (const criterion of ["entrance", "toilet", "parking"] as const) {
    for (const src of incoming.accessibility[criterion].sources) {
      merged.accessibility[criterion] = mergeAttribute(
        merged.accessibility[criterion],
        src,
      )
    }
  }

  // Merge seating (optional)
  if (incoming.accessibility.seating) {
    if (!merged.accessibility.seating) {
      merged.accessibility.seating = incoming.accessibility.seating
    } else {
      for (const src of incoming.accessibility.seating.sources) {
        merged.accessibility.seating = mergeAttribute(
          merged.accessibility.seating,
          src,
        )
      }
    }
  }

  // Fill in missing metadata from incoming if existing lacks it
  if (!merged.website     && incoming.website)     merged.website     = incoming.website
  if (!merged.phone       && incoming.phone)       merged.phone       = incoming.phone
  if (!merged.wheelmapUrl && incoming.wheelmapUrl) merged.wheelmapUrl = incoming.wheelmapUrl
  if (merged.allowsDogs === undefined && incoming.allowsDogs !== undefined) {
    merged.allowsDogs = incoming.allowsDogs
  }
  // dogPolicyOnly is sticky-FALSE: once a real wheelchair-data source merges
  // in, the place is no longer "supplementary only" and survives the route
  // post-filter.
  if (merged.dogPolicyOnly && !incoming.dogPolicyOnly) merged.dogPolicyOnly = undefined

  // Diet flags — first non-undefined value wins, with vegan implying vegetarian
  if (merged.isVegetarianFriendly === undefined && incoming.isVegetarianFriendly !== undefined) {
    merged.isVegetarianFriendly = incoming.isVegetarianFriendly
  }
  if (merged.isVeganFriendly === undefined && incoming.isVeganFriendly !== undefined) {
    merged.isVeganFriendly = incoming.isVeganFriendly
  }
  // After both flags settle, ensure vegan implies vegetarian
  if (merged.isVeganFriendly === true) merged.isVegetarianFriendly = true

  // Recompute overall confidence and primary source
  merged.overallConfidence = computeOverallConfidence(merged)
  merged.primarySource     = findPrimarySource(merged)

  return merged
}

// ─── Finalise a newly-added place (computes confidence + primarySource) ───────
// Called when a place enters canonical for the first time (no merge partner).
// mergePlaces calls the same internals for subsequent merges.

export function finalisePlaceConfidence(place: Place): Place {
  return {
    ...place,
    overallConfidence: computeOverallConfidence(place),
    primarySource:     findPrimarySource(place),
  }
}

// ─── Overall confidence (average of known criteria) ───────────────────────

function computeOverallConfidence(place: Place): number {
  const attrs = [
    place.accessibility.entrance,
    place.accessibility.toilet,
    place.accessibility.parking,
    ...(place.accessibility.seating ? [place.accessibility.seating] : []),
  ].filter((a) => a.value !== "unknown")

  if (attrs.length === 0) return 0
  return attrs.reduce((sum, a) => sum + a.confidence, 0) / attrs.length
}

// ─── Filtered confidence (only active filter criteria count) ──────────────
// Inactive criteria (e.g. parking when parking filter is off) are excluded
// so they neither inflate nor deflate the score.
// Falls back to all known criteria when no filter is active.

export function computeFilteredConfidence(
  place: Place,
  filters: { entrance: boolean; toilet: boolean; parking: boolean; seating: boolean },
): number {
  const active: AccessibilityAttribute[] = []
  if (filters.entrance) active.push(place.accessibility.entrance)
  if (filters.toilet)   active.push(place.accessibility.toilet)
  if (filters.parking)  active.push(place.accessibility.parking)
  if (filters.seating && place.accessibility.seating) active.push(place.accessibility.seating)

  const pool = active.length > 0 ? active : [
    place.accessibility.entrance,
    place.accessibility.toilet,
    place.accessibility.parking,
    ...(place.accessibility.seating ? [place.accessibility.seating] : []),
  ]

  const known = pool.filter((a) => a.value !== "unknown")
  if (known.length === 0) return 0
  return known.reduce((sum, a) => sum + a.confidence, 0) / known.length
}

// ─── Primary source = highest reliability weight that contributed ──────────

function findPrimarySource(place: Place): SourceId {
  const sourceIds = new Set<SourceId>(
    place.sourceRecords.map((r) => r.sourceId),
  )
  const order: SourceId[] = [
    "reisen_fuer_alle",
    "accessibility_cloud",
    "osm",
    "google_places",
  ]
  return order.find((id) => sourceIds.has(id)) ?? place.sourceRecords[0]?.sourceId ?? "osm"
}

// ─── Detect toilet details by presence of toilet-specific keys ────────────
// Used to apply toilet-specific confidence rules without passing an explicit type.

const TOILET_KEYS = [
  "isDesignated","hasGrabBars","grabBarsOnBothSides","grabBarsFoldable",
  "turningRadiusCm","hasEmergencyPullstring","isInside",
] as const

function hasToiletShape(d: AccessibilityAttribute["details"] | undefined): boolean {
  if (!d) return false
  return Object.keys(d).some((k) => TOILET_KEYS.includes(k as typeof TOILET_KEYS[number]))
}

// Cap toilet confidence at 0.9 when only weak signals are present so that
// merging several modest sources (e.g. OSM toilet=yes + Google's bare
// wheelchairAccessibleRestroom flag) cannot accidentally claim 100 %. Only
// `isDesignated` or `hasGrabBars` evidence promotes the score to 1.0.
//
// We also inspect each source's own details — `mergeDetails` drops keys whose
// values are all `undefined`, so a sibling source with empty `{}` (Google
// Places) can otherwise wipe out the toilet shape from the merged object.
function toiletConfidence(
  details: AccessibilityAttribute["details"],
  base: number,
  sources?: SourceAttribution[],
): number {
  const d = details as ToiletDetails
  if (d.isDesignated === true || d.hasGrabBars === true) return 1.0

  const isToilet = hasToiletShape(details) || (sources?.some((s) => hasToiletShape(s.details)) ?? false)
  if (isToilet) return Math.min(base, 0.9)
  return base
}

// ─── Build an AccessibilityAttribute from a single source ─────────────────

export function buildAttribute(
  sourceId: SourceId,
  value: A11yValue,
  rawValue: string,
  details: AccessibilityAttribute["details"],
  isOsmOverall = false,
  weightMultiplier = 1.0,
  verifiedAt?: string,
): AccessibilityAttribute {
  const baseWeight = RELIABILITY_WEIGHTS[sourceId]
  const overallAdj = isOsmOverall ? OSM_ENTRANCE_WEIGHT_FACTOR : 1.0
  const weight     = Math.min(baseWeight * overallAdj * weightMultiplier, 1.0)

  const src: SourceAttribution = {
    sourceId,
    value,
    rawValue,
    reliabilityWeight: weight,
    details,
    ...(weightMultiplier > 1.0 ? { verifiedRecently: true } : {}),
    ...(verifiedAt ? { verifiedAt } : {}),
  }

  const confidence = value === "unknown" ? 0 : toiletConfidence(details, weight, [src])
  return {
    value,
    confidence,
    conflict: false,
    sources: [src],
    details,
  }
}

export function confidenceLabel(c: number): "high" | "medium" | "low" {
  if (c >= CONFIDENCE_THRESHOLDS.high)   return "high"
  if (c >= CONFIDENCE_THRESHOLDS.medium) return "medium"
  return "low"
}

// ─── Filter places by active criteria ─────────────────────────────────────

// Like passesFilters but only considers a single source's contribution to each
// attribute — answers "if this were the only active source, would the place
// still pass the filter?". Used to display a predictive per-source count in
// the FilterPanel: the number predicts how many results would survive if the
// user disabled all other sources.
export function passesFiltersForSource(
  place: Place,
  sourceId: SourceId,
  filters: {
    entrance: boolean
    toilet: boolean
    parking: boolean
    seating: boolean
    onlyVerified?: boolean
    acceptUnknown: boolean
  },
): boolean {
  const valueFromSource = (attr: AccessibilityAttribute): A11yValue => {
    return attr.sources.find((s) => s.sourceId === sourceId)?.value ?? "unknown"
  }
  const check = (attr: AccessibilityAttribute): boolean => {
    const v = valueFromSource(attr)
    if (v === "yes" || v === "limited") return true
    if (v === "unknown") return filters.acceptUnknown
    return false
  }
  if (filters.entrance && !check(place.accessibility.entrance)) return false
  if (filters.toilet   && !check(place.accessibility.toilet))   return false
  if (filters.parking  && !check(place.accessibility.parking))  return false
  if (filters.seating  && place.accessibility.seating && !check(place.accessibility.seating)) return false
  if (filters.onlyVerified) {
    const attrs = [
      place.accessibility.entrance,
      place.accessibility.toilet,
      place.accessibility.parking,
      ...(place.accessibility.seating ? [place.accessibility.seating] : []),
    ]
    if (!attrs.some((a) => a.sources.some((s) => s.sourceId === sourceId && s.verifiedRecently))) return false
  }
  return true
}

export function passesFilters(
  place: Place,
  filters: {
    entrance: boolean
    toilet: boolean
    parking: boolean
    seating: boolean
    onlyVerified?: boolean
    acceptUnknown: boolean
  },
): boolean {
  const check = (attr: AccessibilityAttribute): boolean => {
    if (attr.value === "yes" || attr.value === "limited") return true
    if (attr.value === "unknown") return filters.acceptUnknown
    return false // "no"
  }

  if (filters.entrance && !check(place.accessibility.entrance)) return false
  if (filters.toilet   && !check(place.accessibility.toilet))   return false
  if (filters.parking  && !check(place.accessibility.parking))  return false
  if (filters.seating  && place.accessibility.seating && !check(place.accessibility.seating)) return false

  // "Only manually verified" — require at least one source attribution that
  // carries the recently-verified flag (today: OSM `check_date:wheelchair`
  // ≤ 2 years old).
  if (filters.onlyVerified) {
    const attrs = [
      place.accessibility.entrance,
      place.accessibility.toilet,
      place.accessibility.parking,
      ...(place.accessibility.seating ? [place.accessibility.seating] : []),
    ]
    if (!attrs.some((a) => a.sources.some((s) => s.verifiedRecently))) return false
  }

  return true
}
