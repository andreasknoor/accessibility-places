"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTranslations } from "@/lib/i18n"
import { confidenceLabel } from "@/lib/matching/merge"
import { SOURCE_LABELS } from "@/lib/config"
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

function ScoreTooltip({ place, filters }: { place: Place; filters: SearchFilters }) {
  const criteria = [
    { key: "entrance" as const, label: "Eingang",   attr: place.accessibility.entrance },
    { key: "toilet"   as const, label: "Toilette",  attr: place.accessibility.toilet   },
    { key: "parking"  as const, label: "Parkplatz", attr: place.accessibility.parking  },
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
    <div className="w-96 space-y-2.5 text-xs">
      <p className="font-semibold text-sm">Score-Berechnung</p>

      <table className="w-full border-collapse">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-normal pb-1">Kriterium</th>
            <th className="text-left font-normal pb-1">Wert</th>
            <th className="text-right font-normal pb-1">Gewicht</th>
          </tr>
        </thead>
        <tbody>
          {criteria.map(({ key, label, attr }) => {
            const isActive  = filters[key] ?? false
            const isKnown   = attr.value !== "unknown"
            const counts    = isActive && isKnown
            const sourceName = attr.sources[0]
              ? SOURCE_LABELS[attr.sources[0].sourceId]
              : null
            return (
              <tr key={key} className={counts ? "" : "opacity-40"}>
                <td className="py-0.5">
                  {counts ? "✓" : "–"} {label}
                  {sourceName && (
                    <span className="ml-1 text-muted-foreground">({sourceName})</span>
                  )}
                </td>
                <td className="py-0.5">{VALUE_LABEL[attr.value] ?? attr.value}</td>
                <td className="py-0.5 text-right tabular-nums">
                  {counts ? `${Math.round(attr.confidence * 100)}%` : "—"}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="border-t border-border pt-2 font-mono text-muted-foreground">
        {formula}
      </div>

      <p className="text-muted-foreground leading-snug">
        Nur aktive Filter-Kriterien mit bekanntem Wert fließen ein.
      </p>
    </div>
  )
}

export default function ConfidenceBadge({ confidence, place, filters, className }: Props) {
  const t     = useTranslations()
  const level = confidenceLabel(confidence)
  const pct   = Math.round(confidence * 100)

  const badge = (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold cursor-default",
      COLORS[level],
      className,
    )}>
      {pct}% · {t.results.confidence[level]}
    </span>
  )

  if (!place || !filters) return badge

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="left" className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 border border-zinc-200 dark:border-zinc-700 shadow-lg p-3 max-w-none w-[32rem]">
        <ScoreTooltip place={place} filters={filters} />
      </TooltipContent>
    </Tooltip>
  )
}
