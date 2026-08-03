import type { Place, ParkingSpot, AmenityFeature, AmenityType, SearchFilters } from "@/lib/types"

// Prop contract for MapView.tsx / MapViewGL.tsx (the MapLibre engine adopted
// in the issue #48 migration; the pre-migration Leaflet implementation and
// this file's original dual-engine contract were retired at cutover, v12.0).
export interface MapViewProps {
  places:        Place[]
  // Active venue-search filter criteria (v13, docs/plans/reliability-tiers.md)
  // — drives the pin/popup JUDGEMENT colour (pass/caveat/unknown against
  // these filters), replacing the old confidence-tier colour. Undefined
  // (e.g. during an amenity search, where `places` is empty anyway) degrades
  // to "no active criteria" — every shown pin renders as a neutral pass.
  filters?:      SearchFilters
  parkingSpots?: ParkingSpot[]
  toiletSpots?:  AmenityFeature[]
  center?:       { lat: number; lon: number }
  userLocation?: { lat: number; lon: number }
  selectedId?:   string
  panTrigger?:   number
  onSelect:      (place: Place) => void
  onShowInResults?:    (place: Place) => void
  // Overrides the venue popup's own "Details" chip, which otherwise ALWAYS
  // opens the full PlaceDebugSheet internally (setDetailPlace below) —
  // independent of onShowInResults, which only drives the separate "Zeige in
  // Ergebnissen" chip (and isn't even rendered in the reduced popup variant
  // small map heights fall back to). Simple View's map screens pass this to
  // route straight to their own reduced detail screen instead; omitted, the
  // existing rich-sheet behaviour is unchanged for every other caller.
  onOpenDetails?:      (place: Place) => void
  // Opens the filter view — forwarded to MapViewGL's own internal
  // PlaceDebugSheet instance (opened from a popup's "Details" chip), so its
  // JudgmentLine gets the same "Kriterien" link as the one opened from
  // PlaceCard. See JudgmentLine.tsx's own comment on why only the sheet gets
  // a real link, never the popup or the result card themselves.
  onOpenFilters?:      () => void
  isFullscreen:        boolean
  onToggleFullscreen:  () => void
  showFullscreenToggle?: boolean
  visible?:            boolean
  showParking?:        boolean
  showToilets?:        boolean
  isLoading?:          boolean
  // Called when the user picks a segment in the map-layer control.
  // Replaces the old onToggleParking single-toggle.
  onSetMapLayers?:     (parking: boolean, toilets: boolean) => void
  hasToiletData?:      boolean   // controls whether WC segments are shown
  // Amenity focus mode: when true, hides place markers and shows only the
  // GPS-radius amenity spots (parking and/or WCs). Triggered from the ChatPanel
  // layer chips in nearby mode. The caller decides which layers are active and
  // passes the already-filtered spots — MapView only needs the boolean.
  focusMode?:              boolean
  // Non-null when focus results came from "search this area" (a panned centre,
  // not GPS). Drives whether the focus map-fit includes the GPS dot — when the
  // user searched far away, forcing the dot into view would zoom the map out.
  focusSearchCenter?:      { lat: number; lon: number } | null
  // Called when the user clicks "Search this area" in focus mode. Receives the
  // current map centre and a radius (km) derived from the visible viewport, so the
  // search covers exactly what's on screen. Caller re-fetches the active layers.
  onFocusSearchHere?:      (center: { lat: number; lon: number }, radiusKm: number) => void
  // Whether the weak "accessible" parking tier is enabled — drives the legend
  // (the yellow entry is only relevant when those markers can appear).
  showWeakParking?:        boolean
  // Called when the user pans the map and clicks "Search here". Receives the
  // new map centre; caller should re-run the last search at that location.
  // `origin` distinguishes a genuine drag-pan pill from one armed by the locate
  // button (see searchHereOriginRef below) — the caller uses this to decide
  // whether the resulting search counts as "near me" (distance display, the
  // green location token) or an ordinary panned-area search (neither).
  onSearchHere?:           (center: { lat: number; lon: number }, radiusKm: number, origin: "drag" | "locate") => void
  // When true, MapView does NOT render its own (centred) "search here" button.
  // Instead it reports pan state via onPanned so the parent can render the pill
  // inline next to the result-count pill (mobile). Has no effect in focus mode.
  hideSearchHereButton?:   boolean
  // Reports the "search here" availability up to the parent: a runner to execute
  // the search (pan centre + viewport radius captured at pan time, not click time),
  // or null when no pan is pending. Only fires for the non-focus venue search.
  onPanned?:               (run: (() => void) | null) => void
  // Reports the live viewport as a potential search origin to the parent. Fires
  // with { center, radiusKm } when a real user pan is pending (the same signal
  // that drives the "search here" pill — so the reported origin and the visible
  // pill are always in lockstep), or null otherwise (no pan / focus mode / after
  // a search recentres the map). The parent stores this in a ref and reads it at
  // chip-click time to use the visible area as the search origin. Suppressed in
  // focus mode, which keeps its own "search this area" control — so this never
  // fires during an active amenity search (scope cut: viewport origin applies
  // only when entering venue/amenity searches, not while one is running).
  onViewportChange?:       (v: { center: { lat: number; lon: number }; radiusKm: number } | null) => void
  // Called when the user taps the locate button. Should resolve with GPS coords
  // or reject on permission denial / timeout. MapView tracks loading + error state.
  onLocate?:               () => Promise<void>
  // Incrementing this key triggers MapView to pan to the current userLocation
  // at zoom 16. Stamped as programmatic so "search here" is NOT auto-shown by
  // moveend — instead the button is shown explicitly (Option 2).
  locatePanTrigger?:       number
  // The currently configured search radius (venue or amenity domain, already
  // resolved by the caller — same value shown in the header radius pill). Used
  // to pick the locate-button zoom level so "Hier suchen" after a locate tap
  // covers roughly this radius instead of a fixed ~2 km (issue #37).
  searchRadiusKm?:         number
  // "Zur Karte" from an amenity (parking/WC) result card: pans/zooms to that
  // spot's coordinates and opens its popup. Distinct from selectedId/panTrigger
  // (place markers) since amenity markers aren't tracked in the place cluster.
  // Incrementing the trigger re-fires even when the target coords are unchanged
  // (clicking the same card twice should still re-center).
  amenityPanTarget?:       { lat: number; lon: number } | null
  amenityPanTrigger?:      number
  // Clicking a parking/WC marker selects the matching list card (reverse of
  // amenityPanTarget). Mirrors onSelect for place markers; amenity spots have no
  // stable Place id, so the spot's coords/osmId are passed and keyed via
  // amenitySpotKey on the consumer side. The popup still opens as well.
  onAmenityMarkerClick?:   (spot: { osmId?: string; lat: number; lon: number }) => void
  // The "jump to results" link inside a parking/WC popup (mobile only — mirrors
  // onShowInResults for venue popups): highlights the matching card and switches
  // to the results tab. Only passed on mobile, so the link is absent on desktop.
  onShowAmenityInResults?: (spot: { osmId?: string; lat: number; lon: number }) => void
  // The active amenity search type (null during a venue search). The "jump to
  // results" link in an amenity popup only works when that spot type IS the
  // results list — i.e. an amenity chip search of the SAME type is active. During
  // a venue search the parking/WC markers are a passive overlay and the spots are
  // not in the (venue) results list, so the link must be hidden; likewise a WC
  // popup during a parking search (cross-type passive overlay).
  amenityType?: AmenityType | null
  // Called when a popup opens or closes. Used by MobileLayout to hide the
  // result-count pill so the popup is never occluded by it.
  onPopupOpenChange?: (open: boolean) => void
}
