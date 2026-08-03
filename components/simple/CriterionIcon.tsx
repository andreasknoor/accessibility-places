"use client"

import type { ReactNode } from "react"
import { CRITERION_STYLES } from "@/components/results/CriterionBox"
import { cn } from "@/lib/utils"
import type { A11yValue } from "@/lib/types"

// Distinct SILHOUETTE per value — not just colour — so Quickstart's
// criterion rows stay scannable for colourblind users (WCAG 1.4.1, "use of
// colour"): checkmark / exclamation / cross / question mark are never
// confusable with each other even in greyscale, unlike the plain colour dot
// this replaces (SimpleDetail's CriterionRow, SimplePlaceCard's entrance/
// toilet lines). Prototype: docs artifact 2026-08-03, "Vorschlag A".
const GLYPHS: Record<A11yValue, ReactNode> = {
  yes: <polyline points="20 6 9 17 4 12" />,
  limited: (
    <>
      <line x1="12" y1="7" x2="12" y2="13" />
      <circle cx="12" cy="16.5" r="0.75" fill="currentColor" stroke="none" />
    </>
  ),
  no: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  unknown: (
    <>
      <path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.9.4-1.4 1-1.4 1.9" />
      <circle cx="12" cy="17" r="0.75" fill="currentColor" stroke="none" />
    </>
  ),
}

interface Props {
  value:     A11yValue
  className?: string
}

export default function CriterionIcon({ value, className }: Props) {
  const style = CRITERION_STYLES[value]
  return (
    <span
      className={cn("inline-flex items-center justify-center rounded-full shrink-0", style.bg, className)}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={value === "unknown" ? 2.2 : 3}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn("w-3/5 h-3/5", style.color)}
      >
        {GLYPHS[value]}
      </svg>
    </span>
  )
}
