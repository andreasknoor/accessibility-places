"use client"

import { ChevronLeft, Settings as SettingsIcon } from "lucide-react"
import ModeSwitcher from "@/components/ModeSwitcher"
import PlaceDetailView from "@/components/place/PlaceDetailView"
import { HERO_ICON, HERO_ICON_SHELL, HERO_PILL } from "@/components/place/action-styles"
import { useTranslations } from "@/lib/i18n"
import type { Place } from "@/lib/types"

interface Props {
  place:      Place
  distanceM?: number
  onBack:     () => void
  // The return path to the full UI (the settings toggle) must be reachable
  // from every screen, not just the start screen — see SimpleLayout's Header.
  onOpenSettings: () => void
  // Same one-tap mode switcher as SimpleLayout's shared Header — this screen
  // has its own top row (floating on the hero), so it needs its own wiring.
  onSwitchToExpert: () => void
}

// Quickstart detail screen: a full screen (not a portal sheet like
// PlaceDebugSheet) around the shared PlaceDetailView in "quickstart" mode —
// the same layout Expert Mode's sheet uses, minus the Expert-only cards
// (docs/plans/unified-results-detail-popup-redesign.md, "Detail V2").
export default function SimpleDetail({ place, distanceM, onBack, onOpenSettings, onSwitchToExpert }: Props) {
  const t = useTranslations()
  return (
    <div className="flex flex-col h-full overflow-y-auto bg-canvas">
      <PlaceDetailView
        place={place}
        mode="quickstart"
        headingLevel={1}
        distanceM={distanceM}
        topStart={
          <button type="button" onClick={onBack} className={HERO_PILL}>
            <ChevronLeft className="w-4 h-4" aria-hidden />
            {t.simple.back}
          </button>
        }
        topEnd={
          <>
            <ModeSwitcher mode="quickstart" onSwitch={onSwitchToExpert} className={HERO_ICON_SHELL} />
            <button type="button" onClick={onOpenSettings} aria-label={t.settings.title} className={HERO_ICON}>
              <SettingsIcon className="w-4 h-4" aria-hidden />
            </button>
          </>
        }
      />
    </div>
  )
}
