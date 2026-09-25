"use client"

import { Armchair, DoorOpen } from "lucide-react"
import CriterionIcon from "@/components/simple/CriterionIcon"
import { RESTROOM_GLYPH } from "@/lib/amenities/badge-scene"
import { cn } from "@/lib/utils"
import type { A11yValue } from "@/lib/types"

export type CriterionKind = "entrance" | "toilet" | "parking" | "seating"

// The restroom pictogram is rendered from the same GlyphSpec the map's WC
// markers are drawn from (badge-scene.ts) — one definition for map and UI,
// and language-neutral (the former "WC" text glyph only read in German).
function RestroomIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      {RESTROOM_GLYPH.fills.map((f, i) => <path key={i} d={f.d} opacity={f.opacity} />)}
    </svg>
  )
}

const SIZES = {
  sm: { box: "w-7 h-7 rounded-lg",    icon: "w-4 h-4",     p: "text-[10px] leading-[13px] px-[3px] border-[1.6px] rounded", badge: "w-3.5 h-3.5 -right-1 -bottom-1" },
  md: { box: "w-10 h-10 rounded-xl",  icon: "w-[22px] h-[22px]", p: "text-sm leading-[18px] px-1 border-2 rounded-[5px]", badge: "w-4 h-4 -right-1 -bottom-1" },
} as const

interface Props {
  kind:       CriterionKind
  // Status badge (✓ ! ✕ ?) in the bottom-right corner; omitted → glyph only.
  value?:     A11yValue
  size?:      keyof typeof SIZES
  className?: string
}

// Decorative: the glyph and its status badge are always accompanied by a
// visible (or screen-reader) text naming criterion and value — see
// CriterionItem — so the whole thing is aria-hidden.
export default function CriterionGlyph({ kind, value, size = "sm", className }: Props) {
  const s = SIZES[size]
  return (
    <span
      aria-hidden
      className={cn("relative inline-grid place-items-center shrink-0 bg-slate-100 text-slate-700", s.box, className)}
    >
      {kind === "entrance" && <DoorOpen className={s.icon} strokeWidth={2} />}
      {kind === "seating"  && <Armchair className={s.icon} strokeWidth={2} />}
      {kind === "toilet"   && <RestroomIcon className={s.icon} />}
      {kind === "parking"  && <span className={cn("font-extrabold border-current", s.p)}>P</span>}
      {value && (
        <CriterionIcon value={value} filled className={cn("absolute ring-2 ring-white", s.badge)} />
      )}
    </span>
  )
}
