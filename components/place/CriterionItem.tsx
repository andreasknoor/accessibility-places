"use client"

import CriterionGlyph, { type CriterionKind } from "@/components/place/CriterionGlyph"
import { useTranslations } from "@/lib/i18n"
import { criterionTier } from "@/lib/reliability"
import { criterionSentence } from "@/lib/simple-view"
import { cn } from "@/lib/utils"
import type { A11yValue, AccessibilityAttribute } from "@/lib/types"

export const VALUE_TEXT: Record<A11yValue, string> = {
  yes:     "text-green-700",
  limited: "text-amber-700",
  no:      "text-red-700",
  unknown: "text-slate-500",
}

// "Ja, in der Nähe (120 m)" for parking upgraded from a nearby disabled-
// parking feature, otherwise the plain value word. Shared by the result card
// and the detail view so both word it identically.
export function criterionValueLabel(t: ReturnType<typeof useTranslations>, kind: CriterionKind, attr: AccessibilityAttribute): string {
  const d = attr.details as { nearbyOnly?: boolean; nearbyParkingDistanceM?: number } | undefined
  if (kind === "parking" && attr.value === "yes" && d?.nearbyOnly) {
    return `${t.a11y.yesNearby}${d.nearbyParkingDistanceM != null ? ` (${d.nearbyParkingDistanceM} m)` : ""}`
  }
  return t.a11y[attr.value]
}

// Three dots, filled per tier — the same neutral grammar as the detail
// view's reliability indicator. Never coloured: reliability is a separate
// axis from the yes/limited/no value colour.
export function ReliabilityDots({ tier, className }: { tier: "sehr_hoch" | "gut" | "gering"; className?: string }) {
  const filled = tier === "sehr_hoch" ? 3 : tier === "gut" ? 2 : 1
  return (
    <span aria-hidden className={cn("inline-flex items-center gap-[2px]", className)}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={cn("block w-[5px] h-[5px] rounded-full", i < filled ? "bg-slate-600" : "bg-slate-300")} />
      ))}
    </span>
  )
}

interface Props {
  kind: CriterionKind
  attr: AccessibilityAttribute
  // "compact"  — glyph + criterion name + coloured value word below (Expert
  //              result card grid). A weak ("gering") reliability tier shows
  //              as an exception marker; better tiers stay silent here.
  // "sentence" — glyph + plain-language sentence (Quickstart result card),
  //              which already names the outcome.
  variant: "compact" | "sentence"
  className?: string
}

export default function CriterionItem({ kind, attr, variant, className }: Props) {
  const t = useTranslations()
  const name = t.criteria[kind]

  if (variant === "sentence") {
    const sentence = kind === "seating"
      ? `${name}: ${t.a11y[attr.value]}`
      : criterionSentence(t, kind, attr.value)
    return (
      <div className={cn("flex items-center gap-2.5 text-sm", className)}>
        <CriterionGlyph kind={kind} value={attr.value} />
        <span className="min-w-0">{sentence}</span>
      </div>
    )
  }

  const value = criterionValueLabel(t, kind, attr)
  const weak = attr.value !== "unknown" && criterionTier(attr) === "gering"
  return (
    <div className={cn("flex items-center gap-2.5 min-w-0", className)}>
      <CriterionGlyph kind={kind} value={attr.value} />
      <span className="flex flex-col min-w-0 leading-tight">
        <span className="text-[13px] text-foreground truncate">{name}</span>
        <span className={cn("text-xs font-semibold truncate", VALUE_TEXT[attr.value])}>{value}</span>
        {weak && (
          <span className="flex items-center gap-1 text-[11px] text-amber-700">
            <ReliabilityDots tier="gering" />
            <span aria-hidden>{t.results.tier.gering}</span>
            <span className="sr-only">{t.place.reliabilityShort(t.results.tier.gering)}</span>
          </span>
        )}
      </span>
    </div>
  )
}
