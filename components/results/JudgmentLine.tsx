"use client"

// The Turbo-mode headline (v13, docs/plans/reliability-tiers.md): answers
// "does this place satisfy my ACTIVE filters?" — a separate axis from
// reliability (ConfidenceBadge.tsx's ScoreContent / the per-criterion
// Nachsatz in A11yAttribute.tsx). Colour here is legitimate — this is the
// sachebene judgement, the same green/amber/red CriterionBox already uses —
// unlike the retired place-wide score pill, this never encodes data quality.

import { CheckCircle2, HelpCircle, XCircle } from "lucide-react"
import { useTranslations } from "@/lib/i18n"
import { evaluatePlaceJudgment, type JudgmentFilters, type CriterionKey } from "@/lib/reliability"
import { cn } from "@/lib/utils"
import type { Place } from "@/lib/types"

interface Props {
  place:      Place
  filters:    JudgmentFilters
  className?: string
}

export default function JudgmentLine({ place, filters, className }: Props) {
  const t = useTranslations()
  const judgment = evaluatePlaceJudgment(place, filters)
  const label = (k: CriterionKey) => t.criteria[k]

  if (judgment.status === "none") {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {t.results.judgmentNone}
      </p>
    )
  }

  const HEADLINE: Record<Exclude<typeof judgment.status, "none">, { icon: typeof CheckCircle2; color: string; text: string }> = {
    pass:         { icon: CheckCircle2, color: "text-green-700",  text: t.results.judgmentPass },
    pass_limited: { icon: CheckCircle2, color: "text-green-700",  text: t.results.judgmentPass },
    unverified:   { icon: HelpCircle,   color: "text-amber-700",  text: t.results.judgmentUnverified },
    fail:         { icon: XCircle,      color: "text-red-700",    text: t.results.judgmentFail },
  }
  const { icon: Icon, color, text } = HEADLINE[judgment.status]

  const why = judgment.status === "pass"
    ? t.results.judgmentPassAllNote
    : judgment.status === "pass_limited"
      ? t.results.judgmentPassLimitedNote(t.results.joinCriteria(judgment.limited.map(label)))
      : judgment.status === "unverified"
        ? t.results.judgmentUnverifiedNote(t.results.joinCriteria(judgment.unknown.map(label)))
        : t.results.judgmentFailNote(t.results.joinCriteria(judgment.failed.map(label)))

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <p className={cn("flex items-center gap-1.5 text-sm font-semibold", color)}>
        <Icon className="w-4 h-4 shrink-0" aria-hidden />
        {text}
      </p>
      <p className="text-xs text-muted-foreground pl-[1.375rem]">{why}</p>
    </div>
  )
}
