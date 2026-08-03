// ─── Reliability tiers: shared UI helper (v13, docs/plans/reliability-tiers.md) ───
//
// Two orthogonal questions, deliberately never merged into one colour or one
// number:
//   1. Judgement — does this place satisfy the ACTIVE filter criteria?
//      → evaluatePlaceJudgment() below.
//   2. Reliability — how well-corroborated is a KNOWN value?
//      → confidenceTier() in lib/matching/merge.ts, rendered per criterion.

import type { Place, AccessibilityAttribute, SourceId } from "./types"
import { confidenceTier } from "./matching/merge"
import { SOURCE_LABELS, type ConfidenceTier } from "./config"

export type { ConfidenceTier }

export type CriterionKey = "entrance" | "toilet" | "parking" | "seating"

export const CRITERION_KEYS: readonly CriterionKey[] = ["entrance", "toilet", "parking", "seating"]

// The minimal filter shape evaluatePlaceJudgment needs — a subset of
// SearchFilters (lib/types.ts) so callers with the Quickstart fixed preset
// (which isn't a real SearchFilters object) can build a matching literal.
export interface JudgmentFilters {
  entrance:      boolean
  toilet:        boolean
  parking:       boolean
  // Mirrors SearchFilters.parkingNearby (lib/types.ts): when explicitly
  // `false`, a place whose parking value exists only via nearby-parking
  // enrichment (details.nearbyOnly) must be treated as failing — same rule
  // passesFilters applies. Optional/defaults to accepting nearby-only
  // parking (`true`, the SearchFilters default) so callers that don't
  // sub-filter on this (Quickstart, SEO) don't need to think about it.
  parkingNearby?: boolean
  seating:       boolean
  acceptUnknown: boolean
}

export type JudgmentStatus = "pass" | "pass_limited" | "unverified" | "fail" | "none"

export interface PlaceJudgment {
  status:  JudgmentStatus
  limited: CriterionKey[] // active criteria whose value is "limited"
  unknown: CriterionKey[] // active criteria with no known value that still passed (acceptUnknown)
  failed:  CriterionKey[] // active criteria that block the place outright
}

function attrFor(place: Place, key: CriterionKey): AccessibilityAttribute | undefined {
  if (key === "seating") return place.accessibility.seating
  return place.accessibility[key]
}

// Mirrors passesFilters' per-criterion `check()` (lib/matching/merge.ts)
// exactly, so a judgement can never disagree with whether the place is
// actually in the list — but keeps the *reason* (limited vs. unknown vs. no)
// instead of collapsing straight to a boolean.
export function evaluatePlaceJudgment(place: Place, filters: JudgmentFilters): PlaceJudgment {
  const limited: CriterionKey[] = []
  const unknown: CriterionKey[] = []
  const failed:  CriterionKey[] = []

  const activeKeys = CRITERION_KEYS.filter((k) => filters[k])

  for (const key of activeKeys) {
    const attr = attrFor(place, key)

    // Same nearby-parking sub-filter passesFilters applies: when the
    // caller's parking value exists only via off-site enrichment and
    // parkingNearby is explicitly false, this criterion fails outright,
    // regardless of its actual yes/limited/unknown value.
    if (key === "parking" && filters.parkingNearby === false) {
      const nearbyOnly = (attr?.details as { nearbyOnly?: boolean } | undefined)?.nearbyOnly === true
      if (nearbyOnly) { failed.push(key); continue }
    }

    const value = attr?.value ?? "unknown"
    if (value === "yes") continue
    if (value === "limited") { limited.push(key); continue }
    if (value === "unknown") {
      if (filters.acceptUnknown) unknown.push(key)
      else failed.push(key)
      continue
    }
    // "no"
    failed.push(key)
  }

  let status: JudgmentStatus
  if (activeKeys.length === 0)   status = "none"
  else if (failed.length > 0)   status = "fail"
  else if (unknown.length > 0)  status = "unverified"
  else if (limited.length > 0)  status = "pass_limited"
  else                           status = "pass"

  return { status, limited, unknown, failed }
}

// ─── Per-criterion reliability tier + Nachsatz ─────────────────────────────
// The verified-on-site date (decision 8) folds directly into the same
// Nachsatz rather than a separate badge — callers pass the attribute's own
// latest verifiedAt (if any) alongside its tier.

export function criterionTier(attr: AccessibilityAttribute | undefined): ConfidenceTier {
  if (!attr || attr.value === "unknown") return "keine"
  return confidenceTier(attr.confidence, attr.conflict)
}

// Latest verifiedAt among the sources that contributed to one attribute
// (distinct from ConfidenceBadge's old place-wide collectVerifiedSources —
// this is scoped to a single criterion, since the Nachsatz is per-criterion).
export function attrVerifiedAt(attr: AccessibilityAttribute | undefined): string | undefined {
  const dates = (attr?.sources ?? [])
    .filter((s) => s.verifiedRecently)
    .map((s) => s.verifiedAt)
    .filter((d): d is string => Boolean(d))
  if (dates.length === 0) return undefined
  return dates.slice().sort().pop()
}

export function sourceLabelsFor(attr: AccessibilityAttribute | undefined): string[] {
  const seen = new Set<string>()
  const labels: string[] = []
  for (const s of attr?.sources ?? []) {
    const label = SOURCE_LABELS[s.sourceId as SourceId] ?? s.sourceId
    if (seen.has(label)) continue
    seen.add(label)
    labels.push(label)
  }
  return labels
}
