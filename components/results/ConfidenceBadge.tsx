"use client"

// v13 (docs/plans/reliability-tiers.md): the old place-wide percentage badge
// and its ScoreContent tooltip breakdown, plus the separate VerifiedBadge
// footer icon, are gone. What's left in this file is only the evidence-sum
// breakdown table, now rendered exclusively inside PlaceDebugSheet's
// expandable "Nachweis je Kriterium" section (never on the card itself, and
// never behind a colour-coded pill) — kept as a named export from this file
// (rather than renaming/moving it) to avoid rippling the import in
// PlaceDebugSheet.tsx for a change that's purely internal to this component.

import { useTranslations } from "@/lib/i18n"
import { SOURCE_LABELS } from "@/lib/config"
import { CRITERION_STYLES } from "@/components/results/CriterionBox"
import { criterionTier, attrVerifiedAt } from "@/lib/reliability"
import { cn } from "@/lib/utils"
import type { Place, AccessibilityAttribute, SourceId } from "@/lib/types"

function evidenceLine(attr: AccessibilityAttribute): string {
  const contributing = attr.sources.filter((s) => s.value === attr.value)
  if (contributing.length === 0) return "—"
  const parts = contributing
    .slice()
    .sort((a, b) => b.reliabilityWeight - a.reliabilityWeight)
    .map((s) => `${SOURCE_LABELS[s.sourceId as SourceId] ?? s.sourceId} ${s.reliabilityWeight.toFixed(2)}`)
  return `${parts.join(" + ")} = ${attr.confidence.toFixed(2)}`
}

export function ScoreContent({ place }: { place: Place }) {
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

  return (
    <div className="space-y-2 text-xs">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-normal pb-1">{t.results.scoreCriterionCol}</th>
            <th className="text-right font-normal pb-1">{t.results.scoreEvidenceCol}</th>
          </tr>
        </thead>
        <tbody>
          {criteria.map(({ key, label, attr }) => {
            const isKnown = attr.value !== "unknown"
            const tier = criterionTier(attr)
            const verifiedIso = attrVerifiedAt(attr)
            const verifiedLabel = verifiedIso
              ? (() => {
                  const s = t.results.verifiedAt(verifiedIso, [])
                  return s.charAt(0).toLowerCase() + s.slice(1)
                })()
              : undefined
            return (
              <tr key={key} className={isKnown ? "" : "opacity-40"}>
                <td className="py-0.5 align-top">
                  <span className={cn(isKnown && CRITERION_STYLES[attr.value].color)}>
                    {isKnown ? "✓" : "–"} {label}
                  </span>
                  {isKnown && <div className="text-muted-foreground">{valueLabel(key, attr.value)}</div>}
                </td>
                <td className="py-0.5 text-right tabular-nums align-top">
                  {isKnown ? (
                    <>
                      <div className="font-medium">{t.results.reliabilityNote(tier, verifiedLabel)}</div>
                      <div className="text-muted-foreground font-mono text-[10px]">{evidenceLine(attr)}</div>
                    </>
                  ) : "—"}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
