"use client"

import { AlertTriangle } from "lucide-react"
import { useTranslations } from "@/lib/i18n"
import { SOURCE_LABELS } from "@/lib/config"
import CriterionBox, { CRITERION_STYLES } from "@/components/results/CriterionBox"
import type { AccessibilityAttribute } from "@/lib/types"

interface Props {
  label:       string
  attr:        AccessibilityAttribute
  detailType?: "entrance" | "toilet" | "parking" | "seating"
  showDetails?: boolean
}

export default function A11yAttribute({ label, attr, detailType, showDetails }: Props) {
  const t = useTranslations()

  // Parking that was upgraded from "unknown" → "yes" via a nearby OSM
  // disabled-parking feature is rendered as "Ja, in der Nähe" / "Yes, nearby"
  // so users can tell venue-own-parking apart from nearby-parking.
  const isNearbyOnlyParking =
    detailType === "parking" &&
    attr.value === "yes" &&
    (attr.details as { nearbyOnly?: boolean } | undefined)?.nearbyOnly === true
  const nearbyDistanceM = isNearbyOnlyParking
    ? (attr.details as { nearbyParkingDistanceM?: number } | undefined)?.nearbyParkingDistanceM
    : undefined
  const valueLabel = isNearbyOnlyParking
    ? `${t.a11y.yesNearby}${nearbyDistanceM != null ? ` (${nearbyDistanceM}m)` : ""}`
    : t.a11y[attr.value]

  function detailLabel(key: string): string {
    if (!detailType) return key
    const map = t.details[detailType] as Record<string, string>
    return map[key] ?? key
  }

  // Details (shown in expanded view). `isInside` only carries a positive signal
  // ("toilet on premises"); its absence isn't meaningful (most places just don't
  // tag it), and the info doesn't help the wheelchair-accessibility judgement
  // enough to justify the row — hidden from the detail list (the key stays in
  // attr.details so the toilet-shape detection in merge.ts keeps working).
  // `description` is rendered separately as the italic note.
  const HIDDEN_DETAIL_KEYS = new Set(["isInside", "description"])
  const rows = showDetails
    ? Object.entries(attr.details)
        .filter(([k, v]) => v != null && !HIDDEN_DETAIL_KEYS.has(k))
        .map(([k, v]) => ({
          label: detailLabel(k),
          value: typeof v === "boolean" ? (v ? "✓" : "✗") : String(v),
        }))
    : []
  const description = showDetails && typeof (attr.details as Record<string, unknown>).description === "string"
    ? (attr.details as Record<string, unknown>).description as string
    : undefined

  return (
    <CriterionBox
      tone={attr.value}
      label={label}
      value={valueLabel}
      rows={rows}
      note={description}
      headerExtra={attr.conflict
        ? <AlertTriangle className="w-3 h-3 text-amber-500 ml-1" aria-label={t.results.conflict} />
        : undefined}
    >
      {/* Conflict: show all source values */}
      {attr.conflict && (
        <div className="flex flex-col gap-0.5 pl-5">
          {attr.sources.filter((s) => s.value !== "unknown").map((src) => (
            <span key={src.sourceId} className="text-xs text-muted-foreground">
              {SOURCE_LABELS[src.sourceId]}: <span className={CRITERION_STYLES[src.value].color}>{t.a11y[src.value]}</span>
            </span>
          ))}
        </div>
      )}
    </CriterionBox>
  )
}
