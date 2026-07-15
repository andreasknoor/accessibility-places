"use client"

import { Navigation } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from "@/components/ui/popover"
import { useTranslations } from "@/lib/i18n"
import { getPlatform, track } from "@/lib/analytics"
import { startDefaultNavigation, startNavigationWithApp, shouldShowChooser, type NavCoords } from "@/lib/native/navigation"
import { cn } from "@/lib/utils"

interface Props {
  coords: NavCoords
  // "sticky"  — full-width primary button (PlaceDebugSheet footer, Placement 3).
  // "icon"    — small icon-only button matching PlaceCard's existing footer
  //             link row (website/phone/wheelmap). Deliberately the lucide
  //             `Navigation` compass glyph, never `Map`/pin-style — that shape
  //             is already used by the existing Google-Maps-search link right
  //             next to it, and a second pin-like icon would be indistinguishable
  //             from it (see docs/plans/native-navigate-here.md, Placement 1).
  // "labeled" — pill button with icon + text (AmenityCard footer, which has no
  //             detail sheet to host a "sticky" variant instead).
  variant: "sticky" | "icon" | "labeled"
  className?: string
}

// "sticky" is deliberately NOT a filled bg-primary button — this app uses
// filled blue specifically for "this executes now, in the app" (see the
// search row's nearby-search button); navigate-here always exits the app, so
// giving it that same treatment miscast it as the sheet's default/primary
// action instead of one option among several (accessibility details being
// the sheet's actual purpose). Neutral surface, same tier as the close
// button below it — only the icon keeps a primary tint as a quiet hint.
const TRIGGER_CLASS: Record<Props["variant"], string> = {
  sticky:  "flex items-center justify-center gap-2 w-full rounded-lg bg-muted text-foreground border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted/70 transition-colors",
  labeled: "flex items-center gap-1 text-xs text-primary-foreground bg-primary hover:bg-primary/90 transition-colors rounded-full px-2.5 py-1 shadow-sm",
  icon:    "p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors",
}
const ICON_CLASS: Record<Props["variant"], string> = {
  sticky:  "w-4 h-4 shrink-0 text-primary",
  labeled: "w-[1.1rem] h-[1.1rem] shrink-0",
  icon:    "w-[1.1rem] h-[1.1rem]",
}

// Shared "start navigation" trigger + Android-only in-app chooser popover.
// Reduced-scope Variant C (docs/plans/native-navigate-here.md): the popover
// only ever renders on Android (Google Maps vs. the OS's own "open with"
// chooser via a generic geo: URI) — iOS and any non-native context (desktop
// browser, mobile browser/PWA) trigger startDefaultNavigation() directly with
// no chooser step, since there is only one meaningful outcome there.
export default function NavigateButton({ coords, variant, className }: Props) {
  const t = useTranslations()
  const platform = getPlatform()
  const showChooser = shouldShowChooser(platform)

  function fireDefault(e: React.MouseEvent) {
    e.stopPropagation()
    track("navigate_here", { platform, variant })
    startDefaultNavigation(coords)
  }

  function fireApp(app: "google" | "geo") {
    track("navigate_here", { platform, variant, app })
    startNavigationWithApp(app, coords)
  }

  // Built once regardless of showChooser — the two branches previously
  // rendered near-identical <button> markup independently, which could
  // silently drift (aria-label/title logic is accessibility-relevant, not
  // just styling). onClick differs per branch: the no-chooser path fires
  // navigation directly, the chooser path only needs to stop the click from
  // bubbling to an ancestor's own handler (e.g. PlaceCard's "open details")
  // — Radix's Popover already handles the actual open-toggle.
  const trigger = (
    <button
      type="button"
      onClick={showChooser ? (e) => e.stopPropagation() : fireDefault}
      aria-label={t.results.navigateHere}
      title={variant === "icon" ? t.results.navigateHere : undefined}
      className={cn(TRIGGER_CLASS[variant], className)}
    >
      <Navigation className={ICON_CLASS[variant]} aria-hidden />
      {variant !== "icon" && t.results.navigateHere}
    </button>
  )

  if (!showChooser) return trigger

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* z-[1100]: PopoverContent's own default (z-50, components/ui/popover.tsx)
          sits below PlaceDebugSheet's overlay (z-[1050]/z-[1051]) — since the
          "sticky" variant renders inside that sheet, the portalled popover
          content would otherwise paint invisibly underneath it. 1100 clears
          every fixed-overlay z-index in the app (highest existing is
          bottom-sheet.tsx's z-[1061]) with headroom. cn() in popover.tsx
          resolves this via tailwind-merge, so it reliably overrides the
          component's own z-50 rather than depending on CSS declaration order. */}
      <PopoverContent className="w-56 p-1 z-[1100]" align="start" onClick={(e) => e.stopPropagation()}>
        <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t.results.navigateWith}
        </p>
        <PopoverClose asChild>
          <button
            type="button"
            onClick={() => fireApp("google")}
            className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium hover:bg-muted transition-colors text-left"
          >
            <Navigation className="w-4 h-4 text-primary shrink-0" aria-hidden />
            {t.results.navigateGoogleMaps}
          </button>
        </PopoverClose>
        <PopoverClose asChild>
          <button
            type="button"
            onClick={() => fireApp("geo")}
            className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium hover:bg-muted transition-colors text-left"
          >
            <Navigation className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
            {t.results.navigateOtherApp}
          </button>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  )
}
