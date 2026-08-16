"use client"

import { Sparkles, GraduationCap } from "lucide-react"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

// Header control that switches between Quickstart Mode and Expert Mode — see
// docs/plans/quickstart-mode-default.md (Phase 1). Takes the header slot
// LanguageSwitcher used to occupy in MobileLayout, SimpleLayout's shared
// Header, SimpleDetail and the desktop header — language moved into the
// settings sheet instead.
//
// Always shows the glyph/colour of the mode a tap would switch TO, never the
// current one: Expert's headers show the blue Quickstart sparkles, and
// Quickstart's headers show the orange Expert cap. Sparkles (not the
// original CirclePlay) — a mobile Expert header sits directly above the map,
// where a circle-with-triangle read as a third zoom control rather than a
// mode switch (found + prototyped in docs/wcag-quickstart-mode-audit.md's
// icon-follow-up; a Compass alternative was also considered but rejected —
// too close to "start navigation" in this app specifically). GraduationCap
// replaced Rocket in v12.14 when the mode itself was renamed Turbo → Expert:
// a rocket read as speed, which this mode was never about, and the shape
// stays unambiguous down to 12px (the identity-label size) — see the
// icon-comparison prototype from that rename for the alternatives ruled out.
// Deliberately NOT rendered on Quickstart's own start screen
// (SimpleLayout.tsx) — that screen already carries the full "Experten-Modus
// an" pill, a labelled button with a subline doing exactly this, so a second
// bare icon on the same screen would just be the same switch twice. That
// screen still gets the gear, so settings (and the language switcher inside
// them) stay reachable from every screen.
export default function ModeSwitcher({ mode, onSwitch }: { mode: "quickstart" | "expert"; onSwitch: () => void }) {
  const t = useTranslations()
  const target = mode === "expert" ? "quickstart" : "expert"
  const Icon = target === "quickstart" ? Sparkles : GraduationCap
  const label = target === "quickstart" ? t.modeSwitcher.switchToQuickstart : t.modeSwitcher.switchToExpert

  return (
    <button
      onClick={onSwitch}
      aria-label={label}
      title={label}
      className={cn(
        "p-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        target === "quickstart"
          ? "text-primary hover:bg-primary/10"
          // A named design token, not a hardcoded Tailwind colour — see
          // --simple-expert's comment in app/globals.css.
          : "text-simple-expert hover:bg-simple-expert/10",
      )}
    >
      <Icon className="w-4 h-4" />
    </button>
  )
}
