"use client"

import { Fragment } from "react"
import { AlertTriangle, CheckCircle2, XCircle, HelpCircle } from "lucide-react"
import { useTranslations } from "@/lib/i18n"
import { SOURCE_LABELS } from "@/lib/config"
import { cn } from "@/lib/utils"
import type { AccessibilityAttribute } from "@/lib/types"

interface Props {
  label:       string
  attr:        AccessibilityAttribute
  detailType?: "entrance" | "toilet" | "parking" | "seating"
  showDetails?: boolean
}

const VALUE_STYLES = {
  yes:     { icon: CheckCircle2, color: "text-green-600",  bg: "bg-green-50"  },
  limited: { icon: CheckCircle2, color: "text-yellow-600", bg: "bg-yellow-50" },
  no:      { icon: XCircle,      color: "text-red-600",    bg: "bg-red-50"    },
  unknown: { icon: HelpCircle,   color: "text-slate-400",  bg: "bg-slate-50"  },
}

export default function A11yAttribute({ label, attr, detailType, showDetails }: Props) {
  const t = useTranslations()
  const style = VALUE_STYLES[attr.value]
  const Icon  = style.icon

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

  return (
    <div className={cn("rounded-md px-2.5 py-1.5 flex flex-col gap-1", style.bg)}>
      {/* Header row */}
      <div className="flex items-center gap-1.5">
        <Icon className={cn("w-3.5 h-3.5 shrink-0", style.color)} />
        <span className="text-xs font-medium text-foreground min-w-0 flex-1 truncate">{label}</span>
        <span className={cn("text-xs shrink-0", style.color)}>
          {valueLabel}
        </span>
        {attr.conflict && (
          <AlertTriangle className="w-3 h-3 text-amber-500 ml-1" aria-label={t.results.conflict} />
        )}
      </div>

      {/* Conflict: show all source values */}
      {attr.conflict && (
        <div className="flex flex-col gap-0.5 pl-5">
          {attr.sources.filter((s) => s.value !== "unknown").map((src) => (
            <span key={src.sourceId} className="text-xs text-muted-foreground">
              {SOURCE_LABELS[src.sourceId]}: <span className={VALUE_STYLES[src.value].color}>{t.a11y[src.value]}</span>
            </span>
          ))}
        </div>
      )}

      {/* Details (shown in expanded view) */}
      {showDetails && (() => {
        // `isInside` only carries a positive signal ("toilet on premises"); its
        // absence isn't meaningful (most places just don't tag it), and the
        // info doesn't help the wheelchair-accessibility judgement enough to
        // justify the row. Hidden from the detail list. The key is still in
        // attr.details so the toilet-shape detection in merge.ts keeps working.
        // `description` is handled separately below as italic free text.
        const HIDDEN_DETAIL_KEYS = new Set(["isInside", "description"])
        const entries = Object.entries(attr.details).filter(
          ([k, v]) => v != null && !HIDDEN_DETAIL_KEYS.has(k),
        )
        const description = typeof (attr.details as Record<string, unknown>).description === "string"
          ? (attr.details as Record<string, unknown>).description as string
          : undefined
        if (entries.length === 0 && !description) return null
        return (
          <>
            {entries.length > 0 && (
              <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-2 gap-y-0.5 pl-5 mt-0.5">
                {entries.map(([k, v]) => {
                  const val = typeof v === "boolean" ? (v ? "✓" : "✗") : String(v)
                  return (
                    <Fragment key={k}>
                      <dt className="text-xs text-muted-foreground break-words">{detailLabel(k)}</dt>
                      <dd className="text-xs text-foreground break-words">{val}</dd>
                    </Fragment>
                  )
                })}
              </dl>
            )}
            {description && (
              <p className="pl-5 text-xs italic text-muted-foreground mt-0.5">{description}</p>
            )}
          </>
        )
      })()}
    </div>
  )
}
