"use client"

// The Expert Mode headline (v13, docs/plans/reliability-tiers.md): answers
// "does this place satisfy my ACTIVE filters?" — a separate axis from
// reliability (ConfidenceBadge.tsx's ScoreContent / the per-criterion
// Nachsatz in A11yAttribute.tsx). Colour here is legitimate — this is the
// sachebene judgement, the same green/amber/red CriterionBox already uses —
// unlike the retired place-wide score pill, this never encodes data quality.
//
// This is also the single place the old, separate "Achtung: evtl. nicht
// barrierefrei" warning box used to live — retired (2026-08-02): it said
// almost exactly what this headline already says, just a second time in a
// second element. See docs/plans/reliability-tiers.md's warning-box section.

import { CheckCircle2, HelpCircle, Pencil, XCircle } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from "@/components/ui/popover"
import { useTranslations } from "@/lib/i18n"
import { evaluatePlaceJudgment, activeCriteriaCount, CRITERION_KEYS, type JudgmentFilters, type CriterionKey } from "@/lib/reliability"
import { cn } from "@/lib/utils"
import type { Place } from "@/lib/types"

interface Props {
  place:      Place
  filters:    JudgmentFilters
  className?: string
  // Only given in the Info-Sheet (PlaceDebugSheet) — turns "Kriterien"/
  // "Kriterium" into a real, focusable button that opens an inline popover
  // naming the active criteria, with a secondary "Filter bearbeiten" button
  // that actually calls this. Deliberately NOT a direct jump straight to the
  // filter view (2026-08-03): the Info-Sheet is a position:fixed overlay
  // that covers the whole screen on mobile, so switching the underlying
  // filter tab happened invisibly behind it — the tap looked like it did
  // nothing. Answering "which criteria" in place, with navigation demoted to
  // its own deliberate secondary click, sidesteps that entirely. Deliberately
  // absent on the result-card's own JudgmentLine: that headline sits inside
  // the card's single "opens detail sheet" tap target, and nesting a second,
  // differently-destined interactive control in there would either require
  // restructuring that box or create a confusing nested-button situation for
  // keyboard/screen-reader users. The card shows the same count as plain
  // text; the sheet is where the popover lives.
  onOpenFilters?: () => void
}

export default function JudgmentLine({ place, filters, className, onOpenFilters }: Props) {
  const t = useTranslations()
  const judgment = evaluatePlaceJudgment(place, filters)
  const label = (k: CriterionKey) => t.criteria[k]
  const activeCount = activeCriteriaCount(filters)

  if (judgment.status === "none") {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {t.results.judgmentNone}
      </p>
    )
  }

  const ICONS: Record<Exclude<typeof judgment.status, "none">, { icon: typeof CheckCircle2; color: string }> = {
    pass:         { icon: CheckCircle2, color: "text-green-700" },
    pass_limited: { icon: CheckCircle2, color: "text-green-700" },
    unverified:   { icon: HelpCircle,   color: "text-amber-700" },
    fail:         { icon: XCircle,      color: "text-red-700"   },
  }
  const { icon: Icon, color } = ICONS[judgment.status]

  // pass/pass_limited/fail carry the criteria count and an optional link;
  // unverified's headline ("Nicht gesichert") doesn't reference "Kriterien"
  // at all, so it stays a plain string.
  const headlineParts =
    judgment.status === "unverified"
      ? { pre: t.results.judgmentUnverified, criteria: "", post: "" }
      : judgment.status === "fail"
        ? t.results.judgmentFail(activeCount)
        : t.results.judgmentPass(activeCount)

  const why = judgment.status === "pass"
    ? t.results.judgmentPassAllNote
    : judgment.status === "pass_limited"
      ? t.results.judgmentPassLimitedNote(t.results.joinCriteria(judgment.limited.map(label)))
      : judgment.status === "unverified"
        ? t.results.judgmentUnverifiedNote(t.results.joinCriteria(judgment.unknown.map(label)))
        : t.results.judgmentFailNote(t.results.joinCriteria([
            ...judgment.failed.map(label),
            ...(judgment.verifiedFailed ? [t.criteria.verifiedOnly] : []),
          ]))

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <p className={cn("flex items-center gap-1.5 text-sm font-semibold", color)}>
        <Icon className="w-4 h-4 shrink-0" aria-hidden />
        <span>
          {headlineParts.pre}
          {headlineParts.criteria && (
            onOpenFilters ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={t.results.judgmentShowCriteria}
                    className="underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  >
                    {headlineParts.criteria}
                  </button>
                </PopoverTrigger>
                {/* z-[1100]: PopoverContent's own default (z-50, components/ui/popover.tsx)
                    sits below PlaceDebugSheet's overlay (z-[1050]/z-[1051]) — this
                    popover only ever renders inside that sheet (onOpenFilters is
                    Info-Sheet-only), so the portalled content would otherwise paint
                    invisibly underneath it: a click that visibly "does nothing".
                    Same fix/value as navigate-button.tsx's own chooser popover. */}
                <PopoverContent
                  align="start"
                  className="w-56 p-3 z-[1100]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    {t.results.judgmentActiveCriteria}
                  </p>
                  <ul className="flex flex-col gap-1 mb-3">
                    {CRITERION_KEYS.filter((k) => filters[k]).map((k) => (
                      <li key={k} className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden />
                        {label(k)}
                      </li>
                    ))}
                    {filters.onlyVerified && (
                      <li className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden />
                        {t.filters.criteriaItems.onlyVerified}
                      </li>
                    )}
                  </ul>
                  <PopoverClose asChild>
                    <button
                      type="button"
                      onClick={onOpenFilters}
                      className="flex items-center gap-1.5 w-full text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors rounded-md px-2.5 py-1.5"
                    >
                      <Pencil className="w-3.5 h-3.5 shrink-0" aria-hidden />
                      {t.results.judgmentEditFilters}
                    </button>
                  </PopoverClose>
                </PopoverContent>
              </Popover>
            ) : (
              <span>{headlineParts.criteria}</span>
            )
          )}
          {headlineParts.post}
        </span>
      </p>
      <p className="text-xs text-muted-foreground pl-[1.375rem]">{why}</p>
    </div>
  )
}
