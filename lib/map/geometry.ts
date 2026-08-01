import { haversineMetres } from "@/lib/matching/match"

// Extracted from components/map/MapView.tsx (Leaflet) as part of the MapLibre
// migration prep (issue #48, Phase 0 step 2) — pulling the pure decision logic
// out before the map library underneath it changes, so both implementations
// can share and be checked against the same tested behaviour.

// ─── Popup overflow guard (issue #43) ─────────────────────────────────────
// At high Android display/font scaling, popup content can grow tall enough
// that a naive popup can't keep both the top and bottom edges on screen.
// popupMaxHeight() derives a cap from the *current* map size instead of a
// guessed constant, so it still leaves map context visible on small devices
// and doesn't clip unnecessarily on large ones.
//
// The 160px floor is deliberately clamped against the map's OWN height too
// (verified live): Simple View's map/list split is freely resizable down to
// SPLIT_PANE_MIN_PX=90px, and the map container clips anything taller than
// itself — a popup allowed to grow past the container isn't merely "needs
// scrolling", the overflow is clipped by an ANCESTOR, not the popup's own
// scrollable region, so it becomes genuinely unreachable. Reserving ~40px
// leaves room for the popup's own tip/arrow and a sliver of visible map
// context underneath.
export function popupMaxHeight(mapHeightPx: number): number {
  const cap = Math.max(160, Math.round(mapHeightPx * 0.55))
  const containerLimit = Math.max(60, mapHeightPx - 40)
  return Math.min(cap, containerLimit)
}

// ─── Programmatic-move vs. user-pan discrimination ────────────────────────
// "Search here" / "Hier suchen" must only appear after a genuine user drag,
// never after an app-driven pan (setView/fitBounds/zoomToShowLayer-equivalent
// recentring). A move event firing within this window after a programmatic
// move is treated as app-driven and ignored; any later move must be a real
// user pan. Self-healing: a programmatic move that fires 0, 1, or N move
// events is handled the same way, since only the timestamp is checked.
export const PROGRAMMATIC_MOVE_WINDOW_MS = 700

export function isWithinProgrammaticMoveWindow(lastProgrammaticMoveTs: number, now: number): boolean {
  return now - lastProgrammaticMoveTs < PROGRAMMATIC_MOVE_WINDOW_MS
}

// ─── Viewport radius ───────────────────────────────────────────────────────
// The radius (km) of a circle from the map centre to a viewport corner —
// used to size "search here" / "search this area" queries to exactly what's
// visible on screen. Library-agnostic: callers pass plain {lat,lon} for the
// centre and any bounds corner (Leaflet's LatLng and MapLibre's LngLat both
// destructure to this shape).
export function viewportRadiusKm(center: { lat: number; lon: number }, corner: { lat: number; lon: number }): number {
  return haversineMetres(center, corner) / 1000
}
