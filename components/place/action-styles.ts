// Shared button styles for the unified place UI (result card action row,
// detail view action bar) — docs/plans/unified-results-detail-popup-redesign.md.
//
// Emphasis rule: filled blue marks the surface's one default action. "Route"
// (start navigation) leaves the app for another one and is therefore never
// the default in-app — the only exceptions are the parking/WC map popups
// (lib/map/popup-content.ts) and the amenity result card, whose sole purpose
// is getting there.
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"

export const ACTION_BASE =
  `flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[13px] font-semibold whitespace-nowrap transition-colors ${FOCUS}`

export const ACTION_PRIMARY   = `${ACTION_BASE} bg-primary text-primary-foreground hover:bg-primary/90`
export const ACTION_SECONDARY = `${ACTION_BASE} bg-primary/10 text-primary-strong hover:bg-primary/15`

// Detail view action bar: equal tiles, none emphasised (no default action).
export const ACTION_TILE =
  `flex flex-col items-center justify-center gap-1 min-h-[64px] rounded-2xl bg-card shadow-card px-1 py-2 text-xs font-semibold text-primary-strong hover:bg-muted transition-colors ${FOCUS}`
export const ACTION_TILE_DISABLED =
  "flex flex-col items-center justify-center gap-1 min-h-[64px] rounded-2xl bg-card/60 px-1 py-2 text-xs font-semibold text-muted-foreground/60"
