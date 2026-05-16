"use client"

import { useState } from "react"
import { Accessibility, Check } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { BottomSheet } from "@/components/ui/bottom-sheet"
import { useTranslations } from "@/lib/i18n"
import { useIsMobile } from "@/hooks/useIsMobile"
import { confidenceLabel } from "@/lib/matching/merge"
import { cn } from "@/lib/utils"
import type { Place } from "@/lib/types"

interface Props {
  confidence: number
  place?:     Place
  className?: string
}

const COLORS = {
  high:   "bg-green-100 text-green-800 border-green-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low:    "bg-red-100 text-red-800 border-red-200",
}

function ScoreContent({ place }: { place: Place }) {
  const t = useTranslations()
  const valueLabel = (key: "entrance" | "toilet" | "parking" | "seating", v: string): string => {
    if (
      key === "parking" && v === "yes" &&
      (place.accessibility.parking.details as { nearbyOnly?: boolean } | undefined)?.nearbyOnly
    ) {
      const d = (place.accessibility.parking.details as { nearbyParkingDistanceM?: number } | undefined)?.nearbyParkingDistanceM
      return `${t.a11y.yesNearby}${d != null ? ` (${d}m)` : ""}`
    }
    if (v === "yes" || v === "limited" || v === "no") return t.a11y[v]
    return "—"
  }
  const criteria: { key: "entrance" | "toilet" | "parking" | "seating"; label: string; attr: Place["accessibility"]["entrance"] }[] = [
    { key: "entrance", label: t.criteria.entrance, attr: place.accessibility.entrance },
    { key: "toilet",   label: t.criteria.toilet,   attr: place.accessibility.toilet   },
    { key: "parking",  label: t.criteria.parking,  attr: place.accessibility.parking  },
    ...(place.accessibility.seating
      ? [{ key: "seating" as const, label: t.criteria.seating, attr: place.accessibility.seating }]
      : []),
  ]

  const included = criteria.filter((c) => c.attr.value !== "unknown")
  const sum = included.reduce((s, c) => s + c.attr.confidence, 0)
  const avg = included.length > 0 ? sum / included.length : 0

  const formulaParts = included.map((c) => `${Math.round(c.attr.confidence * 100)}%`)
  const formula =
    included.length > 0
      ? `(${formulaParts.join(" + ")}) ÷ ${included.length} = ${Math.round(avg * 100)}%`
      : "—"

  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground italic leading-snug">
        {t.results.scoreDataQualityNote}
      </p>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-normal pb-1">{t.results.scoreCriterion}</th>
            <th className="text-right font-normal pb-1">{t.results.scoreValueWeight}</th>
          </tr>
        </thead>
        <tbody>
          {criteria.map(({ key, label, attr }) => {
            const isKnown = attr.value !== "unknown"
            return (
              <tr key={key} className={isKnown ? "" : "opacity-40"}>
                <td className="py-0.5">{isKnown ? "✓" : "–"} {label}</td>
                <td className="py-0.5 text-right tabular-nums">
                  {isKnown
                    ? `${valueLabel(key, attr.value)} · ${Math.round(attr.confidence * 100)}%`
                    : "—"}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="border-t border-border pt-1.5 font-mono text-muted-foreground break-all">
        {formula}
      </div>
    </div>
  )
}

function collectVerifiedSources(place: Place) {
  return [
    place.accessibility.entrance,
    place.accessibility.toilet,
    place.accessibility.parking,
    ...(place.accessibility.seating ? [place.accessibility.seating] : []),
  ].flatMap((a) => a.sources.filter((s) => s.verifiedRecently))
}

function latestVerifiedAt(place: Place): string | undefined {
  const dates = collectVerifiedSources(place)
    .map((s) => s.verifiedAt)
    .filter((d): d is string => Boolean(d))
  if (dates.length === 0) return undefined
  return dates.slice().sort().pop()
}

export default function ConfidenceBadge({ confidence, place, className }: Props) {
  const t        = useTranslations()
  const isMobile = useIsMobile()
  const level    = confidenceLabel(confidence)
  const pct      = Math.round(confidence * 100)
  const [sheetOpen, setSheetOpen] = useState(false)

  const verified     = place ? collectVerifiedSources(place).length > 0 : false
  const verifiedDate = place && verified ? latestVerifiedAt(place) : undefined

  const ageLabel = verifiedDate ? t.results.verifiedAge(verifiedDate) : ""

  const verifiedIcon = verified && (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={t.results.verifiedRecently}
          className="inline-flex items-center gap-0.5 text-emerald-600 cursor-default"
        >
          <Check className="w-3 h-3" />
          <Accessibility className="w-3.5 h-3.5 -ml-0.5" />
          {ageLabel && (
            <span className="text-[10px] font-medium tabular-nums">{ageLabel}</span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {verifiedDate ? t.results.verifiedAt(verifiedDate) : t.results.verifiedRecently}
      </TooltipContent>
    </Tooltip>
  )

  const badge = (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
      COLORS[level],
      place ? "cursor-pointer" : "cursor-default",
    )}>
      {pct}% · {t.results.confidence[level]}
    </span>
  )

  const badgeWithInteraction = place ? (
    isMobile ? (
      <>
        <button onClick={(e) => { e.stopPropagation(); setSheetOpen(true) }} className="leading-none">
          {badge}
        </button>
        <BottomSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={t.results.scoreCalculation}
        >
          <ScoreContent place={place} />
        </BottomSheet>
      </>
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="left" className="bg-white text-zinc-900 border border-zinc-200 shadow-lg p-3 w-[min(22rem,90vw)]">
          <ScoreContent place={place} />
        </TooltipContent>
      </Tooltip>
    )
  ) : badge

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {verifiedIcon}
      {badgeWithInteraction}
    </span>
  )
}
