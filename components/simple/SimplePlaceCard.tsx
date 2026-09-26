"use client"

import { MapPin } from "lucide-react"
import CriterionItem from "@/components/place/CriterionItem"
import { ACTION_PRIMARY, ACTION_SECONDARY } from "@/components/place/action-styles"
import NavigateButton from "@/components/ui/navigate-button"
import { CATEGORY_ICONS } from "@/lib/category-icons"
import { useTranslations } from "@/lib/i18n"
import { SIMPLE_TOILET_REQUIRED_CATEGORIES } from "@/lib/simple-view"
import { cn } from "@/lib/utils"
import type { Place } from "@/lib/types"

interface Props {
  place:      Place
  distanceM?: number
  isSelected?: boolean
  onOpen:     () => void
  // Highlights (pans/zooms to + opens the popup of) this place's marker on
  // the map, without opening the detail screen. Only rendered when a map is
  // actually showing alongside the list (the results screen's hybrid split).
  onShowOnMap?: () => void
}

// Quickstart result card — "V1+" of the unified place UI
// (see CLAUDE.md): name, category ·
// distance, one plain-language sentence per shown criterion (entrance, plus
// toilet for the categories where Quickstart requires it), and an action row.
//
// Tap targets: the whole card opens the detail screen as a pointer-only
// convenience (a plain div click handler, no role — it is redundant for
// keyboard/AT users), while the labelled "Details" button is the real,
// focusable control. The action buttons stop propagation, so there is never a
// nested interactive element and every action does exactly one thing.
//
// Default action (filled blue) is "Zur Karte"; "Route" leaves the app and is
// never the default (see components/place/action-styles.ts).
export default function SimplePlaceCard({ place, distanceM, isSelected, onOpen, onShowOnMap }: Props) {
  const t = useTranslations()
  const showToilet = SIMPLE_TOILET_REQUIRED_CATEGORIES.has(place.category)
  const category = (t.categories as Record<string, string>)[place.category] ?? place.category

  return (
    <div
      onClick={onOpen}
      className={cn(
        "rounded-2xl bg-card shadow-place cursor-pointer transition-shadow hover:shadow-md",
        isSelected && "ring-2 ring-primary",
      )}
    >
      <div className="px-3.5 pt-3 pb-2.5 flex flex-col gap-0.5">
        <h2 className="text-base font-bold leading-snug tracking-tight line-clamp-2 break-words">{place.name}</h2>
        <p className="text-[13px] text-muted-foreground">
          <span aria-hidden>{CATEGORY_ICONS[place.category] ?? "📍"} </span>
          {category}
          {distanceM !== undefined && <> · {t.results.distanceShort(Math.round(distanceM))}</>}
        </p>
        <div className="flex flex-col gap-2 mt-2.5">
          <CriterionItem kind="entrance" attr={place.accessibility.entrance} variant="sentence" />
          {showToilet && <CriterionItem kind="toilet" attr={place.accessibility.toilet} variant="sentence" />}
        </div>
      </div>
      <div className="flex gap-2 px-3.5 pb-3">
        {onShowOnMap && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onShowOnMap() }}
            className={ACTION_PRIMARY}
          >
            <MapPin className="w-4 h-4 shrink-0" aria-hidden />
            {t.results.showOnMap}
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen() }}
          aria-label={t.results.openDetails(place.name)}
          className={ACTION_SECONDARY}
        >
          {t.place.details}
        </button>
        <NavigateButton coords={place.coordinates} variant="action" />
      </div>
    </div>
  )
}
