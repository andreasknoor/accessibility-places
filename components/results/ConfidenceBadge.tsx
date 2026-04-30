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
import type { Place, SearchFilters } from "@/lib/types"

interface Props {
  confidence: number
  place?:     Place
  filters?:   SearchFilters
  className?: string
}

const COLORS = {
  high:   "bg-green-100 text-green-800 border-green-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low:    "bg-red-100 text-red-800 border-red-200",
}

const VALUE_LABEL: Record<string, string> = {
  yes:     "Ja",
  limited: "Eingeschränkt",
  no:      "Nein",
  unknown: "—",
}

function ScoreContent({ place, filters }: { place: Place; filters: SearchFilters }) {
  const criteria = [
    { key: "entrance" as const, label: "Eingang",    attr: place.accessibility.entrance },
    { key: "toilet"   as const, label: "Toilette",   attr: place.accessibility.toilet   },
    { key: "parking"  as const, label: "Parkplatz",  attr: place.accessibility.parking  },
    ...(place.accessibility.seating
      ? [{ key: "seating" as const, label: "Sitzplätze", attr: place.accessibility.seating }]
      : []),
  ]

  const included = criteria.filter(
    (c) => filters[c.key] && c.attr.value !== "unknown",
  )
  const sum = included.reduce((s, c) => s + c.attr.confidence, 0)
  const avg = included.length > 0 ? sum / included.length : 0

  const formulaParts = included.map((c) => `${Math.round(c.attr.confidence * 100)}%`)
  const formula =
    included.length > 0
      ? `(${formulaParts.join(" + ")}) ÷ ${included.length} = ${Math.round(avg * 100)}%`
      : "Keine bewerteten Kriterien aktiv"

  return (
    <div className="space-y-2 text-xs">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-normal pb-1">Kriterium</th>
            <th className="text-right font-normal pb-1">Wert · Gewicht</th>
          </tr>
        </thead>
        <tbody>
          {criteria.map(({ key, label, attr }) => {
            const isActive = filters[key] ?? false
            const isKnown  = attr.value !== "unknown"
            const counts   = isActive && isKnown
            return (
              <tr key={key} className={counts ? "" : "opacity-40"}>
                <td className="py-0.5">{counts ? "✓" : "–"} {label}</td>
                <td className="py-0.5 text-right tabular-nums">
                  {counts
                    ? `${VALUE_LABEL[attr.value] ?? attr.value} · ${Math.round(attr.confidence * 100)}%`
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

export default function ConfidenceBadge({ confidence, place, filters, className }: Props) {
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
      place && filters ? "cursor-pointer" : "cursor-default",
    )}>
      {pct}% · {t.results.confidence[level]}
    </span>
  )

  const badgeWithInteraction = place && filters ? (
    isMobile ? (
      <>
        <button onClick={(e) => { e.stopPropagation(); setSheetOpen(true) }} className="leading-none">
          {badge}
        </button>
        <BottomSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Score-Berechnung"
        >
          <ScoreContent place={place} filters={filters} />
        </BottomSheet>
      </>
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="left" className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 border border-zinc-200 dark:border-zinc-700 shadow-lg p-3 w-[min(22rem,90vw)]">
          <ScoreContent place={place} filters={filters} />
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
