"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Maximize2, Minimize2, Search, LocateFixed, Loader2, Layers, Check, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import PlaceDebugSheet from "@/components/results/PlaceDebugSheet"
import { useTranslations } from "@/lib/i18n"
import { SOURCE_LABELS } from "@/lib/config"
import { CATEGORY_ICONS } from "@/lib/category-icons"
import { openExternalUrl } from "@/lib/native/browser"
import { startDefaultNavigation } from "@/lib/native/navigation"
import { hapticLight } from "@/lib/native/haptics"
import { confidenceLabel, placeMayNotBeAccessible } from "@/lib/matching/merge"
import { haversineMetres } from "@/lib/matching/match"
import type { Place, ParkingSpot, AmenityFeature, AmenityTier, AmenityType } from "@/lib/types"

// Leaflet is ESM-only — loaded dynamically to avoid SSR issues
let L: typeof import("leaflet") | null = null

const PLACE_CLUSTER_MAX_RADIUS = 50            // px — grouping radius at low zoom
const PLACE_CLUSTER_DISABLE_AT_ZOOM = 17       // street-level: always show every pin
const LAYERS_COLLAPSED_KEY = "ap_layers_collapsed"

interface Props {
  places:        Place[]
  parkingSpots?: ParkingSpot[]
  toiletSpots?:  AmenityFeature[]
  center?:       { lat: number; lon: number }
  userLocation?: { lat: number; lon: number }
  selectedId?:   string
  panTrigger?:   number
  onSelect:      (place: Place) => void
  onShowInResults?:    (place: Place) => void
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
  // Called when a Leaflet popup opens or closes. Used by MobileLayout to hide
  // the result-count pill so the popup is never occluded by it.
  onPopupOpenChange?: (open: boolean) => void
}

// "Pop" scale: maximum-saturation signal colours; marker/tile contrast comes
// from the thick white pin outline (see svgMarker), not from dark fills.
const CONFIDENCE_COLORS = {
  high:   "#00c853",   // signal green — for markers, bars, decorative dots (vivid)
  medium: "#ffd600",   // signal yellow
  low:    "#ff1744",   // signal red
}

// WCAG AA-passing colours for confidence text on a white popup background.
// markerColor() values (#00c853/#ffd600/#ff1744) fail 4.5:1 on white, so
// text uses a darker shade of the same hue family while dots/bars keep the
// vivid marker colour.
const CONFIDENCE_TEXT_COLORS = {
  high:   "#15803d",   // green-700  5.02:1 ✓
  medium: "#a16207",   // amber-700  4.92:1 ✓
  low:    "#dc2626",   // red-600    4.83:1 ✓
}

function markerColor(confidence: number): string {
  return CONFIDENCE_COLORS[confidenceLabel(confidence)]
}

function textColor(confidence: number): string {
  return CONFIDENCE_TEXT_COLORS[confidenceLabel(confidence)]
}

// Value-text colours for a criterion row (yes/limited/no/unknown) — matches
// PlaceDebugSheet's VALUE_COLORS (text-green-600/amber-600/red-600/zinc-400)
// so the same place reads the same way on the map popup and in the detail
// sheet. Kept separate from CONFIDENCE_TEXT_COLORS: the value colour answers
// "what is the answer", the confidence chip (below) answers "how sure are we".
const VALUE_TEXT_COLORS: Record<string, string> = {
  yes:     "#16a34a", // green-600
  limited: "#d97706", // amber-600
  no:      "#dc2626", // red-600
  unknown: "#a1a1aa", // zinc-400
}

// Compact confidence chip for a popup criterion row (dot + short word) —
// the popup counterpart of PlaceDebugSheet's ReliabilityPill, shrunk to fit
// the narrow popup width. Omitted entirely for "unknown" values (no
// confidence to show). Chip background/border reuse the existing confidence
// colour scales so it visually matches the pin/header confidence styling.
const CHIP_BG: Record<"high" | "medium" | "low", string> = {
  high: "#f0fdf4", medium: "#fffbeb", low: "#fef2f2",
}
const CHIP_BORDER: Record<"high" | "medium" | "low", string> = {
  high: "#bbf7d0", medium: "#fde68a", low: "#fecaca",
}
// shortLabels come from lib/i18n (trusted, per the popup XSS rule — only
// OSM-sourced strings need esc()), so no escaping here.
function confidenceChip(confidence: number, shortLabels: { high: string; medium: string; low: string }): string {
  const level = confidenceLabel(confidence)
  return `<span style="display:inline-flex;align-items:center;gap:3px;border-radius:999px;padding:0 5px;font-size:9px;font-weight:700;line-height:15px;border:1px solid ${CHIP_BORDER[level]};background:${CHIP_BG[level]};color:${CONFIDENCE_TEXT_COLORS[level]};margin-left:6px;white-space:nowrap">` +
    `<span style="width:5px;height:5px;border-radius:50%;background:${CONFIDENCE_COLORS[level]};flex-shrink:0"></span>${shortLabels[level]}</span>`
}

// ─── Shared popup styling (venue / parking / WC) ──────────────────────────────
// All three map popups use one layout: a flush left accent bar (host/confidence
// colour) + an icon badge header + an aligned key/value grid + a footer of
// equally-weighted pill chips (docs/prototypes/navigate-here-popup-footer-
// variants.html, "Variante 2"). No chip is a filled default CTA — "Navigation
// starten" always exits the app and must never outrank the others (user
// feedback: it previously read as the popup's primary action). The one
// exception is the venue popup's "Details anzeigen" chip, which stays filled
// blue because — unlike every other chip here — it's an in-app action, not an
// exit, consistent with the app-wide convention that filled blue means "this
// executes now, in the app" (see the search row's nearby-search button). The
// flush bar relies on the ".ap-popup" CSS override (globals.css) zeroing
// Leaflet's content inset; the padding is re-added on the content column below.
const POPUP_PAD     = "padding:12px 14px;flex:1;min-width:0"
const POPUP_KV      = "display:grid;grid-template-columns:auto 1fr;gap:7px 10px;align-items:center"
const POPUP_FOOTER  = "border-top:1px solid #f0f0f0;margin-top:11px;padding-top:9px"
const POPUP_CHIPS   = "display:flex;flex-wrap:wrap;gap:6px"
const POPUP_CHIP    = "display:inline-flex;align-items:center;gap:5px;border:1px solid #e5e7eb;border-radius:999px;background:#f1f3f6;color:#1f2937;padding:5px 10px;font-size:11px;font-weight:500;cursor:pointer;white-space:nowrap"
// The one filled/primary chip — reserved for the venue popup's "Details anzeigen" (see header comment above).
const POPUP_CHIP_PRIMARY = "display:inline-flex;align-items:center;gap:5px;border:1px solid #2563eb;border-radius:999px;background:#2563eb;color:#fff;padding:5px 10px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap"
const POPUP_CHIP_WARN    = "display:inline-flex;align-items:center;gap:5px;border:1px solid #f3dcb8;border-radius:999px;background:#fef3e2;color:#92400e;padding:5px 10px;font-size:11px;font-weight:500;cursor:pointer;white-space:nowrap"
// POPUP_TITLE: overflow control prevents long names pushing the pill/badge off-screen.
const POPUP_TITLE   = "font-weight:700;font-size:14px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
const POPUP_SUB     = "font-size:11px;color:#71717a;margin:2px 0 11px"
// No font-size here — each usage sets its own (P badge: 13px, 🚻 emoji: 14px).
const POPUP_BADGE   = "display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;flex-shrink:0"
// Chip glyphs — hand-copied from the matching lucide-react icon (same one used
// in the equivalent React UI) so the same action reads consistently between
// the card/sheet components and these hand-built Leaflet popups.
const POPUP_NAV_SVG      = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>` // lucide Navigation
const POPUP_GMAPS_SVG    = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/></svg>` // lucide Map — matches PlaceCard's Google-Maps-search link icon
const POPUP_WHEELMAP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="4" r="1"/><path d="m18 19 1-7-6 1"/><path d="m5 8 3-3 5.5 3-2.36 3.5"/><path d="M4.24 14.5a5 5 0 0 0 6.88 6"/><path d="M13.76 17.5a5 5 0 0 0-6.88-6"/></svg>` // lucide Accessibility — matches PlaceCard's Wheelmap link icon
const POPUP_LIST_SVG     = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/></svg>` // lucide List
const POPUP_INFO_SVG     = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>` // lucide Info
const POPUP_FLAG_SVG     = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>` // lucide Flag
const POPUP_WARN_SVG     = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>` // lucide AlertTriangle

// "Achtung: evtl. nicht barrierefrei" — always-visible venue popup warning,
// same trigger/wording as PlaceCard/PlaceDebugSheet's NotAccessibleWarningBox
// (see placeMayNotBeAccessible in lib/matching/merge.ts). Built once per
// render since it's plain HTML (this popup isn't React) but the trigger
// condition is evaluated per place at the call site. No esc() here — these
// are static i18n strings, not OSM-sourced data (see the popup XSS rule in
// CLAUDE.md: i18n strings and numbers are trusted).
function popupNotAccessibleWarning(t: ReturnType<typeof useTranslations>): string {
  return `<div style="grid-column:1/-1;display:flex;align-items:flex-start;gap:5px;margin-top:5px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:6px 8px;font-size:10.5px;color:#b91c1c;line-height:1.45">${POPUP_WARN_SVG}<span>${t.results.notAccessibleWarningPre}<b>${t.results.notAccessibleWarningBold}</b>${t.results.notAccessibleWarningPost}</span></div>`
}

// Wraps popup content in the flush-bar shell. `bar` is the accent colour.
function popupShell(bar: string, inner: string): string {
  return `<div style="display:flex"><div style="width:5px;flex-shrink:0;background:${bar}"></div><div style="${POPUP_PAD}">${inner}</div></div>`
}

// ─── Popup overflow guard (issue #43) ─────────────────────────────────────
// At high Android display/font scaling, popup content can grow tall enough
// that Leaflet's own auto-pan can't keep both the top and bottom edges on
// screen (Popup._adjustPan lets the bottom run off once popup height >
// map height), and none of the four popup call sites capped maxHeight at
// all. popupMaxHeight() derives a cap from the *current* map size instead of
// a guessed constant, so it still leaves map context visible on small
// devices and doesn't clip unnecessarily on large ones.
function popupMaxHeight(mapHeightPx: number): number {
  return Math.max(160, Math.round(mapHeightPx * 0.55))
}

// Above this fraction of the map's current height, the venue popup switches
// to the reduced template (see buildPlacePopupContent) instead of relying on
// the maxHeight cap + scroll alone.
const REDUCED_POPUP_THRESHOLD = 0.6

// Renders `html` off-screen at the popup's real content width to measure how
// tall the *full* (uncapped) content would be, before Leaflet ever opens it.
// Used to decide whether to fall back to a reduced template (see
// buildPlacePopupContent) rather than relying solely on scrolling inside a
// tiny speech bubble — a poor interaction for this app's target users.
function measureContentHeight(html: string, widthPx: number): number {
  if (typeof document === "undefined") return 0
  const probe = document.createElement("div")
  probe.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;width:${widthPx}px;font-family:sans-serif;line-height:1.5`
  probe.innerHTML = html
  document.body.appendChild(probe)
  const height = probe.offsetHeight
  document.body.removeChild(probe)
  return height
}

// Compact criterion indicator for the reduced venue popup template — a
// checkmark row (🚪 ✓ / 🚻 ✗ / 🅿 ?) instead of the full label+value+
// confidence-chip row, so the reduced template stays a couple of lines tall
// regardless of text scale.
function reducedCriterionBadge(icon: string, value: string): string {
  const mark  = value === "yes" || value === "limited" ? "✓" : value === "no" ? "✗" : "?"
  const color = VALUE_TEXT_COLORS[value] ?? VALUE_TEXT_COLORS.unknown
  return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:13px;font-weight:700;color:${color}">${icon}<span>${mark}</span></span>`
}

// Caps a place name so the parking popup's "342 m from <name>" row can't blow
// up the popup's height — the value cell has no overflow/nowrap clipping (it
// wraps normally, unlike the fixed-width labels), so a long venue name like
// "Kulturhaus Johannes R. Becher" would otherwise wrap across several lines.
const POPUP_NAME_MAX_LEN = 24
function truncateName(name: string, max: number = POPUP_NAME_MAX_LEN): string {
  return name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name
}

// One label/value row for the popup key/value grid. `dot` draws a leading status
// dot; `color` tints the value text; `chip` appends trailing HTML (the compact
// confidence chip on venue criteria — see confidenceChip()).
function popupRow(label: string, value: string, opts: { color?: string; dot?: string; chip?: string } = {}): string {
  const valStyle = `font-size:12px;font-weight:600;text-align:right;display:flex;align-items:center;justify-content:flex-end;gap:6px${opts.color ? `;color:${opts.color}` : ""}`
  const dotEl = opts.dot ? `<span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${opts.dot};display:inline-block"></span>` : ""
  return `<span style="font-size:11px;color:#71717a">${label}</span><span style="${valStyle}">${dotEl}${value}${opts.chip ?? ""}</span>`
}

// Indented sub-row spanning both KV grid columns (docs/prototypes/navigate-
// here-popup-distance-row-variants.html, "Variante A") — used to hang the
// parking popup's nearest-place name off its own Entfernung row without
// risking the long-name wrap that a single combined "342 m from <name>"
// value used to cause. `value` gets an unconditional CSS ellipsis (in
// addition to the JS truncateName() cap) so it can never wrap regardless of
// name length.
function popupSubRow(label: string, value: string): string {
  return `<div style="grid-column:1/-1;display:flex;align-items:baseline;gap:6px;margin-top:-1px;padding-left:14px;border-left:2px solid #e5e7eb;font-size:10.5px;color:#71717a;overflow:hidden"><span style="flex-shrink:0">${label}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${value}</span></div>`
}

// Wires the "Navigate here" primary CTA button (docs/plans/native-navigate-
// here.md, "Map marker popup placement") — shared by the parking and toilet
// marker popups, which used to each hand-roll this querySelector + DomEvent
// wiring independently. Uses L.DomEvent.on (not addEventListener) — plain
// addEventListener and inline onclick fail on mobile because Leaflet
// intercepts touchstart. No in-popup chooser, unlike the card/sheet
// NavigateButton: this popup is short-lived (closes on pan/zoom) and too
// narrow for a multi-option picker, so it always fires the platform default
// directly.
function wireNavigateButton(div: HTMLElement, coords: { lat: number; lon: number }): void {
  const navigateBtn = div.querySelector<HTMLElement>("[data-navigate]")
  if (!navigateBtn) return
  L!.DomEvent.on(navigateBtn, "click", (ev: Event) => {
    L!.DomEvent.stopPropagation(ev)
    startDefaultNavigation(coords)
  })
}

// Parking marker colours per tier.
// "strong" (reserved disabled bays) = signal blue "P"; "weak" (wheelchair=yes
// lot) = signal orange with dark "P" (white-on-orange fails contrast — this is
// an accessibility app).
const PARKING_TIER_STYLE: Record<AmenityTier, { fill: string; text: string }> = {
  strong: { fill: "#2979ff", text: "white"   }, // signal blue, white P
  weak:   { fill: "#ff9100", text: "#1f2937" }, // signal orange, dark P
}

function svgParkingMarker(tier: AmenityTier = "strong") {
  const { fill, text } = PARKING_TIER_STYLE[tier]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 26 26">
    <rect x="1" y="1" width="24" height="24" rx="5" fill="${fill}" stroke="white" stroke-width="1.5"/>
    <text x="13" y="19" text-anchor="middle" font-size="15" font-weight="bold" fill="${text}" font-family="sans-serif">P</text>
  </svg>`
}

// WC marker colours encode the HOST type (not the tier) within one magenta
// family: standalone public WCs = solid magenta, WCs inside a venue = light
// fill with a magenta border ("solid = public, light = inside a building").
// The tier (designated vs. yes) is shown in the popup instead. `accent` is the
// popup bar/badge colour — the venue fill is too light to serve as an accent.
type ToiletHost = "standalone" | "venue"
const TOILET_HOST_STYLE: Record<ToiletHost, { fill: string; stroke: string; strokeW: number; accent: string }> = {
  standalone: { fill: "#be185d", stroke: "#9d174d", strokeW: 3,   accent: "#be185d" }, // pink-700 / pink-800 border
  venue:      { fill: "#fce7f3", stroke: "#be185d", strokeW: 2.5, accent: "#be185d" }, // pink-100 / pink-700 border
}

function svgToiletMarker(host: ToiletHost = "standalone") {
  const { fill, stroke, strokeW } = TOILET_HOST_STYLE[host]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 30 30">
    <rect x="1.5" y="1.5" width="27" height="27" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}"/>
    <text x="15" y="22" text-anchor="middle" font-size="16">🚻</text>
  </svg>`
}

// A moveend firing within this window after a programmatic move is treated as
// app-driven (animation tail, popup autoPan, etc.) rather than a user pan.
// Comfortably covers Leaflet's ~250 ms pan/zoom animations plus popup autoPan.
const PROGRAMMATIC_MOVE_WINDOW_MS = 700

function svgMarker(color: string, selected: boolean, emoji: string) {
  const w      = selected ? 41 : 30
  const h      = selected ? 54 : 39
  // Selection ring is dark slate (not blue — would collide with the parking
  // marker blue). The thick white outline on unselected pins is what separates
  // the vivid fills from same-hue map tiles (forest green, water blue).
  const stroke = selected ? "#0f172a" : "#fff"
  const sw     = 2.5
  // Pin shape: circular head (center ≈ 13,12) tapering to a tip at (13,32)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 26 34">
    <path d="M13,1.5 C7.2,1.5 2.5,6.2 2.5,12 C2.5,19.5 13,32.5 13,32.5 C13,32.5 23.5,19.5 23.5,12 C23.5,6.2 18.8,1.5 13,1.5 Z"
      fill="${color}" stroke="${stroke}" stroke-width="${sw}"/>
    <text x="13" y="15.5" text-anchor="middle" font-size="13">${emoji}</text>
  </svg>`
}

export default function MapView({
  places,
  parkingSpots,
  toiletSpots,
  center,
  userLocation,
  selectedId,
  panTrigger,
  onSelect,
  onShowInResults,
  isFullscreen,
  onToggleFullscreen,
  showFullscreenToggle = true,
  visible,
  showParking,
  showToilets,
  onSetMapLayers,
  hasToiletData = false,
  isLoading = false,
  focusMode = false,
  focusSearchCenter = null,
  onFocusSearchHere,
  showWeakParking = false,
  onSearchHere,
  hideSearchHereButton = false,
  onPanned,
  onViewportChange,
  onLocate,
  locatePanTrigger,
  searchRadiusKm,
  amenityPanTarget = null,
  amenityPanTrigger,
  onAmenityMarkerClick,
  onShowAmenityInResults,
  amenityType = null,
  onPopupOpenChange,
}: Props) {
  const t        = useTranslations()
  const mapRef   = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInst  = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const placeClusterRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markers  = useRef<Map<string, any>>(new Map())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parkingMarkersRef = useRef<any[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toiletMarkersRef  = useRef<any[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userMarker = useRef<any>(null)
  const [mapReady, setMapReady] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  // Ebenen box (parking/WC layer toggles) collapse state — persisted across
  // sessions, defaults to expanded (today's behaviour). A plain localStorage
  // flag rather than AppSettings: purely cosmetic map-UI state, not a search
  // preference, so it doesn't belong in the SettingsSheet surface.
  const [layersCollapsed, setLayersCollapsed] = useState(() => {
    if (typeof window === "undefined") return false
    return window.localStorage.getItem(LAYERS_COLLAPSED_KEY) === "1"
  })
  function toggleLayersCollapsed() {
    setLayersCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(LAYERS_COLLAPSED_KEY, next ? "1" : "0")
      } catch {
        // localStorage unavailable (private browsing etc.) — collapse state
        // just won't persist, no functional impact.
      }
      return next
    })
  }
  // Place whose detail sheet is open over the map (from the popup "Details
  // anzeigen" link). Rendered as a portal overlay so the Leaflet map underneath
  // keeps its centre/zoom/open popup — closing the sheet reveals the map exactly
  // as it was left, with no re-fit.
  const [detailPlace, setDetailPlace] = useState<Place | null>(null)
  function esc(s: string) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  }

  const onShowInResultsRef  = useRef(onShowInResults)
  const onShowAmenityInResultsRef = useRef(onShowAmenityInResults)
  const placesRef           = useRef(places)
  const userLocationRef     = useRef(userLocation)
  const searchCenterRef     = useRef(center)
  const onSearchHereRef     = useRef(onSearchHere)
  const onFocusSearchHereRef = useRef(onFocusSearchHere)
  const onPannedRef         = useRef(onPanned)
  const onViewportChangeRef = useRef(onViewportChange)
  const focusModeRef        = useRef(focusMode)
  useEffect(() => { onPannedRef.current = onPanned }, [onPanned])
  useEffect(() => { onViewportChangeRef.current = onViewportChange }, [onViewportChange])
  useEffect(() => { onShowInResultsRef.current = onShowInResults }, [onShowInResults])
  useEffect(() => { onShowAmenityInResultsRef.current = onShowAmenityInResults }, [onShowAmenityInResults])
  useEffect(() => { placesRef.current = places }, [places])
  useEffect(() => { userLocationRef.current = userLocation }, [userLocation])
  useEffect(() => { searchCenterRef.current = center }, [center])
  useEffect(() => { onSearchHereRef.current = onSearchHere }, [onSearchHere])
  useEffect(() => { onFocusSearchHereRef.current = onFocusSearchHere }, [onFocusSearchHere])
  useEffect(() => { focusModeRef.current = focusMode }, [focusMode])

  // Floating "search here" button state — set when user pans away from search centre.
  const [searchHereCenter, setSearchHereCenter] = useState<{ lat: number; lon: number } | null>(null)
  // Which gesture armed the pill — a real drag (moveend handler below) or the
  // locate button (locatePanTrigger effect, "Option 2"). Read once, at the
  // moment the pill fires, by the onPanned/onSearchHere call sites below; never
  // needs to be state since nothing renders differently based on its value.
  const searchHereOriginRef = useRef<"drag" | "locate">("drag")
  // Report pan availability to the parent so it can render the "search here" pill
  // inline next to the count pill (mobile) — for both the venue path and the
  // amenity focus-mode path, so neither ever collides with a count pill the
  // parent renders at the same spot (see MobileLayout). The runner computes
  // the viewport radius at click time.
  useEffect(() => {
    const notify  = onPannedRef.current
    const report  = onViewportChangeRef.current

    if (focusMode) {
      // Focus-mode "search this area" is always available while focus layers
      // are active — unlike the venue pill, it's not gated by a pan.
      if (onFocusSearchHereRef.current) {
        notify?.(() => {
          const map = mapInst.current
          if (!map) return
          const c = map.getCenter()
          const radiusKm = c.distanceTo(map.getBounds().getNorthEast()) / 1000
          onFocusSearchHereRef.current?.({ lat: c.lat, lon: c.lng }, radiusKm)
        })
      } else {
        notify?.(null)
      }
      report?.(null)
      return
    }

    // A pending pan exists only when searchHereCenter is set by a genuine moveend
    // (see the moveend handler: it requires searchCenterRef so this never fires on
    // a cold map). The pill and the viewport-origin report are driven by the
    // exact same condition, so they can never diverge.
    const panPending = !!(searchHereCenter && onSearchHereRef.current)
    if (panPending && searchHereCenter) {
      const map = mapInst.current
      const viewportRadiusKm = map
        ? map.getCenter().distanceTo(map.getBounds().getNorthEast()) / 1000
        : 5
      const panned = searchHereCenter
      const panOrigin = searchHereOriginRef.current
      notify?.(() => {
        onSearchHereRef.current?.(panned, viewportRadiusKm, panOrigin)
        setSearchHereCenter(null)
      })
      report?.({ center: panned, radiusKm: viewportRadiusKm })
    } else {
      notify?.(null)
      report?.(null)
    }
  }, [searchHereCenter, focusMode])
  // Locate button interaction state
  const [locating,          setLocating]          = useState(false)
  const [locateErrorVisible, setLocateErrorVisible] = useState(false)
  // True while a place-info popup is open. Leaflet traps the popup inside the
  // transformed .leaflet-map-pane (its own stacking context), so the floating
  // buttons (z-[1000] siblings of the map container) can never be beaten by the
  // popup via z-index alone. Instead we fade the buttons out while a popup is
  // open so the popup is unobstructed; they return on close.
  const [popupOpen,         setPopupOpen]         = useState(false)
  // Timestamp of the last programmatic move (setView/fitBounds/zoomToShowLayer).
  // A moveend within PROGRAMMATIC_MOVE_WINDOW_MS of this is treated as app-driven
  // and ignored; any later moveend must be a real user pan. This time-window
  // approach is self-healing: a programmatic move that fires 0, 1, or N moveends
  // (or a no-op move that fires none) can never desync a counter. Replaces the
  // old dragend flag, which iOS WKWebView fires unreliably for touch pans.
  const lastProgrammaticMoveRef = useRef(Date.now())
  // True once the user starts a real drag-pan gesture (Leaflet `dragstart`), reset
  // after the resulting moveend is consumed. Programmatic moves (setView/fitBounds/
  // panTo) NEVER fire `dragstart`, so this is a direct, reliable "this move was a
  // user pan" signal — unlike the 700 ms time window, which iOS/WKWebView defeats by
  // firing a late moveend after a programmatic fitBounds (e.g. the passive-amenity
  // fit), which was then misread as a user pan and used as a phantom search origin
  // (parking-chip "jumps to a different place" bug). The moveend handler now requires
  // this flag, so a phantom pan can no longer set searchHereCenter / the viewport origin.
  const userPannedRef = useRef(false)
  // Last search center the pan-to-center effect has seen. Lets it recenter only on
  // a real center change (new search), not when a mode switch merely clears the
  // results/spots while the old center lingers.
  const prevCenterRef = useRef<{ lat: number; lon: number } | null>(null)

  // Dismiss the button whenever a new search result arrives (centre changed).
  useEffect(() => { setSearchHereCenter(null) }, [center])

  // Forget any pending pan when the map is hidden (mobile: user switched away from
  // the map tab). The "search here" pill — and therefore the viewport-as-origin
  // signal it drives — is only visible on the map tab; without this, a chip tapped
  // from the results tab would silently search a panned area the user can no longer
  // see. Clearing here keeps the visible signal and the actual behaviour in step.
  // `visible === false` (not `!visible`) so desktop, where the prop is omitted,
  // never triggers it. (issue: map-viewport-as-origin, M2)
  useEffect(() => { if (visible === false) setSearchHereCenter(null) }, [visible])

  // Pan to userLocation when locatePanTrigger increments (locate button tapped).
  // Stamp the move as programmatic so moveend does NOT show "search here" via the
  // normal pan-detection path. Instead we show it explicitly below (Option 2):
  // the button is offered directly after a successful locate so the user can
  // repeat their last search at their position with one more tap.
  useEffect(() => {
    if (locatePanTrigger === undefined || !mapInst.current || !L) return
    // Read the prop directly (not the ref): the prop and the trigger update in the
    // same commit, so the closure value is fresh — no chance of centring on a stale
    // ref. animate:false lands exactly on the point (an interrupted pan animation
    // would otherwise stop slightly off-centre).
    const ul = userLocation
    if (!ul) return
    lastProgrammaticMoveRef.current = Date.now()
    // Zoom out just far enough that the configured search radius is visible,
    // instead of a fixed zoom 14 (~2 km) — a locate tap followed by "Hier
    // suchen" used to search a much smaller area than the configured radius
    // (issue #37). getBoundsZoom finds the zoom level that fits a bounding
    // box whose corner is `searchRadiusKm` away from the centre — the same
    // corner-distance formula used elsewhere in this file (viewportRadiusKm)
    // to derive the radius that "Hier suchen" will actually search.
    const km = searchRadiusKm && searchRadiusKm > 0 ? searchRadiusKm : 5
    const half = km / Math.SQRT2 // corner distance of a square = half-extent * sqrt(2)
    const latDelta = half / 111.32
    const lonDelta = half / (111.32 * Math.cos((ul.lat * Math.PI) / 180))
    const bounds = L.latLngBounds(
      [ul.lat - latDelta, ul.lon - lonDelta],
      [ul.lat + latDelta, ul.lon + lonDelta],
    )
    const zoom = Math.max(3, Math.min(mapInst.current.getBoundsZoom(bounds, false), 18))
    mapInst.current.setView([ul.lat, ul.lon], zoom, { animate: false })
    // Option 2: show "search here" explicitly if a previous search exists.
    // Not in focus mode — there the focus "search this area" pill is always
    // available, and setting the venue pill state here would leave a stale
    // pill behind when the user exits the amenity search.
    if (onSearchHereRef.current && !focusModeRef.current) {
      searchHereOriginRef.current = "locate"
      setSearchHereCenter({ lat: ul.lat, lon: ul.lon })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locatePanTrigger, mapReady])

  // Init map once
  useEffect(() => {
    if (!mapRef.current || mapInst.current) return

    let cancelled = false

    async function init() {
      L = (await import("leaflet")).default
      await import("leaflet/dist/leaflet.css")
      // Marker clustering: behavior CSS only — the default theme is replaced
      // by our custom .ap-cluster-* styles below.
      await import("leaflet.markercluster")
      await import("leaflet.markercluster/dist/MarkerCluster.css")

      // Guard: effect may have been cleaned up while awaiting dynamic imports
      if (cancelled || mapInst.current || !mapRef.current) return

      const map = L.map(mapRef.current, {
        center:             [51.165691, 10.451526],
        zoom:               6,
        zoomControl:        true,
        attributionControl: true,
      })

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map)

      mapInst.current = map

      // Refresh the suppression window now that the map exists — async imports may
      // have elapsed well over the window since the ref was first initialised.
      lastProgrammaticMoveRef.current = Date.now()

      // "Search here" — detect user-initiated pans via moveend (fires reliably on
      // both mouse and touch, unlike dragend). Every programmatic move stamps
      // lastProgrammaticMoveRef just before it runs; a moveend within the window
      // after that stamp is app-driven and ignored. Any later moveend is a user pan.
      // Fade the floating buttons while a popup is open (see popupOpen state).
      map.on("popupopen",  () => { setPopupOpen(true);  onPopupOpenChange?.(true)  })
      map.on("popupclose", () => { setPopupOpen(false); onPopupOpenChange?.(false) })

      // Mark the start of a real user drag-pan. Programmatic moves never fire this,
      // so it cleanly separates user pans from app-driven fitBounds/setView.
      map.on("dragstart", () => { userPannedRef.current = true })

      map.on("moveend", () => {
        // Read + reset the user-gesture flag first, so it can never leak into a
        // later programmatic moveend (which would otherwise be misread as a pan).
        const wasUserPan = userPannedRef.current
        userPannedRef.current = false
        // No "search here" in amenity focus mode — it would re-run the venue
        // search and silently drop the parking/WC focus layers.
        if (focusModeRef.current) return
        // Only a genuine drag-pan may set the search origin. This is the primary
        // guard; the time window below stays as a secondary defence (e.g. a drag
        // that interleaves with an in-flight programmatic move).
        if (!wasUserPan) return
        if (Date.now() - lastProgrammaticMoveRef.current < PROGRAMMATIC_MOVE_WINDOW_MS) return
        if (!onSearchHereRef.current || !searchCenterRef.current) return
        // Guard against the final moveend Leaflet fires while tearing the map down.
        // cancelled is set true *before* remove() runs in cleanup, so this bails
        // even though remove() may emit moveend synchronously while mapInst.current
        // is briefly still set (it is nulled after remove()). Checking mapInst too
        // covers any post-cleanup async emission.
        if (cancelled || !mapInst.current) return
        const newCenter = map.getCenter()
        const bounds    = map.getBounds()
        const minSpan   = Math.min(
          bounds.getNorth() - bounds.getSouth(),
          bounds.getEast()  - bounds.getWest(),
        )
        const threshold = 0.25 * minSpan
        const sc = searchCenterRef.current
        if (Math.abs(newCenter.lat - sc.lat) > threshold ||
            Math.abs(newCenter.lng - sc.lon) > threshold) {
          searchHereOriginRef.current = "drag"
          setSearchHereCenter({ lat: newCenter.lat, lon: newCenter.lng })
        } else {
          setSearchHereCenter(null)
        }
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Lany = L as any
      placeClusterRef.current = Lany.markerClusterGroup({
        maxClusterRadius:         PLACE_CLUSTER_MAX_RADIUS,
        disableClusteringAtZoom:  PLACE_CLUSTER_DISABLE_AT_ZOOM,
        spiderfyOnMaxZoom:        true,
        spiderfyDistanceMultiplier: 1.5,
        showCoverageOnHover:      false,
        removeOutsideVisibleBounds: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        iconCreateFunction: (cluster: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const children = cluster.getAllChildMarkers() as any[]
          const best = children.reduce(
            (m: number, c) => Math.max(m, (c.options.placeConfidence ?? 0) as number),
            0,
          )
          const color = markerColor(best)
          const count = cluster.getChildCount()
          const sizeClass = count >= 100 ? "lg" : count >= 10 ? "md" : "sm"
          const size      = count >= 100 ? 48  : count >= 10 ? 42  : 36
          return L!.divIcon({
            html: `<div class="ap-cluster ap-cluster-${sizeClass}" style="background:${color}"><span>${count}</span></div>`,
            className: "ap-cluster-divicon",
            iconSize:  [size, size],
            iconAnchor:[size / 2, size / 2],
          })
        },
      })
      placeClusterRef.current.addTo(map)

      setMapReady(true)
    }
    init()

    return () => {
      cancelled = true
      // Null the ref *before* remove() so the moveend handler's guard bails even
      // if Leaflet emits a synchronous moveend during teardown.
      const inst = mapInst.current
      mapInst.current = null
      // Stop in-flight animations first so no zoom/pan transition-end fires against
      // the cluster group after teardown (markercluster hasLayer crash).
      inst?.stop()
      inst?.remove()
      placeClusterRef.current = null
    }
  }, [])

  // Inject pulse animation CSS once
  useEffect(() => {
    if (document.getElementById("ap-user-loc-style")) return
    const style = document.createElement("style")
    style.id = "ap-user-loc-style"
    style.textContent = `
      @keyframes ap-pulse {
        0%   { transform:scale(1);   opacity:0.6; }
        70%  { transform:scale(2.8); opacity:0;   }
        100% { transform:scale(2.8); opacity:0;   }
      }
      .ap-user-dot { position:relative; width:22px; height:22px; }
      .ap-user-dot-ring {
        position:absolute; inset:0; border-radius:50%;
        background:rgba(59,130,246,0.35);
        animation:ap-pulse 2s ease-out infinite;
      }
      .ap-user-dot-inner {
        position:absolute; inset:4px; border-radius:50%;
        background:#3b82f6; border:2.5px solid #fff;
        box-shadow:0 1px 4px rgba(0,0,0,0.3);
      }
      .ap-cluster-divicon { background:transparent; border:0; }
      .ap-cluster {
        width:100%; height:100%; border-radius:50%;
        display:flex; align-items:center; justify-content:center;
        color:#fff; font-family:sans-serif; font-weight:600;
        border:3px solid #fff;
        box-shadow:0 1px 4px rgba(0,0,0,0.3);
        cursor:pointer;
      }
      .ap-cluster-sm { font-size:13px; }
      .ap-cluster-md { font-size:14px; }
      .ap-cluster-lg { font-size:15px; }
    `
    document.head.appendChild(style)
  }, [])

  // User location marker (only when userLocation prop is set)
  useEffect(() => {
    if (!mapInst.current || !L) return
    if (userLocation) {
      const icon = L.divIcon({
        html:      '<div class="ap-user-dot"><div class="ap-user-dot-ring"></div><div class="ap-user-dot-inner"></div></div>',
        className: "",
        iconSize:  [22, 22],
        iconAnchor:[11, 11],
      })
      if (userMarker.current) {
        userMarker.current.setLatLng([userLocation.lat, userLocation.lon])
        userMarker.current.setIcon(icon)
      } else {
        userMarker.current = L.marker(
          [userLocation.lat, userLocation.lon],
          { icon, zIndexOffset: 1000 },
        ).addTo(mapInst.current)
      }
    } else {
      userMarker.current?.remove()
      userMarker.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLocation, mapReady])

  // Parking spot markers — shown only when parkingSpots is a non-empty array.
  // In focus mode all spots render regardless of the showParking toggle.
  useEffect(() => {
    if (!mapInst.current || !L) return
    for (const m of parkingMarkersRef.current) m.remove()
    parkingMarkersRef.current = []

    for (const spot of parkingSpots ?? []) {
      const tier: AmenityTier = spot.tier === "weak" ? "weak" : "strong"
      const icon = L.divIcon({
        html:        svgParkingMarker(tier),
        className:   "",
        iconSize:    [21, 21],
        iconAnchor:  [10, 10],
        popupAnchor: [0, -11],
      })

      // Distance to nearest place in current results (placesRef updated before this effect runs)
      const nearest = placesRef.current.reduce<{ name: string; dist: number } | null>((best, p) => {
        const d = haversineMetres(spot, p.coordinates)
        return best === null || d < best.dist ? { name: p.name, dist: d } : best
      }, null)
      const distText = nearest !== null ? t.results.distanceShort(Math.round(nearest.dist)) : null
      const nearNameText = nearest !== null ? esc(truncateName(nearest.name)) : null

      // Fee badge: show only when tag is present
      const feeText = spot.fee === "no"  ? t.map.parkingFree
                    : spot.fee === "yes" ? t.map.parkingPaid
                    : spot.fee ?? null   // raw value (rare price strings like "EUR 1.00")

      // Access badge: show only when non-public restriction is present
      const accessText = spot.access === "private"   ? t.map.parkingPrivate
                       : spot.access === "customers" ? t.map.parkingCustomers
                       : null

      // Max-stay label + raw OSM value (already human-readable: "2 hours", "30 minutes")
      const maxstayText = spot.maxstay ?? null

      // Word-label per tier — colour alone must never carry the meaning (a11y).
      const title = tier === "weak"
        ? t.map.parkingAccessible
        : spot.capacity != null ? t.map.parkingSpots(spot.capacity) : t.map.parkingSpot
      const mapsUrl = `https://www.google.com/maps?q=${spot.lat},${spot.lon}`

      const barColor    = PARKING_TIER_STYLE[tier].fill
      const badgeTextC  = PARKING_TIER_STYLE[tier].text
      const showResults = onShowAmenityInResultsRef.current && amenityType === "parking"

      // Reservation shown as a checkbox row (☑ Ja / ☐ Nein) — first in the grid.
      const reservedValue = tier === "weak"
        ? `☐ ${t.a11y.no}`
        : `☑ ${t.a11y.yes}`
      const reservedColor = tier === "weak" ? "#b45309" : "#15803d"

      const rows = [
        popupRow(t.map.parkingReservedLabel, reservedValue, { color: reservedColor }),
        distText    ? popupRow(t.map.parkingDistanceLabel, distText) : "",
        nearNameText ? popupSubRow(t.map.parkingNearLabel, nearNameText) : "",
        feeText     ? popupRow(t.map.parkingFeeLabel, esc(feeText), { color: spot.fee === "no" ? "#15803d" : undefined }) : "",
        maxstayText ? popupRow(t.map.parkingMaxstay, esc(maxstayText)) : "",
        accessText  ? popupRow(t.map.parkingAccessLabel, accessText, { color: "#b45309" }) : "",
      ].join("")

      const div = document.createElement("div")
      div.style.cssText = "font-family:sans-serif"
      div.innerHTML = popupShell(barColor, `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:11px;padding-right:14px">
          <span style="${POPUP_BADGE};background:${barColor};color:${badgeTextC};font-weight:700;font-size:13px">P</span>
          <span style="${POPUP_TITLE}">${title}</span>
        </div>
        <div style="${POPUP_KV}">${rows}</div>
        <div style="${POPUP_FOOTER}">
          <div style="${POPUP_CHIPS}">
            <button data-navigate style="${POPUP_CHIP}">${POPUP_NAV_SVG}${t.map.popupChipNavigate}</button>
            <button data-gmaps style="${POPUP_CHIP}">${POPUP_GMAPS_SVG}${t.map.popupChipGoogleMaps}</button>
            ${showResults ? `<button data-show-results style="${POPUP_CHIP}">${POPUP_LIST_SVG}${t.map.popupChipResults}</button>` : ""}
            ${tier === "weak" ? `<button data-report style="${POPUP_CHIP_WARN}">${POPUP_FLAG_SVG}${t.map.popupChipReport}</button>` : ""}
          </div>
        </div>
      `)
      wireNavigateButton(div, { lat: spot.lat, lon: spot.lon })

      const gmapsBtn = div.querySelector<HTMLElement>("[data-gmaps]")
      if (gmapsBtn) {
        L!.DomEvent.on(gmapsBtn, "click", (ev: Event) => {
          L!.DomEvent.stopPropagation(ev)
          void openExternalUrl(mapsUrl)
        })
      }

      const reportBtn = div.querySelector<HTMLElement>("[data-report]")
      if (reportBtn) {
        L!.DomEvent.on(reportBtn, "click", (ev: Event) => {
          L!.DomEvent.stopPropagation(ev)
          reportBtn.style.opacity = "0.5"
          reportBtn.style.pointerEvents = "none"
          fetch("/api/report-parking", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
              lat:              spot.lat,
              lon:              spot.lon,
              osmId:            spot.osmId,
              nearestPlaceName: nearest?.name,
            }),
          })
            .then((r) => {
              reportBtn.textContent = r.ok ? t.map.parkingReportDone : t.map.parkingReportError
              reportBtn.style.opacity = "1"
            })
            .catch(() => {
              reportBtn.textContent = t.map.parkingReportError
              reportBtn.style.opacity = "1"
            })
        })
      }

      const showResultsBtn = div.querySelector<HTMLElement>("[data-show-results]")
      if (showResultsBtn) {
        const captured = { osmId: spot.osmId, lat: spot.lat, lon: spot.lon }
        L!.DomEvent.on(showResultsBtn, "click", (ev: Event) => {
          L!.DomEvent.stopPropagation(ev)
          onShowAmenityInResultsRef.current?.(captured)
        })
      }

      const marker = L.marker([spot.lat, spot.lon], { icon, zIndexOffset: -200 })
        .bindPopup(div, {
          maxWidth:       250,
          maxHeight:      popupMaxHeight(mapInst.current.getSize().y),
          autoPanPadding: [24, 24],
          className:      "ap-popup",
        })
        .addTo(mapInst.current)
      marker.on("click", () => onAmenityMarkerClick?.({ osmId: spot.osmId, lat: spot.lat, lon: spot.lon }))
      parkingMarkersRef.current.push(marker)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parkingSpots, mapReady, t, amenityType])

  // Toilet (WC) spot markers — shown when toiletSpots is non-empty.
  useEffect(() => {
    if (!mapInst.current || !L) return
    for (const m of toiletMarkersRef.current) m.remove()
    toiletMarkersRef.current = []

    for (const spot of toiletSpots ?? []) {
      const tier: AmenityTier = spot.tier === "weak" ? "weak" : "strong"
      const host: ToiletHost  = spot.host?.kind === "venue" ? "venue" : "standalone"
      const accent = TOILET_HOST_STYLE[host].accent
      const icon = L.divIcon({
        html:        svgToiletMarker(host),
        className:   "",
        iconSize:    [24, 21],
        iconAnchor:  [12, 10],
        popupAnchor: [0, -11],
      })

      const yes      = t.a11y.yes
      const title    = tier === "strong" ? (t.map.toiletDesignated ?? "Rollstuhl-WC") : (t.map.toiletAccessible ?? "Barrierefreies WC")
      const isCustomers = spot.host?.access === "customers" || spot.access === "customers"
      const mapsUrl  = `https://www.google.com/maps?q=${spot.lat},${spot.lon}`

      const rows = [
        popupRow(`♿ ${t.map.toiletWheelchairLabel ?? "Rollstuhlgerecht"}`,
          tier === "strong" ? (t.map.toiletDesignatedValue ?? "Designiert") : yes, { color: "#15803d" }),
        spot.euroKey       ? popupRow(`🔑 ${t.map.toiletEuroKey ?? "Euroschlüssel"}`, yes) : "",
        spot.changingTable ? popupRow(`👶 ${t.map.toiletChangingTable ?? "Wickeltisch"}`, yes) : "",
        isCustomers        ? popupRow(`🚪 ${t.map.toiletAccessLabel ?? "Zugang"}`,
          t.map.toiletCustomers ?? "Nur für Gäste", { color: "#b45309" }) : "",
      ].join("")

      // Venue WCs name their host in the subline; standalone WCs have no subline.
      const sub = host === "venue"
        ? `🏢 ${spot.host?.name ? esc(truncateName(spot.host.name)) : (t.map.toiletVenueGeneric ?? "Lokalität")}`
        : ""

      // Wheelmap only indexes OSM nodes, not ways or relations.
      const osmNodeId = spot.osmId?.startsWith("node/") ? spot.osmId.slice(5) : undefined
      const wheelmapUrl = osmNodeId ? `https://wheelmap.org/nodes/${osmNodeId}` : undefined
      const showResults = onShowAmenityInResultsRef.current && amenityType === "toilet"

      const div = document.createElement("div")
      div.style.cssText = "font-family:sans-serif"
      div.innerHTML = popupShell(accent, `
        <div style="display:flex;align-items:center;gap:8px;${sub ? "" : "margin-bottom:11px;"}padding-right:14px">
          <span style="${POPUP_BADGE};background:${accent};font-size:14px">🚻</span>
          <span style="${POPUP_TITLE}">${title}</span>
        </div>
        ${sub ? `<div style="${POPUP_SUB}">${sub}</div>` : ""}
        <div style="${POPUP_KV}">${rows}</div>
        <div style="${POPUP_FOOTER}">
          <div style="${POPUP_CHIPS}">
            <button data-navigate style="${POPUP_CHIP}">${POPUP_NAV_SVG}${t.map.popupChipNavigate}</button>
            ${wheelmapUrl ? `<button data-wheelmap style="${POPUP_CHIP}">${POPUP_WHEELMAP_SVG}${t.map.popupChipWheelmap}</button>` : ""}
            <button data-gmaps style="${POPUP_CHIP}">${POPUP_GMAPS_SVG}${t.map.popupChipGoogleMaps}</button>
            ${showResults ? `<button data-show-results style="${POPUP_CHIP}">${POPUP_LIST_SVG}${t.map.popupChipResults}</button>` : ""}
          </div>
        </div>
      `)
      // "Navigate here" is one chip among several, equal weight to the rest —
      // no in-popup chooser, direct platform default.
      wireNavigateButton(div, { lat: spot.lat, lon: spot.lon })
      const gmapsBtn = div.querySelector<HTMLElement>("[data-gmaps]")
      if (gmapsBtn) {
        L.DomEvent.on(gmapsBtn, "click", () => void openExternalUrl(mapsUrl))
      }
      const wheelmapBtn = div.querySelector<HTMLElement>("[data-wheelmap]")
      if (wheelmapBtn && wheelmapUrl) {
        L.DomEvent.on(wheelmapBtn, "click", () => void openExternalUrl(wheelmapUrl))
      }
      const showResultsBtn = div.querySelector<HTMLElement>("[data-show-results]")
      if (showResultsBtn) {
        const captured = { osmId: spot.osmId, lat: spot.lat, lon: spot.lon }
        L.DomEvent.on(showResultsBtn, "click", (ev: Event) => {
          L!.DomEvent.stopPropagation(ev)
          onShowAmenityInResultsRef.current?.(captured)
        })
      }

      const marker = L.marker([spot.lat, spot.lon], { icon })
        .bindPopup(div, {
          maxWidth:       240,
          maxHeight:      popupMaxHeight(mapInst.current.getSize().y),
          autoPanPadding: [24, 24],
          className:      "ap-popup",
        })
        .addTo(mapInst.current)
      marker.on("click", () => onAmenityMarkerClick?.({ osmId: spot.osmId, lat: spot.lat, lon: spot.lon }))
      toiletMarkersRef.current.push(marker)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toiletSpots, mapReady, t, amenityType])

  // Update markers when places change. In amenity focus mode the cluster is
  // cleared so only amenity spots and the user dot remain visible.
  useEffect(() => {
    if (!mapInst.current || !L || !placeClusterRef.current) return

    // Cancel any in-flight pan/zoom (e.g. a zoomToShowLayer animation) before
    // mutating cluster layers. Otherwise markercluster's transition-end handler
    // fires after clearLayers/removeLayer and calls hasLayer() on gutted internals
    // → "Cannot use 'in' operator to search for '_leaflet_id' in undefined".
    mapInst.current.stop()

    if (focusMode) {
      placeClusterRef.current.clearLayers()
      markers.current.clear()
      return
    }

    // Remove stale markers
    const currentIds = new Set(places.map((p) => p.id))
    for (const [id, m] of markers.current) {
      if (!currentIds.has(id)) {
        placeClusterRef.current.removeLayer(m)
        markers.current.delete(id)
      }
    }

    // markercluster only resets its internal grid/cluster-tree state (_topClusterLevel,
    // _gridClusters, _gridUnclustered) inside clearLayers() — removing every layer one by
    // one via removeLayer() above (e.g. a fresh search whose results share no place IDs
    // with the previous one) leaves that state stale. The next addLayer() then walks a
    // broken __parent chain and throws "Cannot read properties of undefined (reading
    // '_zoom')". clearLayers() on an already-empty group is a harmless no-op, so this is
    // safe to call unconditionally whenever the group is empty.
    if (markers.current.size === 0) {
      placeClusterRef.current.clearLayers()
    }

    // Add / update markers
    for (const place of places) {
      const isSelected = place.id === selectedId
      const color      = markerColor(place.overallConfidence)
      const emoji      = CATEGORY_ICONS[place.category] ?? "📍"
      const iconHtml   = svgMarker(color, isSelected, emoji)

      const pinW = isSelected ? 41 : 30
      const pinH = isSelected ? 54 : 39
      const icon = L!.divIcon({
        html:        iconHtml,
        className:   "",
        iconSize:    [pinW, pinH],
        iconAnchor:  [pinW / 2, pinH],
        popupAnchor: [0, -pinH],
      })

      const existing = markers.current.get(place.id)
      if (existing) {
        existing.setIcon(icon)
      } else {
        const addr = [place.address.street, place.address.houseNumber, place.address.city]
          .filter(Boolean).join(" ")

        // Build popup content as a real DOM element so L.DomEvent.on can attach
        // the click handler — plain addEventListener and inline onclick both fail
        // on mobile because Leaflet intercepts touchstart on the popup container.
        const div = document.createElement("div")
        div.style.cssText = "font-family:sans-serif;font-size:13px;line-height:1.5"

        const parkingText = (() => {
          const p = place.accessibility.parking
          if (p.value === "yes" && (p.details as { nearbyOnly?: boolean } | undefined)?.nearbyOnly) {
            return t.a11y.yesNearby
          }
          return t.a11y[p.value] ?? p.value
        })()

        const categoryIcon  = CATEGORY_ICONS[place.category] ?? "📍"
        const categoryLabel = (t.categories as Record<string, string>)[place.category] ?? place.category

        const conf      = Math.round(place.overallConfidence * 100)
        const confLabel = t.results.confidence[confidenceLabel(place.overallConfidence)]
        const barColor  = markerColor(place.overallConfidence)
        const ent = place.accessibility.entrance
        const toi = place.accessibility.toilet
        const par = place.accessibility.parking
        const meta = `${categoryIcon} ${esc(categoryLabel)}${addr ? ` · ${esc(addr)}` : ""}`

        const fullContent = `
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding-right:16px">
            <span style="${POPUP_TITLE}">${esc(place.name)}</span>
            <span style="color:${textColor(place.overallConfidence)};font-size:11px;font-weight:700;white-space:nowrap">${conf} % · ${confLabel}</span>
          </div>
          <div style="${POPUP_SUB}">${meta}</div>
          <div style="${POPUP_KV}">
            ${popupRow(t.criteria.entrance, t.a11y[ent.value] ?? ent.value, { color: VALUE_TEXT_COLORS[ent.value], chip: ent.value !== "unknown" ? confidenceChip(ent.confidence, t.map.confidenceShort) : undefined })}
            ${popupRow(t.criteria.toilet,   t.a11y[toi.value] ?? toi.value, { color: VALUE_TEXT_COLORS[toi.value], chip: toi.value !== "unknown" ? confidenceChip(toi.confidence, t.map.confidenceShort) : undefined })}
            ${popupRow(t.criteria.parking,  parkingText,                    { color: VALUE_TEXT_COLORS[par.value], chip: par.value !== "unknown" ? confidenceChip(par.confidence, t.map.confidenceShort) : undefined })}
            ${placeMayNotBeAccessible(place) ? popupNotAccessibleWarning(t) : ""}
          </div>
          <div style="${POPUP_FOOTER}">
            <div style="${POPUP_CHIPS}">
              <button data-show-details style="${POPUP_CHIP_PRIMARY}">${POPUP_INFO_SVG}${esc(t.map.popupChipDetails)}</button>
              <button data-navigate style="${POPUP_CHIP}">${POPUP_NAV_SVG}${t.map.popupChipNavigate}</button>
              ${onShowInResults ? `<button data-show-id style="${POPUP_CHIP}">${POPUP_LIST_SVG}${esc(t.map.popupChipResults)}</button>` : ""}
            </div>
          </div>
        `
        const fullHtml = popupShell(barColor, fullContent)

        // Reduced template (issue #43): criteria collapse to a single
        // icon+checkmark row and only the primary "Details" CTA remains, so
        // the popup stays a couple of lines tall regardless of text scale.
        // No information is lost — it just moves into PlaceDebugSheet, which
        // the same "Details" button already opens (via data-show-details).
        const reducedHtml = popupShell(barColor, `
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding-right:16px">
            <span style="${POPUP_TITLE}">${esc(place.name)}</span>
            <span style="color:${textColor(place.overallConfidence)};font-size:11px;font-weight:700;white-space:nowrap">${conf} %</span>
          </div>
          <div style="display:flex;gap:12px;margin:7px 0 10px">
            ${reducedCriterionBadge("🚪", ent.value)}
            ${reducedCriterionBadge("🚻", toi.value)}
            ${reducedCriterionBadge("🅿", par.value)}
          </div>
          <div style="${POPUP_FOOTER}">
            <button data-show-details style="${POPUP_CHIP_PRIMARY};width:100%;justify-content:center">${POPUP_INFO_SVG}${esc(t.map.popupChipDetails)}</button>
          </div>
        `)

        const mapHeightPx = mapInst.current.getSize().y
        const fullHeightPx = measureContentHeight(fullHtml, 280)
        div.innerHTML = fullHeightPx > mapHeightPx * REDUCED_POPUP_THRESHOLD ? reducedHtml : fullHtml

        const detailsBtn = div.querySelector<HTMLElement>("[data-show-details]")
        if (detailsBtn) {
          const capturedId = place.id
          L!.DomEvent.on(detailsBtn, "click", (ev: Event) => {
            L!.DomEvent.stopPropagation(ev)
            const p = placesRef.current.find((pl) => pl.id === capturedId)
            if (p) setDetailPlace(p)
          })
        }
        wireNavigateButton(div, { lat: place.coordinates.lat, lon: place.coordinates.lon })

        if (onShowInResults) {
          const btn = div.querySelector<HTMLElement>("[data-show-id]")
          if (btn) {
            const capturedId = place.id
            L!.DomEvent.on(btn, "click", (ev: Event) => {
              L!.DomEvent.stopPropagation(ev)
              const p = placesRef.current.find((pl) => pl.id === capturedId)
              if (p) onShowInResultsRef.current?.(p)
            })
          }
        }
        const popup = L!.popup({
          maxWidth:       280,
          maxHeight:      popupMaxHeight(mapHeightPx),
          autoPanPadding: [24, 24],
          className:      "ap-popup",
        }).setContent(div)

        const marker = L!.marker(
          [place.coordinates.lat, place.coordinates.lon],
          // placeConfidence is read by the cluster's iconCreateFunction so the
          // cluster colour reflects the best contained confidence.
          { icon, placeConfidence: place.overallConfidence } as L.MarkerOptions & { placeConfidence: number },
        )
          .bindPopup(popup)
          .on("click", () => onSelect(place))

        placeClusterRef.current.addLayer(marker)
        markers.current.set(place.id, marker)
      }
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, selectedId, mapReady, focusMode])

  // Fit bounds to show all results — runs only when places changes, not on marker click.
  // Separating this from the selectedId effect prevents fitBounds from firing when the
  // user clicks a marker (which changes selectedId but not places).
  useEffect(() => {
    if (!mapInst.current || !L || places.length === 0) return
    if (focusMode) return  // focus-mode fit handled below
    const latlngs: [number, number][] = places.map((p) => [p.coordinates.lat, p.coordinates.lon])
    // Frame the SEARCH area, not the user's GPS dot. After "search here" in nearby
    // mode the search center diverges from the real user location; including the
    // (possibly far-away) dot would zoom out to span both. Fit to results + search
    // center so the searched area stays framed and the distant dot is left out.
    const sc = searchCenterRef.current
    if (sc) latlngs.push([sc.lat, sc.lon])
    lastProgrammaticMoveRef.current = Date.now()
    mapInst.current.fitBounds(L!.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 15 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, mapReady, focusMode])

  // Pan/zoom to selected — also re-fires when panTrigger increments so that
  // clicking the same result after manually panning the map still re-centers.
  // If the marker is currently inside a cluster, zoomToShowLayer animates the
  // map to a zoom level where the marker becomes individually visible, then
  // opens its popup. For uncluttered markers it pans without changing zoom.
  useEffect(() => {
    if (!mapInst.current || !selectedId) return
    const marker = markers.current.get(selectedId)
    if (!marker || !placeClusterRef.current) return
    lastProgrammaticMoveRef.current = Date.now()
    // Refresh the stamp in the callback too: opening the popup can autoPan the map,
    // firing a later moveend after the zoom animation already settled.
    placeClusterRef.current.zoomToShowLayer(marker, () => {
      lastProgrammaticMoveRef.current = Date.now()
      marker.openPopup()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, panTrigger, mapReady])

  // "Zur Karte" from an amenity (parking/WC) result card. Amenity markers are
  // added directly to the map (not clustered), so no zoomToShowLayer dance is
  // needed — just center on the spot and open its popup. mapReady is in the
  // deps for the same reason as the place-selection effect above: on first
  // mobile map mount the container isn't measured yet when this first fires.
  useEffect(() => {
    if (!mapInst.current || !L || !mapReady || !amenityPanTarget) return
    const EPS = 1e-6
    const marker = [...parkingMarkersRef.current, ...toiletMarkersRef.current].find((m) => {
      const ll = m.getLatLng()
      return Math.abs(ll.lat - amenityPanTarget.lat) < EPS && Math.abs(ll.lng - amenityPanTarget.lon) < EPS
    })
    lastProgrammaticMoveRef.current = Date.now()
    mapInst.current.setView([amenityPanTarget.lat, amenityPanTarget.lon], Math.max(mapInst.current.getZoom(), 17))
    if (marker) {
      // Re-stamp: opening the popup can autoPan the map, firing a later moveend
      // after the setView animation already settled.
      lastProgrammaticMoveRef.current = Date.now()
      marker.openPopup()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amenityPanTrigger, mapReady])

  // Pan to center — only when no results (e.g. failed search, initial state, or parking-only view)
  // When parking spots are visible without venue results, fit the view to all spots + GPS location.
  // In focus mode we always fit to spots regardless of how many places exist.
  // Suppressed while a search is in flight: resetting places/spots to [] while loading
  // triggers this effect with the stale center, causing a visible snap-back to the old
  // position before the new result arrives. Let the result's own fitBounds handle it.
  useEffect(() => {
    if (!mapInst.current || !L) return
    if (isLoading) return
    // Did the search center actually change since we last evaluated? Updated on
    // every (non-loading) run so a later mode switch — which keeps the old center
    // but clears places/spots — is correctly seen as "unchanged".
    const centerChanged = !prevCenterRef.current
      || center?.lat !== prevCenterRef.current.lat
      || center?.lon !== prevCenterRef.current.lon
    prevCenterRef.current = center ?? null
    // "Search this area": the user already chose the view — leave the map exactly
    // where it is and only refresh the markers. No fit (avoids the jump to the old
    // spots, then to the new ones).
    if (focusSearchCenter) return
    if (!focusMode && places.length > 0) return
    const amenities = [...(parkingSpots ?? []), ...(toiletSpots ?? [])]
    if (amenities.length > 0) {
      const latlngs: [number, number][] = amenities.map((s) => [s.lat, s.lon])
      // Do NOT include userLocationRef here — the amenity search may be far from
      // the user's GPS position (e.g. parking in München while standing in Berlin).
      // The spots themselves define the correct viewport.
      lastProgrammaticMoveRef.current = Date.now()
      mapInst.current.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 16 })
      return
    }
    if (!center) return
    // Option 1: only recenter on a genuine new search (center changed). A mode
    // switch (e.g. nearby → "search everywhere" with no location yet) clears
    // places/spots but keeps the old center — leave the user's view untouched.
    if (!centerChanged) return
    lastProgrammaticMoveRef.current = Date.now()
    mapInst.current.setView([center.lat, center.lon], 13)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, parkingSpots, toiletSpots, mapReady, focusMode, isLoading, focusSearchCenter])

  // ESC exits fullscreen. Parkplatz-Modus has its own explicit toggle in the
  // ChatPanel, so no keyboard shortcut is needed for it.
  useEffect(() => {
    if (!isFullscreen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onToggleFullscreen()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isFullscreen, onToggleFullscreen])

  // Re-measure and re-center whenever the map container becomes visible.
  // Called for both tab reveals and fullscreen toggles — both change the
  // container dimensions from Leaflet's perspective.
  // We wait one frame for the browser to apply the CSS class, then call
  // invalidateSize so Leaflet knows the real container bounds, then
  // re-apply fitBounds/setView so the second search centers correctly.
  useEffect(() => {
    const isVisible = visible !== false  // default true for non-tab contexts
    if (!isVisible || !mapInst.current || !L) return
    const id = setTimeout(() => {
      mapInst.current?.invalidateSize()
      // Selection-driven reveal (e.g. "show on map" switched to this tab and set
      // selectedId in the same commit): don't fit to all results — that would
      // zoom back out and re-cluster the just-selected marker, closing its popup.
      // Show the selected marker instead. If it isn't built yet (fresh lazy mount,
      // markers not ready 50 ms in), the selection effect above re-fires on
      // mapReady and handles it — so we still skip the fit-to-all either way.
      if (selectedId) {
        const selMarker = placeClusterRef.current ? markers.current.get(selectedId) : undefined
        if (selMarker && placeClusterRef.current) {
          lastProgrammaticMoveRef.current = Date.now()
          placeClusterRef.current.zoomToShowLayer(selMarker, () => {
            lastProgrammaticMoveRef.current = Date.now()
            selMarker.openPopup()
          })
        }
        return
      }
      if (places.length > 0) {
        const latlngs: [number, number][] = places.map((p) => [p.coordinates.lat, p.coordinates.lon])
        // Frame the search area, not the user dot — see the results-fit effect above.
        const sc = searchCenterRef.current
        if (sc) latlngs.push([sc.lat, sc.lon])
        lastProgrammaticMoveRef.current = Date.now()
        mapInst.current?.fitBounds(L!.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 15 })
      } else {
        const spots = [...(parkingSpots ?? []), ...(toiletSpots ?? [])]
        if (spots.length > 0) {
          const latlngs: [number, number][] = spots.map((s) => [s.lat, s.lon])
          // Same reasoning as the primary amenity fit: do not add userLocation.
          lastProgrammaticMoveRef.current = Date.now()
          mapInst.current?.fitBounds(L!.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 16 })
        } else if (center) {
          lastProgrammaticMoveRef.current = Date.now()
          mapInst.current?.setView([center.lat, center.lon], 13)
        }
      }
    }, 50)
    return () => clearTimeout(id)
  // mapReady is included so this runs once the map finishes its async init on a
  // fresh lazy mount: the initial run bails (mapInst null), and `visible` doesn't
  // change when mapReady flips — without this the container is never invalidateSize'd
  // on first mount, so the selection zoom/popup ("show on map") silently fails once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, isFullscreen, mapReady])

  return (
    <div className="relative w-full h-full">
      {/* Named region so AT announces the map and points to the equivalent text
          alternative (the results list) — WCAG 1.1.1 / 1.3.1. Leaflet makes the
          container keyboard-pannable (tabindex) but markers are not individually
          focusable; the list is the conformant equivalent. */}
      <div ref={mapRef} role="region" aria-label={t.map.regionLabel} className="w-full h-full" />

      {showFullscreenToggle && (
        <Button
          size="icon"
          variant="secondary"
          onClick={onToggleFullscreen}
          className={`absolute top-3 right-3 z-[1000] shadow-md transition-opacity ${popupOpen ? "opacity-0 pointer-events-none" : ""}`}
          title={isFullscreen ? t.map.exitFullscreen : t.map.fullscreen}
          aria-label={isFullscreen ? t.map.exitFullscreen : t.map.fullscreen}
        >
          {isFullscreen
            ? <Minimize2 className="w-4 h-4" />
            : <Maximize2 className="w-4 h-4" />
          }
        </Button>
      )}

      {/* Locate button — pan to user's GPS position, then offer "search here".
          Sits left of the fullscreen toggle on desktop; on mobile (no toggle) it
          takes the top-right corner itself. Also shown in amenity focus mode
          (since the amenity chips became first-class search, v8.62): the pan
          combines with the always-available focus "search this area" pill, so
          it no longer risks silently exiting the parking/WC view. */}
      {onLocate && (
        <div className={`absolute top-3 z-[1000] flex flex-col items-end gap-1 transition-opacity ${showFullscreenToggle ? "right-14" : "right-3"} ${popupOpen ? "opacity-0 pointer-events-none" : ""}`}>
          {/* Deliberately neutral (white/grey), never primary blue — the search
              row's own nearby button (ChatPanel) owns blue = "this searches
              now"; this one only pans + arms "Hier suchen" (a second tap is
              still required), so it must not look like a search action. Sized
              up from the plain secondary icon button (was 40px, blended into
              the zoom control) to a larger, bordered, more visible circle —
              still reads as "map navigation", not "search". */}
          <Button
            variant="secondary"
            size="icon"
            onClick={async () => {
              hapticLight()
              setLocating(true)
              setLocateErrorVisible(false)
              try {
                await onLocate()
              } catch {
                setLocateErrorVisible(true)
                setTimeout(() => setLocateErrorVisible(false), 3000)
              } finally {
                setLocating(false)
              }
            }}
            disabled={locating}
            className="w-11 h-11 rounded-full bg-background hover:bg-muted border border-border shadow-lg"
            title={t.map.locate}
            aria-label={t.map.locate}
          >
            {locating
              ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
              : <LocateFixed className="w-5 h-5" aria-hidden />
            }
          </Button>
          {locateErrorVisible && (
            <span className="rounded-md bg-background/95 backdrop-blur-sm border border-border px-2 py-1 text-xs shadow-md text-destructive whitespace-nowrap">
              {t.map.locateError}
            </span>
          )}
        </div>
      )}

      {/* Hidden in amenity focus mode: "search here" re-runs the venue search and
          resets the focus layers, which would silently exit the parking/WC view. */}
      {/* On mobile (hideSearchHereButton) the parent renders this pill inline next
          to the count pill instead — see onPanned. This centred variant is the
          desktop control, where there is no overlapping count pill. */}
      {searchHereCenter && onSearchHere && !focusMode && !hideSearchHereButton && (
        <div className={`absolute top-3 left-1/2 -translate-x-1/2 z-[1000] transition-opacity ${popupOpen ? "opacity-0 pointer-events-none" : ""}`}>
          <button
            onClick={() => {
              hapticLight()
              const map = mapInst.current
              const viewportRadiusKm = map
                ? map.getCenter().distanceTo(map.getBounds().getNorthEast()) / 1000
                : 5
              onSearchHere(searchHereCenter, viewportRadiusKm, searchHereOriginRef.current)
              setSearchHereCenter(null)
            }}
            className="flex items-center gap-1.5 rounded-full border border-border bg-background/95 backdrop-blur-sm px-3 py-1.5 text-sm font-medium shadow-md hover:bg-muted transition-colors"
          >
            <Search className="w-3.5 h-3.5" aria-hidden />
            {t.map.searchHere}
          </button>
        </div>
      )}

      {/* Focus-mode "search this area": always available while focus layers are
          active. Re-fetches the amenity layers at the current map centre, so the
          user can look beyond their GPS radius without leaving focus mode.
          Hidden when hideSearchHereButton (mobile) — the parent renders this
          inline next to the amenity count pill instead (via onPanned), same as
          the venue "search here" pill, so the two can never overlap. */}
      {focusMode && onFocusSearchHere && !hideSearchHereButton && (
        <div className={`absolute top-3 left-1/2 -translate-x-1/2 z-[1000] transition-opacity ${popupOpen ? "opacity-0 pointer-events-none" : ""}`}>
          <button
            onClick={() => {
              const map = mapInst.current
              if (!map) return
              const c = map.getCenter()
              // Radius = centre → viewport corner, so the search circle covers the
              // visible rectangle. The map is NOT recentred (see the focus fit
              // effect) — results refresh for exactly the current view.
              const radiusKm = c.distanceTo(map.getBounds().getNorthEast()) / 1000
              hapticLight()
              onFocusSearchHere({ lat: c.lat, lon: c.lng }, radiusKm)
            }}
            className="flex items-center gap-1.5 rounded-full border border-border bg-background/95 backdrop-blur-sm px-3 py-1.5 text-sm font-medium shadow-md hover:bg-muted transition-colors"
          >
            <Search className="w-3.5 h-3.5" aria-hidden />
            {t.map.searchHereFocus}
          </button>
        </div>
      )}

      {/* ── Bottom row: layer box (left) + marker legend (right), sharing one
          flex-wrap container instead of two independently `absolute`-
          positioned corners. On narrow map widths, where the two used to
          overlap regardless of open/collapsed state (there was never a
          real width conflict to resolve by coupling their open states —
          the default-expanded layers box vs. the default-collapsed legend
          pill already didn't fit side by side), the legend now wraps onto
          its own row below instead. `ml-auto` keeps the legend right-
          aligned whether it's sharing the row or has wrapped alone. ── */}
      <div className="absolute inset-x-3 bottom-3 z-[1000] flex flex-wrap items-start gap-2">
        {/* Layer box: "Ebenen" label + two checkbox-style toggles, grouped in
            one bordered box instead of two loose pills. Deliberately NOT
            styled like the Schnellsuche amenity chips (rounded pills) — the
            checkbox look + shared "layers" label read as "these add an
            overlay to the existing results", vs. the chips' pill look, which
            reads as "this replaces the results with a new search". Same
            widget, same two colours (blue/parking, green/WC) as everywhere
            else disabled parking/WC markers appear, only the container
            differs. Disabled in amenity focus mode (the count there would
            be stale).

            Collapsible (defaults expanded, persisted via layersCollapsed):
            collapsed shows a compact chip per *active* layer only (none for
            an inactive layer) plus a chevron, and — since there are no
            checkboxes left to click while collapsed — the whole compact box
            is itself the expand trigger, not just the chevron. Expanded
            keeps the original checkbox buttons untouched; only the chevron
            toggles collapse there, so tapping a checkbox can't accidentally
            collapse the box. ── */}
        {onSetMapLayers && (
          layersCollapsed ? (
            <button
              type="button"
              aria-disabled={focusMode}
              aria-label={[
                t.map.layersExpand,
                showParking ? t.chat.focusChipParking : null,
                hasToiletData && showToilets ? t.chat.focusChipToilet : null,
              ].filter(Boolean).join(" · ")}
              onClick={toggleLayersCollapsed}
              disabled={focusMode}
              className={`shrink-0 flex items-center gap-1.5 rounded-xl border border-border bg-background/95 backdrop-blur-sm shadow-md px-2.5 py-1.5 ${focusMode ? "opacity-50 pointer-events-none" : "hover:bg-muted transition-colors"}`}
            >
              <Layers className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden />
              {/* Icon-only (no label text) — the button's own aria-label already
                  names which layers are active for screen readers. */}
              {showParking && (
                <span aria-hidden className="flex items-center justify-center w-5 h-5 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-600/10 rounded-full">
                  🅿
                </span>
              )}
              {hasToiletData && showToilets && (
                <span aria-hidden className="flex items-center justify-center w-5 h-5 text-xs font-semibold text-pink-700 dark:text-pink-400 bg-pink-700/10 rounded-full">
                  🚻
                </span>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 rotate-180" aria-hidden />
            </button>
          ) : (
            <div
              aria-disabled={focusMode}
              role="group"
              aria-label={t.map.layersLabel}
              className={`shrink-0 flex items-center gap-2 rounded-xl border border-border bg-background/95 backdrop-blur-sm shadow-md px-2.5 py-1.5 ${focusMode ? "opacity-50 pointer-events-none" : ""}`}
            >
              <span className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground shrink-0">
                <Layers className="w-3.5 h-3.5" aria-hidden />
                {t.map.layersLabel}
              </span>
              <span className="w-px self-stretch bg-border" aria-hidden />
              <span className="flex items-center gap-2.5">
                <button
                  onClick={() => onSetMapLayers(!(showParking ?? false), showToilets ?? false)}
                  aria-pressed={showParking ?? false}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span className={`w-[0.95rem] h-[0.95rem] rounded-[0.2rem] border-[1.5px] flex items-center justify-center shrink-0 transition-colors
                    ${showParking ? "bg-blue-600 border-blue-600" : "border-current"}`}>
                    {showParking && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} aria-hidden />}
                  </span>
                  <span aria-hidden>🅿</span>
                  <span className={showParking ? "text-foreground" : undefined}>{t.chat.focusChipParking}</span>
                </button>
                {hasToiletData && (
                  <button
                    onClick={() => onSetMapLayers(showParking ?? false, !(showToilets ?? false))}
                    aria-pressed={showToilets ?? false}
                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span className={`w-[0.95rem] h-[0.95rem] rounded-[0.2rem] border-[1.5px] flex items-center justify-center shrink-0 transition-colors
                      ${showToilets ? "bg-pink-700 border-pink-700" : "border-current"}`}>
                      {showToilets && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} aria-hidden />}
                    </span>
                    <span aria-hidden>🚻</span>
                    <span className={showToilets ? "text-foreground" : undefined}>{t.chat.focusChipToilet}</span>
                  </button>
                )}
              </span>
              <button
                type="button"
                onClick={toggleLayersCollapsed}
                aria-label={t.map.layersCollapse}
                className="shrink-0 -mr-1 p-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <ChevronDown className="w-3.5 h-3.5" aria-hidden />
              </button>
            </div>
          )
        )}

        {/* Marker legend (collapsible) — shown when parking or WC markers are
            present. `ml-auto` keeps it right-aligned on the shared row, or at
            the row's right edge if it has wrapped onto its own line. */}
        {((parkingSpots?.length ?? 0) > 0 || (toiletSpots?.length ?? 0) > 0) && (
          <div className="shrink-0 ml-auto">
            {legendOpen ? (
              <div className="rounded-lg bg-background/95 backdrop-blur-sm shadow-md border border-border p-2.5 text-xs">
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <span className="font-semibold">{t.map.legend}</span>
                  <button
                    onClick={() => setLegendOpen(false)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t.common.close}
                  >✕</button>
                </div>
                {(parkingSpots?.length ?? 0) > 0 && (<>
                  <div className="flex items-center gap-2 py-0.5">
                    <span dangerouslySetInnerHTML={{ __html: svgParkingMarker("strong") }} />
                    <span>{t.map.legendDisabled}</span>
                  </div>
                  {showWeakParking && (
                    <div className="flex items-center gap-2 py-0.5">
                      <span dangerouslySetInnerHTML={{ __html: svgParkingMarker("weak") }} />
                      <span>{t.map.legendAccessible}</span>
                    </div>
                  )}
                </>)}
                {(toiletSpots ?? []).some((s) => s.host?.kind !== "venue") && (
                  <div className="flex items-center gap-2 py-0.5">
                    <span dangerouslySetInnerHTML={{ __html: svgToiletMarker("standalone") }} />
                    <span>{t.map.legendToiletStandalone ?? "Eigenständiges WC"}</span>
                  </div>
                )}
                {(toiletSpots ?? []).some((s) => s.host?.kind === "venue") && (
                  <div className="flex items-center gap-2 py-0.5">
                    <span dangerouslySetInnerHTML={{ __html: svgToiletMarker("venue") }} />
                    <span>{t.map.legendToiletVenue ?? "WC in Lokalität"}</span>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => setLegendOpen(true)}
                title={t.map.legend}
                aria-label={t.map.legend}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium shadow-md border border-border bg-background/95 backdrop-blur-sm hover:bg-muted transition-colors"
              >
                <span dangerouslySetInnerHTML={{ __html: (parkingSpots?.length ?? 0) > 0 ? svgParkingMarker("strong") : svgToiletMarker("standalone") }} />
                <span>{t.map.legend}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Detail sheet opened from a map popup. Portal overlay — the map underneath
          is untouched, so closing returns to the exact same view. */}
      {detailPlace && createPortal(
        <PlaceDebugSheet place={detailPlace} onClose={() => setDetailPlace(null)} />,
        document.body,
      )}
    </div>
  )
}
