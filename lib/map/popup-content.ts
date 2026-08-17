import { CATEGORY_ICONS } from "@/lib/category-icons"
import type { useTranslations } from "@/lib/i18n"
import type { PlaceJudgment, JudgmentStatus, CriterionKey } from "@/lib/reliability"
import { formatOpeningWhen, closingSoonMinutes, type OpeningStatus } from "@/lib/opening-hours"
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

// Popup header bar/text colour now encodes the JUDGEMENT against active
// filters (v13, docs/plans/reliability-tiers.md decision 5), not the
// reliability tier — a failing place is never shown on the map at all
// (passesFilters already excludes it upstream), so "fail"/"none" share the
// same neutral grey as "unverified": red is retired from the map entirely.
const JUDGMENT_COLORS: Record<JudgmentStatus, string> = {
  pass: "#16a34a", pass_limited: "#d97706", unverified: "#94a3b8", fail: "#94a3b8", none: "#94a3b8",
}
const JUDGMENT_TEXT_COLORS: Record<JudgmentStatus, string> = {
  pass: "#15803d", pass_limited: "#a16207", unverified: "#475569", fail: "#475569", none: "#475569",
}
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
// Small chevron for the quick↔full footer toggle — same stroke weight family
// as the CTA icons above, sized down (11px) to sit comfortably in a one-line
// footer row.
const SVG_CHEVRON       = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`

export const POPUP_D_SVG = { nav: SVG_NAV, info: SVG_INFO, list: SVG_LIST, wheelmap: SVG_WHEELMAP, flag: SVG_FLAG }

function dim(): string {
  return "#8a8072"
}

// Quick view ↔ full view (issue: on small phones a popup can cover 40–90% of
// the map, making it hard to hop between markers or navigate the map at all
// underneath it). Every popup now opens COLLAPSED by default — header row +
// one derived overall-status glyph + a single-line summary — and expands to
// today's full content (address/confidence, warning, all three criteria
// chips, every CTA) only when the footer toggle is tapped. Ported from the
// user-approved "Variante B" of a 3-variant HTML prototype (compared against
// a pill→card morph and a peek-strip→full-sheet version; B won for being the
// least likely to be mistaken for something else while still recognisable as
// a real popup at a glance).
//
// The accordion itself is CSS-driven (app/globals.css, `.ap-pop`/`.ap-pop-full`
// grid-template-rows trick) rather than inline styles like the rest of this
// file — toggling a class and animating it is what CSS transitions are for;
// doing that from inline styles would mean the click handler (MapViewGL.tsx)
// reading and rewriting style properties by hand. The toggle wiring itself,
// and the re-check of whether the now-taller expanded popup still fits
// on-screen (reusing the same edge-avoidance math `openSmartPopup` already
// runs at initial open), also live there — see wirePopupToggle().
function popupShellD(opts: {
  headerColor: string
  headerGlyph: string
  title: string
  quickSummaryHtml: string
  subLineHtml: string
  warnHtml: string
  chipsHtml: string | null
  ctasHtml: string
  moreLabel: string
  lessLabel: string
}): string {
  return `<div class="ap-pop" style="font-family:sans-serif">
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:2px">
      <span style="width:32px;height:32px;border-radius:9px;background:${opts.headerColor};color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;font-weight:800">${opts.headerGlyph}</span>
      <span style="flex:1;min-width:0;font-weight:800;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${opts.title}</span>
    </div>
    <div class="ap-pop-quick" style="font-size:11.5px;color:${dim()};padding:0 0 8px">${opts.quickSummaryHtml}</div>
    <div class="ap-pop-full"><div class="ap-pop-full-inner">
      ${opts.subLineHtml ? `<div style="font-size:12px;margin:0 0 9px">${opts.subLineHtml}</div>` : ""}
      ${opts.warnHtml}
      ${opts.chipsHtml ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:11px">${opts.chipsHtml}</div>` : ""}
      <div style="display:flex;gap:7px;flex-wrap:wrap">${opts.ctasHtml}</div>
    </div></div>
    <button type="button" data-toggle aria-expanded="false" data-more="${esc(opts.moreLabel)}" data-less="${esc(opts.lessLabel)}"
      style="display:flex;align-items:center;justify-content:center;gap:4px;width:100%;border:0;border-radius:8px;background:#f3f4f6;padding:4px 0 3px;margin-top:8px;font-size:10.5px;font-weight:700;color:${dim()};cursor:pointer;font-family:sans-serif">
      <span data-toggle-label>${esc(opts.moreLabel)}</span>${SVG_CHEVRON}
    </button>
  </div>`
}

const OVERALL_GLYPH: Record<string, string> = VALUE_GLYPH
const OVERALL_COLOR: Record<string, string> = VALUE_COLORS

// Row-layout pill, not a one-third-width column (user-prototyped "Variante E":
// docs/prototypes/popup-chip-compactness — value glyph moves inline next to
// the label instead of stacking under it, AND the pill is content-width
// (flex-shrink:0, no flex:1) instead of splitting the row into three equal
// columns. Both changes together are what shrinks the row's height ~57%
// versus the pre-migration column stack; either alone doesn't (a lone
// inline layout at flex:1 width just makes each column shorter *and* wider
// with no net height win once three sit side by side).
function chipD(emoji: string, label: string, value: string): string {
  const color = VALUE_COLORS[value] ?? VALUE_COLORS.unknown
  const glyph = VALUE_GLYPH[value] ?? VALUE_GLYPH.unknown
  return `<span style="display:flex;align-items:center;gap:5px;padding:6px 9px;background:#f4f0ea;border-radius:999px;flex-shrink:0">
    <span style="font-size:13px">${emoji}</span>
    <span style="font-size:11px;color:${dim()};white-space:nowrap">${label}</span>
    <span style="font-size:13px;font-weight:800;color:${color}">${glyph}</span>
  </span>`
}

// `iconOnly` drops the text label (kept as aria-label/title) — used for the
// "results" CTA so venue/parking/WC popups can fit all their CTAs on one row
// instead of wrapping (same prototyping session as chipD above).
function ctaD(svg: string, label: string, primary: boolean, dataAttr: string, iconOnly = false): string {
  const bg = primary ? "#2563eb" : "#f1ede7"
  const ink = primary ? "#fff" : "#201c18"
  const pad = iconOnly ? "8px" : "8px 13px"
  const a11yAttrs = iconOnly ? ` aria-label="${esc(label)}" title="${esc(label)}"` : ""
  return `<button ${dataAttr}${a11yAttrs} style="display:flex;align-items:center;gap:6px;border:0;border-radius:999px;padding:${pad};font-size:12.5px;font-weight:700;cursor:pointer;font-family:sans-serif;background:${bg};color:${ink};white-space:nowrap">${svg}${iconOnly ? "" : esc(label)}</button>`
}

// Plain text link, not a pill — for the parking popup's "report" action,
// which isn't equally weighted with the real CTAs (Navigate/Ergebnisse) and
// was crowding them at this popup's already-narrow max width. Also reads
// less like a primary action than a same-styled button would, which matches
// what it actually is: reporting a data problem, not something most viewers
// of a weak-tier spot will ever tap.
function linkD(label: string, dataAttr: string): string {
  return `<button ${dataAttr} style="display:block;border:0;background:none;padding:0;margin-top:8px;font-size:11.5px;font-weight:600;text-decoration:underline;color:#b45309;cursor:pointer;font-family:sans-serif">${esc(label)}</button>`
}

// Short criterion label for the popup's narrow subline — reuses the same
// shortened WC/Parken labels the chip row already uses (space is tight),
// falling back to the sentence-style label for entrance/seating which have
// no shorter map-specific variant.
function mapCriterionLabel(t: T, key: CriterionKey): string {
  if (key === "toilet")  return t.map.criteriaShortToilet
  if (key === "parking") return t.map.criteriaShortParking
  if (key === "seating") return t.criteria.seating
  return t.criteria.entrance
}

// The popup's own version of the Urteilszeile (JudgmentLine.tsx) — brought
// in here when the separate "Achtung: evtl. nicht barrierefrei" warning box
// was retired (2026-08-02): that box said almost exactly what the judgement
// already communicates, just a second time in a second element. Names the
// affected criteria for every non-"pass" status; "none" (no active filter
// criteria at all) has nothing to judge, so it renders no caption.
function judgmentCaption(t: T, judgment: PlaceJudgment): string | null {
  const names = (keys: CriterionKey[]) => keys.map((k) => mapCriterionLabel(t, k)).join(", ")
  if (judgment.status === "pass")         return t.map.judgmentPass
  if (judgment.status === "pass_limited") return `${t.map.judgmentCaveat} (${names(judgment.limited)})`
  if (judgment.status === "unverified")   return `${t.map.judgmentUnknown} (${names(judgment.unknown)})`
  if (judgment.status === "fail") {
    // verifiedFailed (the "nur manuell verifiziert" gate) doesn't fit
    // CriterionKey/names() — it's a place-level check, not a per-criterion
    // one — so it's appended separately rather than folded into `failed`.
    const parts = [...judgment.failed.map((k) => mapCriterionLabel(t, k)), ...(judgment.verifiedFailed ? [t.criteria.verifiedOnly] : [])]
    return `${t.map.judgmentFail} (${parts.join(", ")})`
  }
  return null // "none"
}

export interface VenuePopupOptions {
  showResults: boolean
  // Judgement against the active venue-search filters (v13) — replaces the
  // old confidence-tier percentage. Computed by the caller (MapViewGL) via
  // lib/reliability's evaluatePlaceJudgment, since that needs the active
  // SearchFilters this file has no access to.
  judgment: PlaceJudgment
}

export function buildVenuePopupHtml(place: Place, t: T, opts: VenuePopupOptions): string {
  const status: JudgmentStatus = opts.judgment.status
  const barColor  = JUDGMENT_COLORS[status]
  const textColor = JUDGMENT_TEXT_COLORS[status]
  const caption = judgmentCaption(t, opts.judgment)
  const addr = [place.address.street, place.address.houseNumber, place.address.city].filter(Boolean).join(" ")
  const emoji = CATEGORY_ICONS[place.category] ?? "📍"

  const ent = place.accessibility.entrance
  const toi = place.accessibility.toilet
  const par = place.accessibility.parking

  const subLine = (caption ? `<span style="font-weight:700;color:${textColor}">${esc(caption)}</span>` : "")
    + (caption && addr ? " · " : "")
    + (addr ? `<span style="color:${dim()}">${esc(addr)}</span>` : "")
  const chips = chipD("🚪", t.criteria.entrance, ent.value) + chipD("🚻", t.map.criteriaShortToilet, toi.value) + chipD("🅿", t.map.criteriaShortParking, par.value)
  const ctas = ctaD(SVG_INFO, t.map.popupChipDetails, true, "data-show-details")
    + ctaD(SVG_NAV, t.map.popupChipNavigate, false, "data-navigate")
    + (opts.showResults ? ctaD(SVG_LIST, t.map.popupChipResults, false, "data-show-id", true) : "")

  // Entrance + toilet only — parking is left out of the one-line summary
  // (still in the full view's chip row) as the least universally relevant of
  // the three at a first glance.
  const quickSummary = `<span style="color:${OVERALL_COLOR[ent.value] ?? OVERALL_COLOR.unknown}">${OVERALL_GLYPH[ent.value] ?? OVERALL_GLYPH.unknown}</span> ${t.criteria.entrance}`
    + ` · <span style="color:${OVERALL_COLOR[toi.value] ?? OVERALL_COLOR.unknown}">${OVERALL_GLYPH[toi.value] ?? OVERALL_GLYPH.unknown}</span> ${t.map.criteriaShortToilet}`

  return popupShellD({
    headerColor: barColor, headerGlyph: emoji, title: esc(place.name),
    quickSummaryHtml: quickSummary,
    subLineHtml: subLine, warnHtml: "", chipsHtml: chips, ctasHtml: ctas,
    moreLabel: t.map.popupMore, lessLabel: t.map.popupLess,
  })
}

export function buildParkingPopupHtml(spot: ParkingSpot | AmenityFeature, t: T, opts: { nearestName?: string; nearestDistM?: number; showResults: boolean }): string {
  const tier: AmenityTier = spot.tier === "weak" ? "weak" : "strong"
  const barColor = tier === "strong" ? "#2979ff" : "#ff9100"
  const title = tier === "weak"
    ? t.map.parkingAccessible
    : spot.capacity != null ? t.map.parkingSpots(spot.capacity) : t.map.parkingSpot

  const parts: string[] = []
  // The "reserved wheelchair space" checkbox only has a clear meaning for a
  // strong-tier spot (☑ Ja — officially designated/marked). For a weak-tier
  // spot there's nothing to check "no" against but the presence of this row
  // itself — a lone "☐ Nein" next to a title that already says "possibly
  // accessible" read as contradicting it, not qualifying it. Dropped
  // entirely for weak; the title alone already carries that nuance.
  if (tier === "strong") parts.push(`<span style="color:#15803d;font-weight:700">☑ ${t.a11y.yes}</span>`)
  if (opts.nearestDistM != null) parts.push(`<span style="color:${dim()}">${t.results.distanceShort(Math.round(opts.nearestDistM))}</span>`)
  const feeText = spot.fee === "no" ? t.map.parkingFree : spot.fee === "yes" ? t.map.parkingPaid : spot.fee
  if (feeText) parts.push(`<span style="color:${spot.fee === "no" ? "#15803d" : dim()}">${esc(feeText)}</span>`)
  const accessText = spot.access === "private" ? t.map.parkingPrivate : spot.access === "customers" ? t.map.parkingCustomers : null
  if (accessText) parts.push(`<span style="color:#b45309">${accessText}</span>`)
  const subLine = parts.join(" · ")
  const nearSub = opts.nearestName
    ? `<div style="font-size:11px;color:${dim()};margin:2px 0 0">${t.map.parkingNearLabel} ${esc(truncateName(opts.nearestName))}</div>`
    : ""
  const reportLink = tier === "weak" ? linkD(t.map.popupChipReport, "data-report") : ""

  const ctas = ctaD(SVG_NAV, t.map.popupChipNavigate, true, "data-navigate")
    + (opts.showResults ? ctaD(SVG_LIST, t.map.popupChipResults, false, "data-show-results", true) : "")

  const overall = tier === "strong" ? "yes" : "limited"
  const quickSummary = `<span style="color:${OVERALL_COLOR[overall]}">${OVERALL_GLYPH[overall]}</span> ${tier === "strong" ? t.map.parkingReservedBadge : t.map.parkingNotReservedBadge}`
    + (feeText ? ` · ${esc(feeText)}` : "")

  // nearSub/reportLink move INSIDE the full view (wrapped into the shell's
  // own accordion body, not appended after it) — both are exactly the kind
  // of secondary detail the quick view is meant to hide.
  return popupShellD({
    headerColor: barColor, headerGlyph: "P", title,
    quickSummaryHtml: quickSummary,
    subLineHtml: subLine, warnHtml: nearSub, chipsHtml: null, ctasHtml: ctas + reportLink,
    moreLabel: t.map.popupMore, lessLabel: t.map.popupLess,
  })
}

// Mirrors OpeningStatusChip's colour/text logic as an HTML fragment — that
// component can't be used here (this module builds plain strings for
// maplibre's DOM-less popup API, not React). Kept deliberately tiny: no icon,
// just colour + text, since the popup quick-summary line is already dense.
function openingStatusQuickHtml(status: OpeningStatus, t: T, locale: "de" | "en"): string {
  if (status.state === "open") {
    return `<span style="color:#15803d;font-weight:700">${t.results.openNow}</span>`
  }
  if (status.state === "closing_soon") {
    return `<span style="color:#b45309;font-weight:700">${t.results.openClosingSoon(closingSoonMinutes(status))}</span>`
  }
  const label = status.opensAt
    ? t.results.openClosed(formatOpeningWhen(status.opensAt, status.refNow, locale))
    : t.results.openClosedPlain
  return `<span style="color:#b91c1c;font-weight:700">${label}</span>`
}

export function buildToiletPopupHtml(spot: AmenityFeature, t: T, opts: { showResults: boolean; wheelmapUrl?: string; openingStatus?: OpeningStatus | null; locale: "de" | "en" }): string {
  const tier: AmenityTier = spot.tier === "weak" ? "weak" : "strong"
  const host = spot.host?.kind === "venue" ? "venue" : "standalone"
  // Same accent for both hosts (matches the pre-migration Leaflet marker's
  // TOILET_HOST_STYLE comment: the venue fill is too light to serve as a
  // popup bar accent on its own, so both intentionally share the magenta).
  const barColor = "#be185d"
  const title = tier === "strong" ? t.map.toiletDesignated : t.map.toiletAccessible

  const parts: string[] = []
  parts.push(`<span style="color:#15803d;font-weight:700">${tier === "strong" ? t.map.toiletDesignatedValue : t.a11y.yes}</span>`)
  if (spot.euroKey) parts.push(`<span style="color:${dim()}">🔑 ${t.map.toiletEuroKey}</span>`)
  if (spot.changingTable) parts.push(`<span style="color:${dim()}">👶 ${t.map.toiletChangingTable}</span>`)
  const isCustomers = spot.host?.access === "customers" || spot.access === "customers"
  if (isCustomers) parts.push(`<span style="color:#b45309">${t.map.toiletCustomers}</span>`)
  if (host === "venue") parts.push(`<span style="color:${dim()}">🏢 ${spot.host?.name ? esc(truncateName(spot.host.name)) : t.map.toiletVenueGeneric}</span>`)
  const subLine = parts.join(" · ")

  const ctas = ctaD(SVG_NAV, t.map.popupChipNavigate, true, "data-navigate")
    + (opts.wheelmapUrl ? ctaD(SVG_WHEELMAP, t.map.popupChipWheelmap, false, "data-wheelmap") : "")
    + (opts.showResults ? ctaD(SVG_LIST, t.map.popupChipResults, false, "data-show-results", true) : "")

  // A displayed WC is always at least "accessible" by construction (that's
  // what the search filters for) — ✓ green regardless of tier. The euro-key
  // requirement is the one thing worth surfacing at a glance even so (issue:
  // arriving without a 🔑 you can't actually use it), so it rides along in
  // the quick summary rather than being buried a tap away. Opening status
  // (when the caller supplied one — active WC search only, see the type
  // comment) leads the line: whether the WC is reachable AT ALL right now
  // matters more than its accessibility tier, and burying it a tap away
  // behind "Mehr" defeats the point of surfacing it.
  const quickSummary =
    (opts.openingStatus ? `${openingStatusQuickHtml(opts.openingStatus, t, opts.locale)} · ` : "")
    + `<span style="color:${OVERALL_COLOR.yes}">${OVERALL_GLYPH.yes}</span> ${tier === "strong" ? t.map.toiletDesignatedValue : t.a11y.yes}`
    + (spot.euroKey ? ` · 🔑 ${t.map.toiletEuroKey}` : "")

  return popupShellD({
    headerColor: barColor, headerGlyph: "🚻", title,
    quickSummaryHtml: quickSummary,
    subLineHtml: subLine, warnHtml: "", chipsHtml: null, ctasHtml: ctas,
    moreLabel: t.map.popupMore, lessLabel: t.map.popupLess,
  })
}
