import type { A11yValue, AccessibilityAttribute, SourceId } from "../types"
import { criterionTier } from "../reliability"

// The public API deliberately resolves disagreement differently from the app:
// the app picks the value with the highest summed source weight; the API
// returns the MOST CONSERVATIVE value any source reported (no < limited < yes)
// and lists the disagreement in `conflicts`. Rationale: an automated consumer
// planning a real visit is better served by a false "no" than a false "yes".

export type ApiSourceId = "osm" | "ginto"
export type ApiConfidence = "high" | "medium" | "low"

export interface SourceValue { source: ApiSourceId; value: Exclude<A11yValue, "unknown"> }

export interface ApiConflict {
  field:      string
  values:     SourceValue[]
  resolution: "most_conservative"
  resolved:   Exclude<A11yValue, "unknown">
}

const RANK: Record<Exclude<A11yValue, "unknown">, number> = { no: 0, limited: 1, yes: 2 }

export function toApiSource(id: SourceId): ApiSourceId | null {
  if (id === "osm") return "osm"
  if (id === "ginto") return "ginto"
  return null
}

/** Known (non-unknown) per-source values of one attribute, deduplicated. */
export function sourceValues(attr: AccessibilityAttribute | undefined): SourceValue[] {
  const out: SourceValue[] = []
  for (const s of attr?.sources ?? []) {
    const source = toApiSource(s.sourceId)
    if (!source || s.value === "unknown") continue
    if (out.some((o) => o.source === source && o.value === s.value)) continue
    out.push({ source, value: s.value })
  }
  return out
}

export function resolveConservative(
  field: string,
  values: SourceValue[],
): { value: A11yValue; conflict?: ApiConflict } {
  if (values.length === 0) return { value: "unknown" }
  const resolved = values.reduce((min, v) => (RANK[v.value] < RANK[min] ? v.value : min), values[0].value)
  const distinct = new Set(values.map((v) => v.value))
  if (distinct.size <= 1) return { value: resolved }
  return { value: resolved, conflict: { field, values, resolution: "most_conservative", resolved } }
}

/**
 * Confidence of one field, built on the app's own reliability tiers so API
 * and UI never disagree about how trustworthy a value is:
 *   high   = app tier "bestätigt" — summed independent-source evidence ≥ 1.0:
 *            an audited/official entry (Ginto AUDITED = 1.0) or 2+ agreeing
 *            sources (e.g. OSM 0.75 + Ginto 0.90)
 *   medium = app tier "wahrscheinlich" — one solid source (e.g. OSM alone, 0.75)
 *   low    = app tier "unsicher", no data, or any conflict between sources
 */
export function fieldConfidence(attr: AccessibilityAttribute | undefined, conflict: boolean): ApiConfidence {
  if (conflict) return "low"
  const tier = criterionTier(attr)
  if (tier === "sehr_hoch") return "high"
  if (tier === "gut") return "medium"
  return "low"
}
