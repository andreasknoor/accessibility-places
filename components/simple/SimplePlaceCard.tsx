"use client"

import { ChevronRight, MapPin } from "lucide-react"
import { CRITERION_STYLES } from "@/components/results/CriterionBox"
import NavigateButton from "@/components/ui/navigate-button"
import { CATEGORY_ICONS } from "@/lib/category-icons"
import { useTranslations } from "@/lib/i18n"
import { criterionSentence, CRITERION_DOT_CLASS, SIMPLE_TOILET_REQUIRED_CATEGORIES } from "@/lib/simple-view"
import { cn } from "@/lib/utils"
import type { Place } from "@/lib/types"

interface Props {
  place:      Place
  distanceM?: number
  isSelected?: boolean
  onOpen:     () => void
  // Highlights (pans/zooms to + opens the popup of) this place's marker on
  // the map, without opening the detail screen — mirrors PlaceCard's own
  // separate map-pin button. Only rendered when a map is actually showing
  // alongside the list (the results screen's hybrid split); undefined
  // elsewhere (e.g. a future list-only surface) simply omits the button.
  onShowOnMap?: () => void
}

// Reduced result card for Simple View (Variante B): name + distance + ONE
// plain-language line (entrance only — the criterion most people ask "can I
// even get in?" first) + a single "navigate there" action. Everything else
// PlaceCard shows (source badges, dog/veg icons, seating, expand/collapse,
// website/phone/wheelmap/Google-Maps links) lives one tap away in
// SimpleDetail — this card's whole point is to not need a decision here.
//
// The "open detail" tap target is a framed box holding only non-interactive
// content (name/distance/entrance line) — mirroring PlaceCard's own
// documented convention (v9.67) of never nesting another interactive control
// inside a role="button" box. NavigateButton sits OUTSIDE it as a sibling.
export default function SimplePlaceCard({ place, distanceM, isSelected, onOpen, onShowOnMap }: Props) {
  const t = useTranslations()
  const entrance = place.accessibility.entrance.value
  const style = CRITERION_STYLES[entrance]
  // Toilet line, only for categories where Simple View's search already
  // requires a wheelchair toilet (a hard "yes") on top of entrance — showing
  // this line only there keeps it meaningful: since HomeClient's post-filter
  // already excludes anything but "yes" for these categories, the value here
  // is always "yes" in practice, but rendering it explicitly (rather than
  // silently relying on the filter) mirrors the entrance line's own honesty
  // and matches what was asked: toilet info "analog zum Eingang" for these
  // three categories specifically.
  const showToilet = SIMPLE_TOILET_REQUIRED_CATEGORIES.has(place.category)
  const toilet = place.accessibility.toilet.value
  const toiletStyle = CRITERION_STYLES[toilet]

  return (
    <div className={cn(
      "rounded-xl border bg-card px-3.5 py-3 flex flex-col gap-2 transition-colors",
      isSelected ? "border-primary ring-1 ring-primary" : "border-card-border",
    )}>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen() } }}
        aria-label={t.results.openDetails(place.name)}
        className="flex flex-col gap-2 rounded-lg -m-1 p-1 cursor-pointer hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start gap-2">
          <span className="text-lg shrink-0 mt-0.5" aria-hidden>{CATEGORY_ICONS[place.category] ?? "📍"}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm leading-snug line-clamp-2 break-words">{place.name}</p>
          </div>
          {distanceM !== undefined && (
            <span className="text-xs text-muted-foreground shrink-0 mt-0.5">{t.results.distanceShort(Math.round(distanceM))}</span>
          )}
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 self-start mt-0.5" aria-hidden />
        </div>
        <p className={cn("text-xs flex items-center gap-1.5 pl-7", style.color)}>
          <span className={cn("w-2 h-2 rounded-full shrink-0", CRITERION_DOT_CLASS[entrance])} aria-hidden />
          {criterionSentence(t, "entrance", entrance)}
        </p>
        {showToilet && (
          <p className={cn("text-xs flex items-center gap-1.5 pl-7", toiletStyle.color)}>
            <span className={cn("w-2 h-2 rounded-full shrink-0", CRITERION_DOT_CLASS[toilet])} aria-hidden />
            {criterionSentence(t, "toilet", toilet)}
          </p>
        )}
      </div>
      <div className="pl-7 flex items-center gap-2">
        <NavigateButton coords={place.coordinates} variant="labeled" />
        {onShowOnMap && (
          <button
            onClick={onShowOnMap}
            aria-label={t.results.showOnMap}
            title={t.results.showOnMap}
            className="flex items-center gap-1 text-xs text-primary bg-primary/10 hover:bg-primary/20 transition-colors rounded-full px-2.5 py-1"
          >
            <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden />
            {t.results.showOnMap}
          </button>
        )}
      </div>
    </div>
  )
}
