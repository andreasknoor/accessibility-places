import { PARKING_STRONG, PARKING_WEAK, PARKING_WEAK_TEXT, TOILET_STRONG, TOILET_TINT, RESTROOM_GLYPH } from "@/lib/amenities/badge-scene"
import { glyphSvgString } from "@/lib/amenities/glyph-svg"
import { CATEGORY_ICONS } from "@/lib/category-icons"
import type { useTranslations } from "@/lib/i18n"
import type { PlaceJudgment, JudgmentStatus, CriterionKey } from "@/lib/reliability"
import { quickstartHeadline } from "@/lib/simple-view"
import { formatOpeningWhen, closingSoonMinutes, type OpeningStatus } from "@/lib/opening-hours"
import type { A11yValue, Place, ParkingSpot, AmenityFeature, AmenityTier } from "@/lib/types"

// Map popup templates — plain HTML strings (MapLibre popups are not React),
// wired up in MapViewGL.tsx via data-* attributes. Unified place UI
// (see CLAUDE.md): same
// palette, status discs, criterion glyphs, verdict wording and button styles
// as the result cards and the detail view; one state, no more/less toggle.
//
// XSS rule: every OSM-sourced string (names, fees, access values, …) goes
// through esc() — OSM is publicly editable. i18n strings and numbers are
// trusted.
//
// Default (filled blue) action per popup: place → "Details"; parking and WC →
// "Route" (deliberate exceptions: they have no detail view, getting there is
// their whole point). Route and every link to an external website (Wheelmap)
// carry the ↗ arrow, like the React surfaces (components/ui/external-mark.tsx).

type T = ReturnType<typeof useTranslations>

// Header tile tint follows the PIN colour (lib/map/marker-images.ts), so the
// popup visibly belongs to the marker it opened from.
const TILE_TINT: Record<JudgmentStatus, string> = {
  pass: "#dcfce7", pass_limited: "#fef3c7", unverified: "#f1f5f9", fail: "#f1f5f9", none: "#f1f5f9",
}
const VERDICT_TEXT: Record<JudgmentStatus, string> = {
  pass: "#15803d", pass_limited: "#15803d", unverified: "#b45309", fail: "#b91c1c", none: "#475569",
}
const STATUS_BG: Record<A11yValue, string> = { yes: "#16a34a", limited: "#d97706", no: "#dc2626", unknown: "#94a3b8" }
const FG = "#0f172a"
const MUTED = "#64748b"
const PRIMARY = "#2563eb"
const PRIMARY_STRONG = "#1d4ed8"
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

const POPUP_NAME_MAX_LEN = 28
// Only for the short "bei <Ort>" reference inside a sentence — titles clamp to
// two lines via CSS instead of being cut.
function truncateName(name: string, max = POPUP_NAME_MAX_LEN): string {
  return name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name
}

const svg = (inner: string, size = 15, sw = 2.4) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
const SVG_NAV      = svg(`<polygon points="3 11 22 2 13 21 11 13 3 11"/>`)
const SVG_ARROW    = svg(`<path d="M7 7h10v10"/><path d="M7 17 17 7"/>`, 12, 2.6)
const SVG_LIST     = svg(`<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>`)
const SVG_WHEELMAP = svg(`<circle cx="16" cy="4" r="1"/><path d="m18 19 1-7-6 1"/><path d="m5 8 3-3 5.5 3-2.36 3.5"/><path d="M4.24 14.5a5 5 0 0 0 6.88 6"/><path d="M13.76 17.5a5 5 0 0 0-6.88-6"/>`)
const SVG_FLAG     = svg(`<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>`, 13)
const SVG_DOOR     = svg(`<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z"/>`, 15, 2)

// Same status shapes as components/simple/CriterionIcon.tsx (✓ ! ✕ ?), as a
// filled disc — distinguishable by silhouette, not only by colour.
const STATUS_GLYPH: Record<A11yValue, string> = {
  yes:     `<polyline points="20 6 9 17 4 12"/>`,
  limited: `<line x1="12" y1="7" x2="12" y2="13"/><circle cx="12" cy="16.5" r="0.75" fill="currentColor" stroke="none"/>`,
  no:      `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
  unknown: `<path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.3c-.9.4-1.4 1-1.4 1.9"/><circle cx="12" cy="17" r="0.75" fill="currentColor" stroke="none"/>`,
}
function statusDisc(value: A11yValue, size: number): string {
  return `<span aria-hidden="true" style="display:inline-grid;place-items:center;width:${size}px;height:${size}px;border-radius:50%;background:${STATUS_BG[value]};color:#fff;flex-shrink:0">${svg(STATUS_GLYPH[value], Math.round(size * 0.6), 3)}</span>`
}

type PopupCriterion = "entrance" | "toilet" | "parking"
function criterionGlyph(kind: PopupCriterion, value: A11yValue): string {
  const inner = kind === "entrance"
    ? SVG_DOOR
    : kind === "toilet"
      ? glyphSvgString(RESTROOM_GLYPH, 15)
      : `<span style="border:1.6px solid currentColor;border-radius:4px;padding:0 3px;font-size:10px;line-height:13px;font-weight:800">P</span>`
  return `<span aria-hidden="true" style="position:relative;display:inline-grid;place-items:center;width:26px;height:26px;border-radius:8px;background:#f1f5f9;color:#334155;flex-shrink:0">${inner}<span style="position:absolute;right:-4px;bottom:-4px;border-radius:50%;box-shadow:0 0 0 2px #fff;display:inline-flex">${statusDisc(value, 14)}</span></span>`
}

function button(opts: { label: string; html: string; dataAttr: string; primary: boolean; iconOnly?: boolean; ariaLabel?: string }): string {
  const bg = opts.primary ? PRIMARY : "#eff4ff"
  const ink = opts.primary ? "#fff" : PRIMARY_STRONG
  const flex = opts.iconOnly ? "flex:0 0 38px" : "flex:1 1 0;min-width:0"
  const aria = opts.ariaLabel ?? (opts.iconOnly ? opts.label : undefined)
  return `<button type="button" ${opts.dataAttr}${aria ? ` aria-label="${esc(aria)}" title="${esc(opts.iconOnly ? opts.label : aria)}"` : ""} style="${flex};display:inline-flex;align-items:center;justify-content:center;gap:5px;border:0;border-radius:11px;padding:8px 6px;font:600 13px ${FONT};cursor:pointer;background:${bg};color:${ink};white-space:nowrap">${opts.html}</button>`
}

function routeButton(t: T, primary: boolean): string {
  return button({
    label: t.place.route,
    html: `${SVG_NAV}${esc(t.place.route)}${SVG_ARROW}`,
    dataAttr: "data-navigate",
    primary,
    ariaLabel: `${t.place.route} (${t.place.opensExternalApp})`,
  })
}

function listButton(t: T, dataAttr: string): string {
  return button({ label: t.map.popupChipResults, html: SVG_LIST, dataAttr, primary: false, iconOnly: true })
}

function shell(inner: string): string {
  // padding-right clears MapLibre's own close button (globals.css).
  return `<div class="ap-pop" style="font-family:${FONT};width:276px;max-width:100%;color:${FG}">${inner}</div>`
}

function header(opts: { tile: string; tileBg: string; tileInk?: string; title: string; meta: string; asButton?: string }): string {
  const content = `<span aria-hidden="true" style="width:38px;height:38px;border-radius:11px;background:${opts.tileBg};color:${opts.tileInk ?? FG};display:grid;place-items:center;flex-shrink:0;font-size:19px;font-weight:800">${opts.tile}</span>
      <span style="flex:1;min-width:0;text-align:left">
        <span style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:700;font-size:15px;line-height:1.25">${opts.title}</span>
        ${opts.meta ? `<span style="display:block;font-size:12px;color:${MUTED};margin-top:1px">${opts.meta}</span>` : ""}
      </span>`
  const layout = "display:flex;gap:10px;align-items:flex-start;padding-right:26px"
  return opts.asButton
    ? `<button type="button" ${opts.asButton} style="${layout};width:100%;border:0;background:none;padding-left:0;padding-top:0;padding-bottom:0;cursor:pointer;color:inherit;font:inherit">${content}</button>`
    : `<div style="${layout}">${content}</div>`
}

function verdictLine(value: A11yValue, color: string, headline: string, note?: string): string {
  return `<div style="display:flex;gap:7px;align-items:flex-start;margin-top:10px;font-size:13.5px;font-weight:650;line-height:1.3;color:${color}">
    ${statusDisc(value, 19)}
    <span>${headline}${note ? `<span style="display:block;font-weight:400;color:${MUTED};font-size:12px;margin-top:1px">${note}</span>` : ""}</span>
  </div>`
}

function actions(html: string): string {
  return `<div style="display:flex;gap:8px;margin-top:12px">${html}</div>`
}

// ─── Place ──────────────────────────────────────────────────────────────────

// Same criterion names as the result card and detail view ("Toilette",
// "Parkplatz") — not the map's former short forms ("WC", "Parken").
function mapCriterionLabel(t: T, key: CriterionKey): string {
  return t.criteria[key]
}

export interface VenuePopupOptions {
  showResults: boolean
  judgment:    PlaceJudgment
  // Verdict wording follows the active mode, identical to the result card
  // and detail view: Quickstart's fixed headline, or Expert's
  // "Erfüllt deine N Kriterien" against the active filters.
  mode?:        "quickstart" | "expert"
  activeCount?: number
}

export function buildVenuePopupHtml(place: Place, t: T, opts: VenuePopupOptions): string {
  const { judgment } = opts
  const status = judgment.status
  const mode = opts.mode ?? "expert"
  const category = (t.categories as Record<string, string>)[place.category] ?? place.category
  const names = (keys: CriterionKey[]) => t.results.joinCriteria(keys.map((k) => mapCriterionLabel(t, k)))

  let headline: string
  let note: string | undefined
  if (mode === "quickstart") {
    headline = quickstartHeadline(t, status)
  } else if (status === "none") {
    headline = t.results.judgmentNone
  } else if (status === "unverified") {
    headline = t.results.judgmentUnverified
    note = t.results.judgmentUnverifiedNote(names(judgment.unknown))
  } else {
    const parts = status === "fail" ? t.results.judgmentFail(opts.activeCount ?? 0) : t.results.judgmentPass(opts.activeCount ?? 0)
    headline = `${parts.pre}${parts.criteria}${parts.post}`
    if (status === "pass_limited") note = t.results.judgmentPassLimitedNote(names(judgment.limited))
    if (status === "fail") note = t.results.judgmentFailNote(t.results.joinCriteria([
      ...judgment.failed.map((k) => mapCriterionLabel(t, k)),
      ...(judgment.verifiedFailed ? [t.criteria.verifiedOnly] : []),
    ]))
  }
  const discValue: A11yValue = status === "pass" || status === "pass_limited" ? "yes" : status === "fail" ? "no" : "unknown"

  const crit = (kind: PopupCriterion, label: string) =>
    `<span style="display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:#334155">${criterionGlyph(kind, place.accessibility[kind].value)}${esc(label)}</span>`

  return shell(`
    ${header({
      tile: CATEGORY_ICONS[place.category] ?? "📍",
      tileBg: TILE_TINT[status],
      title: esc(place.name),
      meta: esc(category),
      asButton: `data-show-details aria-label="${esc(t.results.openDetails(place.name))}"`,
    })}
    ${verdictLine(discValue, VERDICT_TEXT[status], headline, note)}
    <div style="display:flex;gap:10px;margin-top:10px">
      ${crit("entrance", t.criteria.entrance)}${crit("toilet", t.criteria.toilet)}${crit("parking", t.criteria.parking)}
    </div>
    ${actions(
      button({ label: t.place.details, html: esc(t.place.details), dataAttr: "data-show-details", primary: true })
      + routeButton(t, false)
      + (opts.showResults ? listButton(t, "data-show-id") : ""),
    )}
  `)
}

// ─── Parking ────────────────────────────────────────────────────────────────

export function buildParkingPopupHtml(spot: ParkingSpot | AmenityFeature, t: T, opts: { nearestName?: string; nearestDistM?: number; showResults: boolean }): string {
  const tier: AmenityTier = spot.tier === "weak" ? "weak" : "strong"
  const title = tier === "weak"
    ? t.map.parkingAccessible
    : spot.capacity != null ? t.map.parkingSpots(spot.capacity) : t.map.parkingSpot

  const meta: string[] = []
  const feeText = spot.fee === "no" ? t.map.parkingFree : spot.fee === "yes" ? t.map.parkingPaid : spot.fee
  if (feeText) meta.push(`<span style="color:${spot.fee === "no" ? "#15803d" : MUTED};font-weight:${spot.fee === "no" ? 600 : 400}">${esc(feeText)}</span>`)
  const accessText = spot.access === "private" ? t.map.parkingPrivate : spot.access === "customers" ? t.map.parkingCustomers : null
  if (accessText) meta.push(`<span style="color:#b45309;font-weight:600">${accessText}</span>`)

  const near = [
    opts.nearestDistM != null ? t.results.distanceShort(Math.round(opts.nearestDistM)) : null,
    opts.nearestName ? `${t.map.parkingNearLabel} ${esc(truncateName(opts.nearestName))}` : null,
  ].filter(Boolean).join(" · ")

  const report = tier === "weak"
    ? `<button type="button" data-report style="display:inline-flex;align-items:center;gap:5px;border:0;background:none;padding:0;margin-top:9px;font:500 12.5px ${FONT};color:${PRIMARY_STRONG};cursor:pointer">${SVG_FLAG}${esc(t.map.parkingReportButton)}</button>`
    : ""

  return shell(`
    ${header({
      tile: "P",
      tileBg: tier === "strong" ? PARKING_STRONG : PARKING_WEAK,
      tileInk: tier === "strong" ? "#fff" : PARKING_WEAK_TEXT,
      title,
      meta: meta.join(" · "),
    })}
    ${verdictLine(tier === "strong" ? "yes" : "limited", tier === "strong" ? "#15803d" : "#b45309", tier === "strong" ? t.map.parkingReservedLabel : t.map.parkingNotReservedBadge, near || undefined)}
    ${actions(routeButton(t, true) + (opts.showResults ? listButton(t, "data-show-results") : ""))}
    ${report}
  `)
}

// ─── WC ─────────────────────────────────────────────────────────────────────

function openingStatusHtml(status: OpeningStatus, t: T, locale: "de" | "en"): string {
  if (status.state === "open") return `<span style="color:#15803d;font-weight:600">${t.results.openNow}</span>`
  if (status.state === "closing_soon") return `<span style="color:#b45309;font-weight:600">${t.results.openClosingSoon(closingSoonMinutes(status))}</span>`
  const label = status.opensAt
    ? t.results.openClosed(formatOpeningWhen(status.opensAt, status.refNow, locale))
    : t.results.openClosedPlain
  return `<span style="color:#b91c1c;font-weight:600">${label}</span>`
}

export function buildToiletPopupHtml(spot: AmenityFeature, t: T, opts: { showResults: boolean; wheelmapUrl?: string; openingStatus?: OpeningStatus | null; locale: "de" | "en" }): string {
  const tier: AmenityTier = spot.tier === "weak" ? "weak" : "strong"
  const hostedByVenue = spot.host?.kind === "venue"

  const meta: string[] = []
  if (opts.openingStatus) meta.push(openingStatusHtml(opts.openingStatus, t, opts.locale))
  if (hostedByVenue) meta.push(esc(spot.host?.name ? truncateName(spot.host.name) : t.map.toiletVenueGeneric))
  if (spot.host?.access === "customers" || spot.access === "customers") meta.push(`<span style="color:#b45309;font-weight:600">${t.map.toiletCustomers}</span>`)

  const tags = [spot.euroKey && `🔑 ${t.map.toiletEuroKey}`, spot.changingTable && `👶 ${t.map.toiletChangingTable}`].filter(Boolean) as string[]
  const tagHtml = tags.length
    ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:9px">${tags.map((x) => `<span style="font-size:12px;background:#f1f5f9;border-radius:999px;padding:3px 9px;color:#334155">${x}</span>`).join("")}</div>`
    : ""

  return shell(`
    ${header({
      tile: glyphSvgString(RESTROOM_GLYPH, 20),
      tileBg: TOILET_TINT,
      tileInk: TOILET_STRONG,
      title: tier === "strong" ? t.map.toiletDesignated : t.map.toiletAccessible,
      meta: meta.join(" · "),
    })}
    ${verdictLine("yes", "#15803d", tier === "strong" ? t.map.toiletDesignatedValue : t.map.toiletAccessibleValue)}
    ${tagHtml}
    ${actions(
      routeButton(t, true)
      + (opts.wheelmapUrl ? button({
        label: t.map.popupChipWheelmap,
        html: `${SVG_WHEELMAP}${esc(t.map.popupChipWheelmap)}${SVG_ARROW}`,
        dataAttr: "data-wheelmap",
        primary: false,
        ariaLabel: `${t.map.popupChipWheelmap} ${t.place.opensInBrowser}`,
      }) : "")
      + (opts.showResults ? listButton(t, "data-show-results") : ""),
    )}
  `)
}
