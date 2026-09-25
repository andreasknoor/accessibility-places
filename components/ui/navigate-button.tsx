"use client"

import { ArrowUpRight, Navigation } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from "@/components/ui/popover"
import { useTranslations } from "@/lib/i18n"
import { getPlatform, track } from "@/lib/analytics"
import { startDefaultNavigation, startNavigationWithApp, shouldShowChooser, type NavCoords } from "@/lib/native/navigation"
import { ACTION_PRIMARY, ACTION_SECONDARY, ACTION_TILE } from "@/components/place/action-styles"
import { cn } from "@/lib/utils"

interface Props {
  coords: NavCoords
  // "labeled" — filled pill with icon + full text (AmenityCard footer: the
  //             parking/WC result card's default action — getting there is
  //             its whole purpose).
  // "action"  — result-card action row button ("Route"), styled by `emphasis`.
  // "tile"    — detail-view action bar tile (never emphasised: the detail view
  //             has no default action).
  // Always the lucide `Navigation` compass glyph, never a map/pin shape (that
  // reads as "show on map", docs/plans/native-navigate-here.md).
  variant: "labeled" | "action" | "tile"
  // Only for "action". Navigation leaves the app, so it is "secondary" unless
  // a surface deliberately makes it its default (see action-styles.ts).
  emphasis?: "primary" | "secondary"
  className?: string
}

const TRIGGER_CLASS: Record<Exclude<Props["variant"], "action">, string> = {
  tile:    ACTION_TILE,
  labeled: "flex items-center gap-1 text-xs text-primary-foreground bg-primary hover:bg-primary/90 transition-colors rounded-full px-2.5 py-1 shadow-sm",
}
const ICON_CLASS: Record<Props["variant"], string> = {
  action:  "w-4 h-4 shrink-0",
  tile:    "w-5 h-5 shrink-0",
  labeled: "w-[1.1rem] h-[1.1rem] shrink-0",
}

// Shared "start navigation" trigger + Android-only in-app chooser popover.
// Reduced-scope Variant C (docs/plans/native-navigate-here.md): the popover
// only ever renders on Android (Google Maps vs. the OS's own "open with"
// chooser via a generic geo: URI) — iOS and any non-native context (desktop
// browser, mobile browser/PWA) trigger startDefaultNavigation() directly with
// no chooser step, since there is only one meaningful outcome there.
export default function NavigateButton({ coords, variant, emphasis = "secondary", className }: Props) {
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
  // Short "Route" where space is tight (card row, action tile), the full
  // "Navigation starten" elsewhere. Every variant carries the ↗ "opens
  // another app" indicator, and its accessible name says so in words.
  const short = variant === "action" || variant === "tile"
  const label = short ? t.place.route : t.results.navigateHere
  const triggerClass = variant === "action"
    ? (emphasis === "primary" ? ACTION_PRIMARY : ACTION_SECONDARY)
    : TRIGGER_CLASS[variant]
  const trigger = (
    <button
      type="button"
      onClick={showChooser ? (e) => e.stopPropagation() : fireDefault}
      aria-label={`${t.results.navigateHere} (${t.place.opensExternalApp})`}
      className={cn(triggerClass, className)}
    >
      <Navigation className={ICON_CLASS[variant]} aria-hidden />
      {variant === "tile" ? (
        <span className="inline-flex items-center gap-0.5">{label}<ArrowUpRight className="w-3 h-3 shrink-0" aria-hidden /></span>
      ) : (
        <>{label}<ArrowUpRight className="w-3.5 h-3.5 shrink-0 -ml-0.5" aria-hidden /></>
      )}
    </button>
  )

  if (!showChooser) return trigger

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* z-[1100]: PopoverContent's own default (z-50, components/ui/popover.tsx)
          sits below PlaceDebugSheet's overlay (z-[1050]/z-[1051]) — since the
          "tile" variant renders inside that sheet, the portalled popover
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
