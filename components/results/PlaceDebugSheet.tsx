"use client"

import { ChevronLeft, X } from "lucide-react"
import { useFocusTrap } from "@/hooks/useFocusTrap"
import { useIsMobile } from "@/hooks/useIsMobile"
import PlaceDetailView from "@/components/place/PlaceDetailView"
import { HERO_ICON, HERO_PILL } from "@/components/place/action-styles"
import { useTranslations } from "@/lib/i18n"
import type { JudgmentFilters } from "@/lib/reliability"
import type { Place, SearchFilters } from "@/lib/types"

interface Props {
  place:    Place
  onClose:  () => void
  filters?: SearchFilters
  // Opens the filter view — passed through to JudgmentLine so its
  // "Kriterien" text becomes a real popover trigger here (the only surface
  // where it exists, see JudgmentLine.tsx).
  onOpenFilters?: () => void
}

const NO_FILTERS: JudgmentFilters = { entrance: false, toilet: false, parking: false, seating: false, acceptUnknown: false }

// Expert Mode place info sheet: a modal dialog around the shared
// PlaceDetailView in "expert" mode (docs/plans/unified-results-detail-popup-
// redesign.md, "Detail V2"). On a phone the panel fills the screen, so it
// behaves like a screen: "‹ Zurück" top-left, no footer close button. On a
// desktop it is a 520 px side panel over the app, where "back" has no
// meaning — it keeps a "✕". Escape and a backdrop tap close it either way.
export default function PlaceDebugSheet({ place, onClose, filters, onOpenFilters }: Props) {
  const t = useTranslations()
  const isMobile = useIsMobile()
  // Focus management for the modal info sheet (WCAG 2.1.2 / 2.4.3): focus in
  // on open, trap Tab, close on Escape, restore focus to the trigger on close.
  const panelRef = useFocusTrap<HTMLDivElement>(onClose)

  const judgmentFilters: JudgmentFilters = filters
    ? { entrance: filters.entrance, toilet: filters.toilet, parking: filters.parking, parkingNearby: filters.parkingNearby, seating: filters.seating, onlyVerified: filters.onlyVerified, acceptUnknown: filters.acceptUnknown }
    : NO_FILTERS

  return (
    // Stops clicks inside the portalled sheet from bubbling (React events
    // bubble through portals) to the result card that opened it.
    <div onClick={(e) => e.stopPropagation()}>
      <div
        className="fixed inset-0 z-[1050] bg-black/25"
        onClick={onClose}
        onTouchEnd={(e) => { e.preventDefault(); onClose() }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="place-sheet-title"
        tabIndex={-1}
        className="fixed right-0 top-0 z-[1051] h-full w-[520px] max-w-full bg-canvas shadow-2xl flex flex-col safe-area-inset-bottom focus:outline-none"
      >
        <div className="flex-1 overflow-y-auto">
          <PlaceDetailView
            place={place}
            mode="expert"
            titleId="place-sheet-title"
            filters={judgmentFilters}
            onOpenFilters={onOpenFilters ? () => { onClose(); onOpenFilters() } : undefined}
            onBeforeReport={onClose}
            topStart={isMobile && (
              <button type="button" onClick={onClose} className={HERO_PILL}>
                <ChevronLeft className="w-4 h-4" aria-hidden />
                {t.simple.back}
              </button>
            )}
            topEnd={!isMobile && (
              <button type="button" onClick={onClose} aria-label={t.common.close} className={HERO_ICON}>
                <X className="w-4 h-4" aria-hidden />
              </button>
            )}
          />
        </div>
      </div>
    </div>
  )
}
