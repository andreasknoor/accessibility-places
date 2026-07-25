"use client"

import { CirclePlay, Gauge } from "lucide-react"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

// Header control that switches between Quickstart Mode and Turbo Mode — see
// docs/plans/quickstart-mode-default.md (Phase 1). Takes the header slot
// LanguageSwitcher used to occupy in MobileLayout, SimpleLayout's shared
// Header, SimpleDetail and the desktop header — language moved into the
// settings sheet instead.
//
// Always shows the glyph/colour of the mode a tap would switch TO, never the
// current one: Turbo's headers show the blue Quickstart play-circle, and
// Quickstart's headers show the orange Turbo gauge. Deliberately NOT rendered
// on Quickstart's own start screen (SimpleLayout.tsx) — that screen already
// carries the full "Turbo-Modus an" pill, a labelled button with a subline
// doing exactly this, so a second bare icon on the same screen would just be
// the same switch twice. That screen still gets the gear, so settings (and
// the language switcher inside them) stay reachable from every screen.
export default function ModeSwitcher({ mode, onSwitch }: { mode: "quickstart" | "turbo"; onSwitch: () => void }) {
  const t = useTranslations()
  const target = mode === "turbo" ? "quickstart" : "turbo"
  const Icon = target === "quickstart" ? CirclePlay : Gauge
  const label = target === "quickstart" ? t.modeSwitcher.switchToQuickstart : t.modeSwitcher.switchToTurbo

  return (
    <button
      onClick={onSwitch}
      aria-label={label}
      title={label}
      className={cn(
        "p-1.5 rounded-md transition-colors",
        target === "quickstart"
          ? "text-primary hover:bg-primary/10"
          : "text-amber-600 hover:bg-amber-50",
      )}
    >
      <Icon className="w-4 h-4" />
    </button>
  )
}
