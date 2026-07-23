"use client"

import { ChevronLeft, Globe, Phone, Settings as SettingsIcon } from "lucide-react"
import { NativeLink } from "@/components/ui/native-link"
import LanguageSwitcher from "@/components/LanguageSwitcher"
import NavigateButton from "@/components/ui/navigate-button"
import { NotAccessibleWarningBox } from "@/components/results/NotAccessibleWarning"
import ConfidenceBadge from "@/components/results/ConfidenceBadge"
import { CATEGORY_ICONS } from "@/lib/category-icons"
import { useTranslations } from "@/lib/i18n"
import { placeMayNotBeAccessible } from "@/lib/matching/merge"
import { criterionSentence, CRITERION_DOT_CLASS } from "@/lib/simple-view"
import type { Place } from "@/lib/types"

interface Props {
  place:      Place
  distanceM?: number
  onBack:     () => void
  // The return path to the full UI (the settings toggle) must be reachable
  // from every screen, not just the start screen — see SimpleLayout's Header.
  onOpenSettings: () => void
}

function CriterionRow({ label, dot }: { label: string; dot: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-b-0">
      <span className={`w-3 h-3 rounded-full shrink-0 ${dot}`} aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  )
}

// Reduced detail screen for Simple View (Variante B) — a full screen (not a
// portal sheet like PlaceDebugSheet), reached by tapping a SimplePlaceCard.
// Deliberately omits: quellenliste, score-formel, rohdaten, link kopieren,
// verified/dog/veggie badges — see the Rein/Raus table in the plan. Kept:
// name, distance, address, the 3 core criteria as plain sentences, call,
// website, "Hinbringen".
export default function SimpleDetail({ place, distanceM, onBack, onOpenSettings }: Props) {
  const t = useTranslations()
  const addr = [place.address.street, place.address.houseNumber, place.address.city]
    .filter(Boolean).join(" ")

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* pt-safe-3, not pt-3 — same notch/status-bar clipping fix as
          SimpleLayout's shared Header (this screen has its own separate top
          row instead of reusing that component). */}
      <div className="flex items-center gap-1 px-3 pt-safe-3 pb-1 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm font-medium text-primary py-1.5 pr-2 -ml-1"
        >
          <ChevronLeft className="w-4 h-4" />
          {t.simple.back}
        </button>
        <span className="flex-1" />
        <LanguageSwitcher />
        <button
          onClick={onOpenSettings}
          aria-label={t.settings.title}
          className="p-1.5 -mr-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-md"
        >
          <SettingsIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 pb-6 flex flex-col gap-4">
        <div className="flex items-start gap-2.5">
          <span className="text-2xl shrink-0" aria-hidden>{CATEGORY_ICONS[place.category] ?? "📍"}</span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-snug break-words">{place.name}</h2>
            {addr && <p className="text-sm text-muted-foreground mt-0.5">{addr}</p>}
            {distanceM !== undefined && (
              <p className="text-sm text-muted-foreground">{t.results.distanceFromHere(Math.round(distanceM))}</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border px-3">
          <CriterionRow label={criterionSentence(t, "entrance", place.accessibility.entrance.value)} dot={CRITERION_DOT_CLASS[place.accessibility.entrance.value]} />
          <CriterionRow label={criterionSentence(t, "toilet", place.accessibility.toilet.value)} dot={CRITERION_DOT_CLASS[place.accessibility.toilet.value]} />
          <CriterionRow label={criterionSentence(t, "parking", place.accessibility.parking.value)} dot={CRITERION_DOT_CLASS[place.accessibility.parking.value]} />
        </div>

        {/* The plain badge only (no `place` prop) — deliberately skips the
            interactive score-formula breakdown ConfidenceBadge otherwise offers
            (tooltip on desktop, tap-through on mobile), matching this screen's
            existing "no score formula" scope cut (see the component comment
            above). Still shows the % and Verlässlich/Mittel/Unsicher label the
            user asked for, just as a static fact rather than an interactive one. */}
        <ConfidenceBadge confidence={place.overallConfidence} className="self-start" />

        {/* Same trigger (placeMayNotBeAccessible: entrance/toilet "no"/"unknown")
            and unconditional (not toggle-gated) rendering as PlaceDebugSheet's
            own use of this box — the full UI's detail sheet, which SimpleDetail
            otherwise mirrors as a reduced version of. */}
        {placeMayNotBeAccessible(place) && <NotAccessibleWarningBox />}

        <div className="flex flex-col gap-2">
          <NavigateButton coords={place.coordinates} variant="sticky" />
          <div className="flex gap-2">
            {place.phone && (
              <a
                href={`tel:${place.phone}`}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                <Phone className="w-4 h-4 shrink-0" aria-hidden />
                {t.simple.call}
              </a>
            )}
            {place.website && (
              <NativeLink
                href={place.website}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
              >
                <Globe className="w-4 h-4 shrink-0" aria-hidden />
                {t.results.websiteLink}
              </NativeLink>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
