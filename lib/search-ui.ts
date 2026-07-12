// Pure decision helpers for the venue-vs-amenity search UI (issue #30 follow-up).
//
// These were extracted out of ad-hoc ternaries inline in HomeClient/ResultsList,
// which is exactly how the "rerun/expand-radius resurrects a stale venue search
// during an active amenity search" bug class happened — the wiring decision had
// no single, named, testable place. Keep new wiring decisions here, not as inline
// JSX ternaries.

import type { AmenityType } from "@/lib/types"
import { RADIUS_MIN_KM, RADIUS_MAX_KM } from "@/lib/config"

export interface ViewportOrigin {
  center: { lat: number; lon: number }
  radiusKm: number
}

export function clampVenueRadiusKm(km: number): number {
  return Math.min(Math.max(km, RADIUS_MIN_KM), RADIUS_MAX_KM)
}

// Like snapAmenityRadiusKm but for the venue domain (1–50 km): the viewport radius
// arrives as a raw centre→corner float with ~10 decimals, and the viewport-origin
// chip writes it back to the FilterPanel slider — so snap to one decimal first or
// the slider shows e.g. "12.3478234123 km".
export function snapVenueRadiusKm(km: number): number {
  return clampVenueRadiusKm(Math.round(km * 10) / 10)
}

// Resolve the live map viewport into a venue/amenity search origin, used by the
// category + amenity chips so that — after the user has panned the map — the next
// chip search refers to the visible area rather than the stale previous origin.
//
// The cold-map gate is NOT re-implemented here: MapView only reports a non-null
// viewport once a real search/GPS fix has positioned the map (its moveend handler
// requires searchCenterRef), and reports null on the default overview, after a
// search recentres, and in focus mode. So a null report means "no eligible
// viewport" and the caller falls through to its existing origin chain (typed
// location, GPS fix, activeSearchCoords, …). These helpers only clamp the raw
// centre→corner radius into the right domain (venue 1–50 km, amenity 0.05–5 km).
export function venueViewportOrigin(v: ViewportOrigin | null | undefined): ViewportOrigin | null {
  if (!v) return null
  return { center: v.center, radiusKm: snapVenueRadiusKm(v.radiusKm) }
}

export function amenityViewportOrigin(v: ViewportOrigin | null | undefined): ViewportOrigin | null {
  if (!v) return null
  return { center: v.center, radiusKm: snapAmenityRadiusKm(v.radiusKm) }
}

// Stable identity for an amenity spot, shared by the map markers and the result
// list so a marker click can highlight the matching card (and vice-versa). OSM
// id when present; otherwise coordinates — two distinct spots never share both.
// Both sides MUST derive selection from this, never from the list render index
// (which the map has no knowledge of).
export function amenitySpotKey(spot: { osmId?: string; lat: number; lon: number }): string {
  return spot.osmId ?? `${spot.lat},${spot.lon}`
}

export const AMENITY_RADIUS_MIN_KM = 0.05
// Matches the /api/nearby-parking server cap (RADIUS_MAX_KM = 25), which was
// raised precisely so "search this area" can cover a zoomed-out map viewport —
// the old 5 km client clamp silently cut that capability off again. The
// AppSettings start radius (parkingRadiusKm) keeps its own smaller 0.05–5
// range; this bound governs the live slider and viewport-derived searches.
export const AMENITY_RADIUS_MAX_KM = 25.0

export function clampAmenityRadiusKm(km: number): number {
  return Math.min(Math.max(km, AMENITY_RADIUS_MIN_KM), AMENITY_RADIUS_MAX_KM)
}

// The "search this area" radius is derived from the live map viewport
// (centre→corner distance), so it arrives as an arbitrary float with many
// decimals. Snap it to 0.1 km before it reaches the radius display/slider — full
// kilometres would round a zoomed-in sub-km view down to ~0. The slider's own
// 0.05-km steps are left untouched (only this viewport path needs snapping).
export function snapAmenityRadiusKm(km: number): number {
  return clampAmenityRadiusKm(Math.round(km * 10) / 10)
}

interface RerunArgs {
  amenityActive: boolean
  amenitySearch: AmenityType | null
  amenitySearchCenter: { lat: number; lon: number } | undefined
  chatMode: "text" | "nearby"
  lastQuery: string | undefined
}

// Which search should "Rerun" / "Neu laden" repeat: the active amenity search
// takes priority over any leftover venue query from earlier in the session — a
// venue search never resurfaces while an amenity search is showing.
export function rerunTarget(args: RerunArgs): "amenity" | "venue" | "none" {
  if (args.amenityActive && args.amenitySearch && args.amenitySearchCenter) return "amenity"
  if (!args.amenityActive && args.chatMode === "nearby" && args.lastQuery) return "venue"
  return "none"
}

interface ExpandRadiusArgs {
  amenityActive: boolean
  amenitySearch: AmenityType | null
  amenitySearchCenter: { lat: number; lon: number } | undefined
  amenityRadiusKm: number
  lastQuery: string | undefined
  radiusKm: number
}

// Same priority rule for "Suchradius erweitern": never offers to expand (or
// silently re-run) a stale venue search while an amenity search is active, and is
// available for a first-ever amenity search with no prior venue query at all.
export function expandRadiusTarget(args: ExpandRadiusArgs): "amenity" | "venue" | "none" {
  if (args.amenityActive && args.amenitySearch && args.amenitySearchCenter && args.amenityRadiusKm < AMENITY_RADIUS_MAX_KM) {
    return "amenity"
  }
  if (!args.amenityActive && args.lastQuery && args.radiusKm < RADIUS_MAX_KM) return "venue"
  return "none"
}

// The ResultsList header radius control (km-preset popover, 1-50km) only makes
// sense for venue searches; amenity mode adjusts radius exclusively via
// FilterPanel's dedicated small-scale slider, avoiding two controls fighting
// over (and desyncing) the same radius value.
export function canShowResultsRadiusPicker(amenityActive: boolean): boolean {
  return !amenityActive
}

// ─── Radius presets + formatting (shared by RadiusPresetPopover call sites) ──

export const RADIUS_PRESETS_KM = [1, 2, 5, 10, 25, 50] as const
// 4 km is kept in the list even though it's a slightly odd step — it's the
// persisted AppSettings.parkingRadiusKm default, so a first-time popover open
// highlights an active preset instead of showing none selected.
export const AMENITY_RADIUS_PRESETS_KM = [0.1, 0.25, 0.5, 1, 2, 3, 4, 5] as const

// "5 km" / "500 m" — same convention as FilterPanel's own (separate, not
// deduplicated here to keep this change's blast radius small) formatRadius.
export function formatRadiusKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km} km`
}

// Which presets + commit handler the always-visible header radius pill
// (MobileLayout) should use. Unlike ResultsList's picker — venue-only, see
// canShowResultsRadiusPicker above — the header pill DOES stay interactive
// during an amenity search: both this and FilterPanel's amenity slider
// ultimately call the exact same commit handler (handleAmenityRadiusCommit in
// HomeClient), so there is exactly one source of truth in either domain — no
// new "two controls desync one value" risk (the thing canShowResultsRadiusPicker
// was originally guarding against was a *domain* mix-up, not a second control).
export function headerRadiusControl(args: {
  amenityActive:    boolean
  onRadiusChange?:  (km: number) => void
  onAmenityRadius?: (km: number) => void
}): { presets: readonly number[]; onChange?: (km: number) => void } {
  return args.amenityActive
    ? { presets: AMENITY_RADIUS_PRESETS_KM, onChange: args.onAmenityRadius }
    : { presets: RADIUS_PRESETS_KM,         onChange: args.onRadiusChange }
}
