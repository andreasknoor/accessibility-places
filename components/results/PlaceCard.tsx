"use client"

import { useState } from "react"
import { createPortal } from "react-dom"
import { MapPin } from "lucide-react"
import JudgmentLine     from "./JudgmentLine"
import PlaceDebugSheet  from "./PlaceDebugSheet"
import OpeningStatusChip from "./OpeningStatusChip"
import CriterionItem from "@/components/place/CriterionItem"
import { ACTION_PRIMARY, ACTION_SECONDARY } from "@/components/place/action-styles"
import NavigateButton from "@/components/ui/navigate-button"
import { track } from "@/lib/analytics"
import { useTranslations } from "@/lib/i18n"
import { CATEGORY_ICONS }  from "@/lib/category-icons"
import type { JudgmentFilters } from "@/lib/reliability"
import { useOpeningStatus } from "@/lib/opening-hours"
import { cn } from "@/lib/utils"
import type { Place, SearchFilters } from "@/lib/types"

// No active filter to judge against — degrades to JudgmentLine's own
// "no criteria active" state rather than fabricating a green pass.
const NO_FILTERS: JudgmentFilters = { entrance: false, toilet: false, parking: false, seating: false, acceptUnknown: false }

interface Props {
  place:       Place
  isSelected?: boolean
  // "Zur Karte": selects/highlights this place on the map.
  onClick?:    () => void
  distanceM?:  number
  filters?:    SearchFilters
  // Forwarded only to the Info-Sheet's JudgmentLine (see JudgmentLine.tsx) —
  // the card's own JudgmentLine never receives this, so its "Kriterien" text
  // stays plain, non-interactive.
  onOpenFilters?: () => void
}

// Expert Mode result card — "V1+" of the unified place UI
// (see CLAUDE.md): name, category ·
// opening status · distance, the judgement against the active filters, a
// criteria list (glyph + name, value right-aligned) and an action row.
//
// Deliberately NOT on the card any more (all of it is in PlaceDebugSheet):
// best-source row, dog/diet badges, website/phone/Wheelmap/Google-Maps/Ginto
// link icons, the in-card "Details" expand, and the per-criterion reliability
// sentence (only a weak tier still shows, as an exception marker). The
// address only shows when no distance is known (text/city search).
//
// Tap targets mirror SimplePlaceCard: whole card = pointer-only shortcut to
// the detail sheet, "Details" = the real focusable control, action buttons
// stop propagation. Default action is "Zur Karte"; "Route" never is.
export default function PlaceCard({ place, isSelected, onClick, distanceM, filters, onOpenFilters }: Props) {
  const judgmentFilters: JudgmentFilters = filters
    ? { entrance: filters.entrance, toilet: filters.toilet, parking: filters.parking, parkingNearby: filters.parkingNearby, seating: filters.seating, onlyVerified: filters.onlyVerified, acceptUnknown: filters.acceptUnknown }
    : NO_FILTERS
  const t = useTranslations()
  const [showDebug, setShowDebug] = useState(false)
  const openingStatus = useOpeningStatus(place)
  const category = (t.categories as Record<string, string>)[place.category] ?? place.category

  const addr = [place.address.street, place.address.houseNumber, place.address.city]
    .filter(Boolean).join(" ")

  function openDetails() {
    setShowDebug(true)
    track("detail_sheet_open", { category: place.category })
  }

  return (
    <div
      onClick={openDetails}
      className={cn(
        "rounded-2xl bg-card shadow-place cursor-pointer transition-shadow hover:shadow-md",
        isSelected && "ring-2 ring-primary",
      )}
    >
      <div className="px-3.5 pt-3 pb-2.5 flex flex-col gap-0.5">
        <h3 className="text-base font-bold leading-snug tracking-tight line-clamp-2 break-words">{place.name}</h3>
        <p className="text-[13px] text-muted-foreground flex items-center gap-1 flex-wrap">
          <span><span aria-hidden>{CATEGORY_ICONS[place.category] ?? "📍"} </span>{category}</span>
          {/* Renders nothing when no opening-hours status is computable. */}
          {openingStatus && <span aria-hidden>·</span>}
          <OpeningStatusChip status={openingStatus} size="sm" className="font-medium" />
          {distanceM !== undefined && (
            <><span aria-hidden>·</span><span>{t.results.distanceShort(Math.round(distanceM))}</span></>
          )}
        </p>
        {distanceM === undefined && addr && (
          <p className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
            <MapPin className="w-3 h-3 shrink-0" aria-hidden />
            <span className="truncate">{addr}</span>
          </p>
        )}
        <JudgmentLine place={place} filters={judgmentFilters} hideNoteOnPass className="mt-2" />
        {/* One line per criterion (name left, value right) — no gaps, room
            for long values. Seating is deliberately not on the card: it only
            ever comes from Google Places (always "unsicher") and lives in the
            detail view. */}
        <div className="mt-2.5 divide-y divide-border/70 border-y border-border/70">
          <CriterionItem kind="entrance" attr={place.accessibility.entrance} variant="row" />
          <CriterionItem kind="toilet"   attr={place.accessibility.toilet}   variant="row" />
          <CriterionItem kind="parking"  attr={place.accessibility.parking}  variant="row" />
        </div>
      </div>
      <div className="flex gap-2 px-3.5 pb-3">
        {onClick && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClick() }}
            className={ACTION_PRIMARY}
          >
            <MapPin className="w-4 h-4 shrink-0" aria-hidden />
            {t.results.showOnMap}
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); openDetails() }}
          aria-label={t.results.openDetails(place.name)}
          className={ACTION_SECONDARY}
        >
          {t.place.details}
        </button>
        <NavigateButton coords={place.coordinates} variant="action" />
      </div>

      {showDebug && createPortal(
        <PlaceDebugSheet place={place} onClose={() => setShowDebug(false)} filters={filters} onOpenFilters={onOpenFilters} />,
        document.body,
      )}
    </div>
  )
}
