import type {
  Place,
  AccessibilityAttribute,
  A11yValue,
  SourceAttribution,
  SourceId,
} from "../types"
import { RELIABILITY_WEIGHTS, CONFIDENCE_THRESHOLDS, SOURCE_FAMILY, type ConfidenceTier } from "../config"

// ─── Merge two AccessibilityAttribute objects from different sources ────────

function mergeAttribute(
  existing: AccessibilityAttribute,
  incoming: SourceAttribution,
): AccessibilityAttribute {
  // Avoid double-adding same source. When the same source appears twice (a
  // source can carry duplicate entries of one venue — Google notably does),
  // the incoming attribution replaces the existing one — EXCEPT when that
  // would overwrite a known value with "unknown": the sparser duplicate must
  // never erase what the richer duplicate already contributed.
  const alreadyPresent = existing.sources.some((s) => s.sourceId === incoming.sourceId)
  const sources: SourceAttribution[] = alreadyPresent
    ? existing.sources.map((s) =>
        s.sourceId === incoming.sourceId && (incoming.value !== "unknown" || s.value === "unknown")
          ? incoming
          : s)
    : [...existing.sources, incoming]

  return computeAttribute(sources, existing.details, incoming.details)
}

// ─── Family-aware evidence sum ─────────────────────────────────────────────
// A "family" (SOURCE_FAMILY in lib/config.ts) is one underlying observation —
// distinct API keys/approval-levels of the same dataset don't count twice.
// Within a family, only the strongest agreeing source counts; across
// families, evidence ADDS, uncapped (docs/plans/reliability-tiers.md).

function evidenceSum(known: SourceAttribution[], value: A11yValue): number {
  const byFamily = new Map<string, number>()
  for (const s of known) {
    if (s.value !== value) continue
    const fam = SOURCE_FAMILY[s.sourceId] ?? s.sourceId
    byFamily.set(fam, Math.max(byFamily.get(fam) ?? 0, s.reliabilityWeight))
  }
  let sum = 0
  for (const w of byFamily.values()) sum += w
  return sum
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

  const scores: Record<"yes" | "limited" | "no", number> = {
    yes:     evidenceSum(known, "yes"),
    limited: evidenceSum(known, "limited"),
    no:      evidenceSum(known, "no"),
  }
  const winner = (["yes", "limited", "no"] as const).reduce((a, b) =>
    scores[a] >= scores[b] ? a : b,
  )
  const confidence = scores[winner]

  // Conflict: runner-up has more than half the winner's (family-deduped) evidence.
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

  // Fill in missing address fields from incoming
  if (!merged.address.street     && incoming.address.street)     merged.address = { ...merged.address, street:      incoming.address.street }
  if (!merged.address.houseNumber && incoming.address.houseNumber) merged.address = { ...merged.address, houseNumber: incoming.address.houseNumber }
  if (!merged.address.postalCode  && incoming.address.postalCode)  merged.address = { ...merged.address, postalCode:  incoming.address.postalCode }
  if (!merged.address.city        && incoming.address.city)        merged.address = { ...merged.address, city:        incoming.address.city }

  // Fill in missing metadata from incoming if existing lacks it
  if (!merged.website     && incoming.website)     merged.website     = incoming.website
  if (!merged.phone       && incoming.phone)       merged.phone       = incoming.phone
  if (!merged.wheelmapUrl && incoming.wheelmapUrl) merged.wheelmapUrl = incoming.wheelmapUrl
  if (!merged.gintoUrl    && incoming.gintoUrl)    merged.gintoUrl    = incoming.gintoUrl
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
// Internal-only baseline for `Place.overallConfidence`, set once at merge
// time. `/api/search` and `lib/seo-search.ts` both overwrite this with
// `computeFilteredConfidence` (below) before a place is ever returned — this
// function's output is never shown to a user, only briefly held as a
// placeholder. Kept as-is (v13): purely a sort-key input now, never a
// displayed percentage.

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

// ─── Overall data-quality confidence (internal sort key only, v13) ────────
// No longer displayed anywhere (docs/plans/reliability-tiers.md) — used
// exclusively as the search-result and SEO sort key. Active filter criteria
// always participate in the average — unknown values contribute 0. This
// prevents a single high-confidence criterion from inflating the score when
// other active criteria are unknown (which happens when acceptUnknown lets
// through places with incomplete data). Inactive criteria are included only
// when they have a known value. Since v13 the underlying attr.confidence
// values are uncapped family-evidence sums (can exceed 1.0 for multi-family
// agreement), so this average can too — harmless for a pure sort key.

export function computeFilteredConfidence(
  place: Place,
  filters: { entrance: boolean; toilet: boolean; parking: boolean; seating: boolean },
): number {
  const candidates = [
    { attr: place.accessibility.entrance,  active: filters.entrance },
    { attr: place.accessibility.toilet,    active: filters.toilet   },
    { attr: place.accessibility.parking,   active: filters.parking  },
    ...(place.accessibility.seating
      ? [{ attr: place.accessibility.seating, active: filters.seating }]
      : []),
  ]
  // Active criteria: always in pool (unknown → confidence 0)
  // Inactive criteria: only if they have a known value
  const pool = candidates.filter(({ attr, active }) => active || attr.value !== "unknown")
  if (pool.length === 0) return 0
  return pool.reduce((sum, { attr }) => sum + attr.confidence, 0) / pool.length
}

// ─── Count "limited" values among active filter criteria ──────────────────
// Used as a tiebreaker in sort: places with zero "limited" values rank above
// places with one or more, when overallConfidence is within floating-point
// epsilon. Lower count = better.

export function countLimited(
  place: Place,
  filters: { entrance: boolean; toilet: boolean; parking: boolean; seating: boolean },
): number {
  let n = 0
  if (filters.entrance && place.accessibility.entrance.value === "limited") n++
  if (filters.toilet   && place.accessibility.toilet.value   === "limited") n++
  if (filters.parking  && place.accessibility.parking.value  === "limited") n++
  if (filters.seating  && place.accessibility.seating?.value === "limited") n++
  return n
}

// ─── Primary source = highest reliability weight that contributed ──────────

function findPrimarySource(place: Place): SourceId {
  const sourceIds = new Set<SourceId>(
    place.sourceRecords.map((r) => r.sourceId),
  )
  const order: SourceId[] = [
    "reisen_fuer_alle",
    "ginto",
    "accessibility_cloud",
    "osm",
    "google_places",
  ]
  return order.find((id) => sourceIds.has(id)) ?? place.sourceRecords[0]?.sourceId ?? "osm"
}

// ─── Build an AccessibilityAttribute from a single source ─────────────────
//
// (The old toilet-specific 0.9 confidence cap — `toiletConfidence` — was
// removed in v13/reliability-tiers: it existed to stop a PERCENTAGE display
// from claiming "100%" on thin toilet detail. That concern doesn't map onto
// a tier system built around source CORROBORATION rather than data
// completeness — a toilet can now reach "sehr_hoch" like any other
// criterion. See docs/plans/reliability-tiers.md, decision 4.)

export function buildAttribute(
  sourceId: SourceId,
  value: A11yValue,
  rawValue: string,
  details: AccessibilityAttribute["details"],
  weightMultiplier = 1.0,
  verifiedAt?: string,
  verifiedRecently?: boolean,
): AccessibilityAttribute {
  const baseWeight = RELIABILITY_WEIGHTS[sourceId]
  const weight     = Math.min(baseWeight * weightMultiplier, 1.0)

  // verifiedRecently can be passed explicitly (e.g. Ginto: weight boost from
  // LEVEL_2 should not show the badge; only updatedAt-based verification should).
  // Falls back to weightMultiplier > 1.0 for callers that don't pass it (OSM).
  const isVerified = verifiedRecently ?? weightMultiplier > 1.0

  const src: SourceAttribution = {
    sourceId,
    value,
    rawValue,
    reliabilityWeight: weight,
    details,
    ...(isVerified ? { verifiedRecently: true } : {}),
    ...(verifiedAt ? { verifiedAt } : {}),
  }

  const confidence = value === "unknown" ? 0 : weight
  return {
    value,
    confidence,
    conflict: false,
    sources: [src],
    details,
  }
}

// ─── Reliability tier (v13, docs/plans/reliability-tiers.md) ──────────────
// Replaces the old 3-tier confidenceLabel (a 0-1 percentage read as a single
// traffic light for the whole place). A tier is now PER CRITERION, derived
// from the additive family-evidence sum, and rendered as plain-language
// Nachsatz text under that criterion's own row — never as a colour and
// never as a place-level score. A conflicting runner-up caps the tier at
// "gut" (passed via the attribute's own `conflict` flag) — it can still read
// "gering" if the evidence itself is thin, just never "sehr_hoch".
export function confidenceTier(confidence: number, conflict = false): ConfidenceTier {
  if (confidence <= 0) return "keine"
  if (confidence >= CONFIDENCE_THRESHOLDS.sehrHoch) return conflict ? "gut" : "sehr_hoch"
  if (confidence >= CONFIDENCE_THRESHOLDS.gut) return "gut"
  return "gering"
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
    parkingNearby?: boolean
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

  // A place is only attributable to a source if that source contributed at
  // least one accessibility attribute. Without this guard every source would
  // claim every merged place when no attribute filters are active.
  const allAttrs = [
    place.accessibility.entrance,
    place.accessibility.toilet,
    place.accessibility.parking,
    ...(place.accessibility.seating ? [place.accessibility.seating] : []),
  ]
  if (!allAttrs.some((a) => a.sources.some((s) => s.sourceId === sourceId))) return false

  if (filters.entrance && !check(place.accessibility.entrance)) return false
  if (filters.toilet   && !check(place.accessibility.toilet))   return false
  if (filters.parking) {
    // When parkingNearby is explicitly false, reject places whose parking value
    // exists only because of nearby-parking enrichment (no real on-site source).
    // The enrichment never adds a SourceAttribution, so per-source check is
    // already strict — but the place-level details.nearbyOnly flag is the
    // ground truth for whether this attribute was derived from an off-site
    // parking node.
    const nearbyOnly = (place.accessibility.parking.details as { nearbyOnly?: boolean } | undefined)?.nearbyOnly === true
    if (filters.parkingNearby === false && nearbyOnly) return false
    if (!check(place.accessibility.parking)) return false
  }
  if (filters.seating) {
    if (!place.accessibility.seating) {
      if (!filters.acceptUnknown) return false
    } else if (!check(place.accessibility.seating)) {
      return false
    }
  }
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
    parkingNearby?: boolean
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
  if (filters.parking) {
    // When parkingNearby is explicitly false, exclude places whose parking
    // value was derived only from nearby-parking enrichment (no real on-site
    // attribution). details.nearbyOnly is set by enrichWithNearbyParking and
    // is the authoritative signal.
    const nearbyOnly = (place.accessibility.parking.details as { nearbyOnly?: boolean } | undefined)?.nearbyOnly === true
    if (filters.parkingNearby === false && nearbyOnly) return false
    if (!check(place.accessibility.parking)) return false
  }
  if (filters.seating) {
    if (!place.accessibility.seating) {
      if (!filters.acceptUnknown) return false
    } else if (!check(place.accessibility.seating)) {
      return false
    }
  }

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
