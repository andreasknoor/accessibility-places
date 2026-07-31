import { confidenceLabel, placeMayNotBeAccessible } from "@/lib/matching/merge"
import { CATEGORY_ICONS } from "@/lib/category-icons"
import type { useTranslations } from "@/lib/i18n"
import type { Place, ParkingSpot, AmenityFeature, AmenityTier } from "@/lib/types"

// Unified "D" popup design (map-elements redesign prototype) — one template
// for venue / parking / WC popups instead of the pre-migration full+reduced
// split. Header icon + title, a status/address subline, criteria chips where
// the LABEL is text but the VALUE is a glyph (reads faster, holds up at
// large-text scale — the user's explicit correction during prototyping), then
// equally-weighted CTA buttons. Ported into the real app from the local
// prototype (scratchpad/map-elements-redesign.html popupShellD/chipD/ctaD),
// wired to real i18n and real place/spot data instead of prototype sample data.
//
// Value glyphs use plain Unicode (✓ ✗ ± ?) rather than hand-authored SVG path
// data — the prototype used lucide-react's runtime icon lookup, which isn't
// available here without a rendering step; Unicode avoids fabricating lucide
// path coordinates for icons (CircleAlert, CircleHelp) that weren't already
// present as verified constants in the Leaflet popups.

type T = ReturnType<typeof useTranslations>

const CONFIDENCE_COLORS = { high: "#00c853", medium: "#ffd600", low: "#ff1744" }
const CONFIDENCE_TEXT_COLORS = { high: "#15803d", medium: "#a16207", low: "#dc2626" }
const VALUE_COLORS: Record<string, string> = { yes: "#16a34a", limited: "#d97706", no: "#dc2626", unknown: "#a1a1aa" }
const VALUE_GLYPH: Record<string, string> = { yes: "✓", limited: "±", no: "✗", unknown: "?" }

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

const POPUP_NAME_MAX_LEN = 24
function truncateName(name: string, max = POPUP_NAME_MAX_LEN): string {
  return name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name
}

// Hand-copied lucide-react SVG paths (same convention as the pre-migration
// Leaflet popup constants) — kept to the icons already verified there.
const SVG_NAV        = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>`
const SVG_INFO        = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`
const SVG_LIST         = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/></svg>`
const SVG_WHEELMAP    = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="4" r="1"/><path d="m18 19 1-7-6 1"/><path d="m5 8 3-3 5.5 3-2.36 3.5"/><path d="M4.24 14.5a5 5 0 0 0 6.88 6"/><path d="M13.76 17.5a5 5 0 0 0-6.88-6"/></svg>`
const SVG_FLAG         = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`
const SVG_WARN          = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`

export const POPUP_D_SVG = { nav: SVG_NAV, info: SVG_INFO, list: SVG_LIST, wheelmap: SVG_WHEELMAP, flag: SVG_FLAG }

function dim(): string {
  return "#8a8072"
}

function shellD(headerColor: string, headerGlyph: string, title: string, subLineHtml: string, chipsHtml: string | null, ctasHtml: string): string {
  return `<div style="font-family:sans-serif;width:278px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:3px">
      <span style="width:32px;height:32px;border-radius:9px;background:${headerColor};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px">${headerGlyph}</span>
      <span style="font-weight:800;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</span>
    </div>
    ${subLineHtml ? `<div style="font-size:12px;margin:0 0 9px 42px">${subLineHtml}</div>` : ""}
    ${chipsHtml ? `<div style="display:flex;gap:7px;margin-bottom:11px">${chipsHtml}</div>` : ""}
    <div style="display:flex;gap:7px;flex-wrap:wrap">${ctasHtml}</div>
  </div>`
}

function chipD(emoji: string, label: string, value: string): string {
  const color = VALUE_COLORS[value] ?? VALUE_COLORS.unknown
  const glyph = VALUE_GLYPH[value] ?? VALUE_GLYPH.unknown
  return `<span style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;padding:7px 3px;background:#f4f0ea;border-radius:9px">
    <span style="font-size:16px;line-height:1">${emoji}</span>
    <span style="font-size:10.5px;color:${dim()};white-space:nowrap">${label}</span>
    <span style="font-size:15px;font-weight:800;color:${color};line-height:1">${glyph}</span>
  </span>`
}

function ctaD(svg: string, label: string, primary: boolean, dataAttr: string): string {
  const bg = primary ? "#2563eb" : "#f1ede7"
  const ink = primary ? "#fff" : "#201c18"
  return `<button ${dataAttr} style="display:flex;align-items:center;gap:6px;border:0;border-radius:999px;padding:8px 13px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:sans-serif;background:${bg};color:${ink};white-space:nowrap">${svg}${esc(label)}</button>`
}

function notAccessibleWarning(t: T): string {
  return `<div style="display:flex;align-items:flex-start;gap:5px;margin-top:8px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:6px 8px;font-size:10.5px;color:#b91c1c;line-height:1.45">${SVG_WARN}<span>${t.results.notAccessibleWarningPre}<b>${t.results.notAccessibleWarningBold}</b>${t.results.notAccessibleWarningPost}</span></div>`
}

export interface VenuePopupOptions {
  showResults: boolean
}

export function buildVenuePopupHtml(place: Place, t: T, opts: VenuePopupOptions): string {
  const level = confidenceLabel(place.overallConfidence)
  const barColor  = CONFIDENCE_COLORS[level]
  const textColor = CONFIDENCE_TEXT_COLORS[level]
  const pct = Math.round(place.overallConfidence * 100)
  const confLabel = t.results.confidence[level]
  const addr = [place.address.street, place.address.houseNumber, place.address.city].filter(Boolean).join(" ")
  const emoji = CATEGORY_ICONS[place.category] ?? "📍"

  const ent = place.accessibility.entrance
  const toi = place.accessibility.toilet
  const par = place.accessibility.parking

  const subLine = `<span style="font-weight:700;color:${textColor}">${pct}%</span> · <span style="color:${dim()}">${confLabel}</span>${addr ? ` · <span style="color:${dim()}">${esc(addr)}</span>` : ""}`
  const chips = chipD("🚪", t.criteria.entrance, ent.value) + chipD("🚻", t.criteria.toilet, toi.value) + chipD("🅿", t.criteria.parking, par.value)
  const ctas = ctaD(SVG_INFO, t.map.popupChipDetails, true, "data-show-details")
    + ctaD(SVG_NAV, t.map.popupChipNavigate, false, "data-navigate")
    + (opts.showResults ? ctaD(SVG_LIST, t.map.popupChipResults, false, "data-show-id") : "")

  const warn = placeMayNotBeAccessible(place) ? notAccessibleWarning(t) : ""
  return shellD(barColor, emoji, esc(place.name), subLine + warn, chips, ctas)
}

export function buildParkingPopupHtml(spot: ParkingSpot | AmenityFeature, t: T, opts: { nearestName?: string; nearestDistM?: number; showResults: boolean }): string {
  const tier: AmenityTier = spot.tier === "weak" ? "weak" : "strong"
  const barColor = tier === "strong" ? "#2979ff" : "#ff9100"
  const title = tier === "weak"
    ? t.map.parkingAccessible
    : spot.capacity != null ? t.map.parkingSpots(spot.capacity) : t.map.parkingSpot

  const parts: string[] = []
  parts.push(tier === "weak"
    ? `<span style="color:#b45309;font-weight:700">☐ ${t.a11y.no}</span>`
    : `<span style="color:#15803d;font-weight:700">☑ ${t.a11y.yes}</span>`)
  if (opts.nearestDistM != null) parts.push(`<span style="color:${dim()}">${t.results.distanceShort(Math.round(opts.nearestDistM))}</span>`)
  const feeText = spot.fee === "no" ? t.map.parkingFree : spot.fee === "yes" ? t.map.parkingPaid : spot.fee
  if (feeText) parts.push(`<span style="color:${spot.fee === "no" ? "#15803d" : dim()}">${esc(feeText)}</span>`)
  const accessText = spot.access === "private" ? t.map.parkingPrivate : spot.access === "customers" ? t.map.parkingCustomers : null
  if (accessText) parts.push(`<span style="color:#b45309">${accessText}</span>`)
  const subLine = parts.join(" · ")
  const nearSub = opts.nearestName
    ? `<div style="font-size:11px;color:${dim()};margin:2px 0 0 42px">${t.map.parkingNearLabel} ${esc(truncateName(opts.nearestName))}</div>`
    : ""

  const ctas = ctaD(SVG_NAV, t.map.popupChipNavigate, true, "data-navigate")
    + (opts.showResults ? ctaD(SVG_LIST, t.map.popupChipResults, false, "data-show-results") : "")
    + (tier === "weak" ? ctaD(SVG_FLAG, t.map.popupChipReport, false, "data-report") : "")

  return shellD(barColor, "P", title, subLine, null, ctas) + nearSub
}

export function buildToiletPopupHtml(spot: AmenityFeature, t: T, opts: { showResults: boolean; wheelmapUrl?: string }): string {
  const tier: AmenityTier = spot.tier === "weak" ? "weak" : "strong"
  const host = spot.host?.kind === "venue" ? "venue" : "standalone"
  const barColor = host === "standalone" ? "#be185d" : "#be185d"
  const title = tier === "strong" ? (t.map.toiletDesignated ?? "Rollstuhl-WC") : (t.map.toiletAccessible ?? "Barrierefreies WC")

  const parts: string[] = []
  parts.push(`<span style="color:#15803d;font-weight:700">${tier === "strong" ? (t.map.toiletDesignatedValue ?? "Designiert") : t.a11y.yes}</span>`)
  if (spot.euroKey) parts.push(`<span style="color:${dim()}">🔑 ${t.map.toiletEuroKey ?? "Euroschlüssel"}</span>`)
  if (spot.changingTable) parts.push(`<span style="color:${dim()}">👶 ${t.map.toiletChangingTable ?? "Wickeltisch"}</span>`)
  const isCustomers = spot.host?.access === "customers" || spot.access === "customers"
  if (isCustomers) parts.push(`<span style="color:#b45309">${t.map.toiletCustomers ?? "Nur für Gäste"}</span>`)
  if (host === "venue") parts.push(`<span style="color:${dim()}">🏢 ${spot.host?.name ? esc(truncateName(spot.host.name)) : (t.map.toiletVenueGeneric ?? "Lokalität")}</span>`)
  const subLine = parts.join(" · ")

  const ctas = ctaD(SVG_NAV, t.map.popupChipNavigate, true, "data-navigate")
    + (opts.wheelmapUrl ? ctaD(SVG_WHEELMAP, t.map.popupChipWheelmap, false, "data-wheelmap") : "")
    + (opts.showResults ? ctaD(SVG_LIST, t.map.popupChipResults, false, "data-show-results") : "")

  return shellD(barColor, "🚻", title, subLine, null, ctas)
}
