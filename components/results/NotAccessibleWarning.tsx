"use client"

import { AlertTriangle } from "lucide-react"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

// "Achtung: Dieser Ort ist evtl. nicht barrierefrei." — shown when entrance or
// toilet is "no"/"unknown" (see placeMayNotBeAccessible in lib/matching/merge.ts).
// Split into pre/bold/post i18n strings so "nicht"/"not" can render bold
// without embedding markup in the translation file.
export function NotAccessibleWarningBox({ className }: { className?: string }) {
  const t = useTranslations()
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700",
        className,
      )}
    >
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
      <p>
        {t.results.notAccessibleWarningPre}
        <b>{t.results.notAccessibleWarningBold}</b>
        {t.results.notAccessibleWarningPost}
      </p>
    </div>
  )
}

// Collapsed-by-default trigger for the results list (docs/prototypes/unknown-
// value-microcopy.html) — a small "!" badge appended next to the flagged
// value via A11yAttribute's headerExtra. Sits outside PlaceCard's own
// open-details tap target (a sibling, not nested — see PlaceCard.tsx's header
// box comment), so it doesn't need its own click handling beyond stopping
// propagation as a defensive measure.
export function NotAccessibleWarningToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const t = useTranslations()
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      aria-expanded={expanded}
      aria-label={t.results.notAccessibleWarningToggle}
      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-red-300 bg-red-50 text-red-600 text-[9px] font-bold leading-none shrink-0 hover:bg-red-100 transition-colors"
    >
      !
    </button>
  )
}
