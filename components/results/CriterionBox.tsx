"use client"

import { Fragment, type ReactNode } from "react"
import { CheckCircle2, XCircle, HelpCircle } from "lucide-react"
import { cn } from "@/lib/utils"

// The shared visual shell for an accessibility criterion: a colour-toned rounded
// box with an icon + label + value header, optional indented detail rows, and an
// optional italic note. Extracted from A11yAttribute so amenity results (WC /
// parking) render with the exact same look as venue criteria — one source of
// truth for the box styling, never two drifting copies.
export type CriterionTone = "yes" | "limited" | "no" | "unknown"

export const CRITERION_STYLES: Record<CriterionTone, { icon: typeof CheckCircle2; color: string; bg: string }> = {
  yes:     { icon: CheckCircle2, color: "text-green-600",  bg: "bg-green-50"  },
  limited: { icon: CheckCircle2, color: "text-yellow-600", bg: "bg-yellow-50" },
  no:      { icon: XCircle,      color: "text-red-600",    bg: "bg-red-50"    },
  unknown: { icon: HelpCircle,   color: "text-slate-400",  bg: "bg-slate-50"  },
}

interface Props {
  tone:         CriterionTone
  label:        string
  value?:       string
  // A `tone` on a row renders a leading ✓/✗ icon (and tints the value) so a
  // yes/no sub-fact reads as its own mini-criterion — e.g. "Dedicated wheelchair
  // spaces: No" gets a red ✗. Rows without a tone stay plain label/value.
  rows?:        { label: string; value: string; tone?: CriterionTone }[]
  note?:        string
  /**
   * How detail rows are laid out:
   * - "detail" (default): compact, indented label/value grid — sub-facts read as
   *   secondary details under the header (venue A11yAttribute expanded view).
   * - "criterion": each row is a full-width line formatted like the header
   *   (label left, value right-aligned, same font/size), so every sub-fact reads
   *   as a peer criterion — used by amenity (parking/WC) cards.
   */
  rowsVariant?: "detail" | "criterion"
  /** Extra header content rendered after the value (e.g. a conflict warning icon). */
  headerExtra?: ReactNode
  /** Extra content rendered directly below the header (e.g. conflict source rows). */
  children?:    ReactNode
}

export default function CriterionBox({ tone, label, value, rows, note, rowsVariant = "detail", headerExtra, children }: Props) {
  const style = CRITERION_STYLES[tone]
  const Icon  = style.icon
  return (
    <div className={cn("rounded-md px-2.5 py-1.5 flex flex-col gap-1", style.bg)}>
      {/* Header row */}
      <div className="flex items-center gap-1.5">
        <Icon className={cn("w-3.5 h-3.5 shrink-0", style.color)} />
        <span className="text-xs font-medium text-foreground min-w-0 flex-1 truncate">{label}</span>
        {value && <span className={cn("text-xs shrink-0", style.color)}>{value}</span>}
        {headerExtra}
      </div>

      {children}

      {/* Detail rows — "detail": compact indented grid (venue sub-facts). */}
      {rows && rows.length > 0 && rowsVariant === "detail" && (
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-2 gap-y-0.5 pl-5 mt-0.5">
          {rows.map((r, i) => {
            const rowStyle = r.tone ? CRITERION_STYLES[r.tone] : undefined
            const RowIcon  = rowStyle?.icon
            return (
              <Fragment key={i}>
                <dt className="text-xs text-muted-foreground break-words flex items-center gap-1">
                  {RowIcon && <RowIcon className={cn("w-3 h-3 shrink-0", rowStyle!.color)} aria-hidden />}
                  <span>{r.label}</span>
                </dt>
                <dd className={cn("text-xs break-words", rowStyle ? rowStyle.color : "text-foreground")}>{r.value}</dd>
              </Fragment>
            )
          })}
        </dl>
      )}

      {/* Detail rows — "criterion": each a full-width line formatted like the
          header (label left, value right-aligned, same font/size), so every
          sub-fact reads as a peer criterion. Plain rows reserve the icon width
          so all labels line up with the header label. */}
      {rows && rows.length > 0 && rowsVariant === "criterion" && (
        <div className="flex flex-col gap-1">
          {rows.map((r, i) => {
            const rowStyle = r.tone ? CRITERION_STYLES[r.tone] : undefined
            const RowIcon  = rowStyle?.icon
            return (
              <div key={i} className="flex items-start gap-1.5">
                {RowIcon
                  ? <RowIcon className={cn("w-3.5 h-3.5 shrink-0 mt-px", rowStyle!.color)} aria-hidden />
                  : <span className="w-3.5 shrink-0" aria-hidden />}
                <span className="text-xs font-medium text-foreground flex-1 min-w-0 break-words">{r.label}</span>
                <span className={cn("text-xs shrink-0 text-right", rowStyle ? rowStyle.color : "text-foreground")}>{r.value}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Free-text note */}
      {note && <p className="pl-5 text-xs italic text-muted-foreground mt-0.5">{note}</p>}
    </div>
  )
}
