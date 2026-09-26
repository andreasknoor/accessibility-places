"use client"

import CriterionIcon from "@/components/simple/CriterionIcon"
import { useTranslations } from "@/lib/i18n"
import { evaluatePlaceJudgment } from "@/lib/reliability"
import { quickstartHeadline, quickstartJudgmentFilters } from "@/lib/simple-view"
import { cn } from "@/lib/utils"
import type { Place } from "@/lib/types"

// Quickstart counterpart to JudgmentLine: same disc + headline layout and
// colours, but the fixed, absolute Quickstart wording ("Barrierefrei
// nutzbar") against Quickstart's fixed preset instead of the user's filters.
export default function QuickstartVerdict({ place, size = "md", className }: { place: Place; size?: "md" | "lg"; className?: string }) {
  const t = useTranslations()
  const { status } = evaluatePlaceJudgment(place, quickstartJudgmentFilters(place.category))
  const pass = status === "pass" || status === "pass_limited"
  const color = pass ? "text-green-700" : status === "fail" ? "text-red-700" : "text-amber-700"
  const value = pass ? "yes" : status === "fail" ? "no" : "unknown"
  const lg = size === "lg"
  return (
    <div className={cn("flex items-center", lg ? "gap-3" : "gap-2", className)}>
      <CriterionIcon value={value} filled className={lg ? "w-8 h-8" : "w-5 h-5"} />
      <p className={cn(lg ? "text-base font-bold" : "text-sm font-semibold", "leading-snug", color)}>
        {quickstartHeadline(t, status)}
      </p>
    </div>
  )
}
