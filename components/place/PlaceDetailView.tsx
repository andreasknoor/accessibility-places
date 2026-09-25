"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  AlertTriangle, Award, ChevronDown, Clock, Copy, ExternalLink, Flag, Globe, Mail,
  Map as MapIcon, MapPin, MessageSquare, PenLine, Phone, Share2, ShieldCheck, Accessibility, Braces,
} from "lucide-react"
import CriterionGlyph, { type CriterionKind } from "@/components/place/CriterionGlyph"
import { ReliabilityDots, VALUE_TEXT, criterionValueLabel } from "@/components/place/CriterionItem"
import QuickstartVerdict from "@/components/place/QuickstartVerdict"
import { ACTION_TILE, ACTION_TILE_DISABLED } from "@/components/place/action-styles"
import JudgmentLine from "@/components/results/JudgmentLine"
import OpeningStatusChip from "@/components/results/OpeningStatusChip"
import { NativeLink } from "@/components/ui/native-link"
import NavigateButton from "@/components/ui/navigate-button"
import { usePlaceImage } from "@/hooks/usePlaceImage"
import { useResolvedAddress } from "@/hooks/useResolvedAddress"
import { track } from "@/lib/analytics"
import { CATEGORY_ICONS } from "@/lib/category-icons"
import { SOURCE_LABELS, APP_VERSION, TALLY_DATA_ERROR_FORMS } from "@/lib/config"
import { useTranslations, useLocale } from "@/lib/i18n"
import { hapticLight, hapticSuccess } from "@/lib/native/haptics"
import { shareOrCopy } from "@/lib/native/share"
import { useOpeningStatus, extractRawOpeningHours } from "@/lib/opening-hours"
import { buildPlaceDeepLink } from "@/lib/place-link"
import { attrVerifiedAt, criterionTier, evaluatePlaceJudgment, type JudgmentFilters } from "@/lib/reliability"
import { criterionSentence, quickstartJudgmentFilters } from "@/lib/simple-view"
import { openTallyPopup } from "@/lib/tally"
import { cn } from "@/lib/utils"
import type { AccessibilityAttribute, Place, SourceId } from "@/lib/types"

type T = ReturnType<typeof useTranslations>

// ─── helpers ────────────────────────────────────────────────────────────────

function getMeta(place: Place, sourceId: SourceId): Record<string, any> | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  const rec = place.sourceRecords.find((r) => r.sourceId === sourceId)
  if (!rec) return null
  return (rec.metadata ?? rec.raw ?? null) as Record<string, any> | null // eslint-disable-line @typescript-eslint/no-explicit-any
}

function str(v: unknown): string | null {
  if (v == null || v === "" || v === "unknown") return null
  return String(v)
}

const PRICE_LEVEL: Record<string, string> = {
  PRICE_LEVEL_FREE:           "kostenlos / free",
  PRICE_LEVEL_INEXPENSIVE:    "€",
  PRICE_LEVEL_MODERATE:       "€€",
  PRICE_LEVEL_EXPENSIVE:      "€€€",
  PRICE_LEVEL_VERY_EXPENSIVE: "€€€€",
}

// Structured sub-details of one criterion as [label, value] pairs — the
// content of the old table's indented sub-rows, now behind a per-criterion
// disclosure. Booleans are words ("Ja"/"Nein"), not ✓/✗ glyphs.
function criterionDetailRows(t: T, kind: CriterionKind, attr: AccessibilityAttribute): [string, string][] {
  const d = attr.details as Record<string, unknown>
  const yn = (v: unknown) => (v ? t.a11y.yes : t.a11y.no)
  const u = t.details.units
  const rows: [string, string][] = []
  const add = (label: string, v: unknown, fmt: (v: unknown) => string = String) => { if (v != null && v !== "") rows.push([label, fmt(v)]) }
  if (kind === "entrance") {
    const l = t.details.entrance
    add(l.isLevel, d.isLevel, yn); add(l.hasRamp, d.hasRamp, yn)
    add(l.rampSlopePercent, d.rampSlopePercent, (v) => `${v} ${u.percent}`)
    add(l.stepCount, d.stepCount); add(l.stepHeightCm, d.stepHeightCm, (v) => `${v} ${u.cm}`)
    add(l.doorWidthCm, d.doorWidthCm, (v) => `${v} ${u.cm}`)
    add(l.hasAutomaticDoor, d.hasAutomaticDoor, yn); add(l.hasHoist, d.hasHoist, yn)
    add(l.description, d.description)
  } else if (kind === "toilet") {
    const l = t.details.toilet
    add(l.isDesignated, d.isDesignated, yn); add(l.isInside, d.isInside, yn)
    add(l.hasGrabBars, d.hasGrabBars, yn); add(l.grabBarsOnBothSides, d.grabBarsOnBothSides, yn)
    add(l.grabBarsFoldable, d.grabBarsFoldable, yn)
    add(l.turningRadiusCm, d.turningRadiusCm, (v) => `${v} ${u.cm}`)
    add(l.doorWidthCm, d.doorWidthCm, (v) => `${v} ${u.cm}`)
    add(l.hasEmergencyPullstring, d.hasEmergencyPullstring, yn)
  } else if (kind === "seating") {
    add(t.details.seating.isAccessible, d.isAccessible, yn)
  } else {
    const l = t.details.parking
    add(l.hasWheelchairSpaces, d.hasWheelchairSpaces, yn); add(l.spaceCount, d.spaceCount)
    add(l.distanceToEntranceM, d.distanceToEntranceM, (v) => `${v} ${u.m}`)
    if (d.nearbyOnly) add(l.nearbyParkingDistanceM, d.nearbyParkingDistanceM, (v) => `${v} ${u.m}`)
  }
  return rows
}

// ─── building blocks ────────────────────────────────────────────────────────

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl bg-card shadow-card", className)}>{children}</div>
}

function GroupTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-[13px] font-bold text-muted-foreground px-1 -mb-1 mt-1">{children}</h3>
}

const ICON_TILE: Record<string, string> = {
  blue:   "bg-blue-100 text-blue-700",
  green:  "bg-green-100 text-green-700",
  orange: "bg-orange-100 text-orange-700",
  violet: "bg-violet-100 text-violet-700",
  slate:  "bg-slate-100 text-slate-700",
}

function ListRow({ icon: Icon, tone = "slate", children, trailing }: { icon: React.ElementType; tone?: keyof typeof ICON_TILE; children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 border-b border-border/70 last:border-b-0 text-sm">
      <span className={cn("w-8 h-8 rounded-lg grid place-items-center shrink-0", ICON_TILE[tone])} aria-hidden>
        <Icon className="w-4 h-4" />
      </span>
      <div className="flex-1 min-w-0 break-words">{children}</div>
      {trailing}
    </div>
  )
}

function CriterionDetailRow({ kind, attr, filtered }: { kind: CriterionKind; attr: AccessibilityAttribute; filtered: boolean }) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const rows = criterionDetailRows(t, kind, attr)
  const tier = criterionTier(attr)
  const verifiedIso = attrVerifiedAt(attr)
  const verified = verifiedIso ? t.results.verifiedAt(verifiedIso, []) : null
  const sources = attr.sources.map((s) => SOURCE_LABELS[s.sourceId]).join(", ")
  const detailsId = `crit-details-${kind}`
  return (
    <div className="px-3.5 py-3 border-b border-border/70 last:border-b-0">
      <div className="flex items-start gap-3">
        <CriterionGlyph kind={kind} value={attr.value} size="md" />
        <div className="flex-1 min-w-0">
          <p className="flex items-center gap-1.5 flex-wrap text-[15px] font-semibold">
            {t.criteria[kind]}
            {filtered && (
              <span className="text-[10.5px] font-semibold text-primary-strong bg-primary/10 rounded px-1.5 py-px" title={t.place.filterTagLabel}>
                {t.place.filterTag}
                <span className="sr-only"> ({t.place.filterTagLabel})</span>
              </span>
            )}
            {attr.conflict && <AlertTriangle className="w-3.5 h-3.5 text-amber-600" role="img" aria-label={t.results.conflict} />}
          </p>
          <p className={cn("text-sm font-semibold", VALUE_TEXT[attr.value])}>{criterionValueLabel(t, kind, attr)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {attr.value === "unknown"
              ? t.place.noSource
              : <>{t.place.reliabilityShort(t.results.tier[tier])}{sources && ` · ${sources}`}{verified && ` · ${verified}`}</>}
          </p>
          {attr.conflict && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {attr.sources.filter((s) => s.value !== "unknown").map((s, i) => (
                <span key={s.sourceId}>{i > 0 && " · "}{SOURCE_LABELS[s.sourceId]}: <span className={VALUE_TEXT[s.value]}>{t.a11y[s.value]}</span></span>
              ))}
            </p>
          )}
          {rows.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls={detailsId}
                className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-primary-strong rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} aria-hidden />
                {t.place.detailsCount(rows.length)}
              </button>
              {open && (
                <dl id={detailsId} className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                  {rows.map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="break-words">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </div>
        {attr.value !== "unknown" && tier !== "keine" && (
          <span className="flex flex-col items-end gap-1 pt-1 text-[11px] text-muted-foreground shrink-0" aria-hidden>
            <ReliabilityDots tier={tier} />
            {t.results.tier[tier]}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── main component ─────────────────────────────────────────────────────────

interface Props {
  place:      Place
  mode:       "quickstart" | "expert"
  distanceM?: number
  // id for the dialog's aria-labelledby (Expert sheet).
  titleId?:   string
  // h1 on a full screen (Quickstart), h2 inside the Expert dialog.
  headingLevel?: 1 | 2
  // Controls overlaid on the top of the hero ("‹ Zurück", mode switcher,
  // settings, ✕) — owned by the wrapper, which knows its own navigation.
  topStart?:  ReactNode
  topEnd?:    ReactNode
  // Expert only.
  filters?:       JudgmentFilters
  onOpenFilters?: () => void
  // Called before the Tally report popup opens (the Expert sheet closes itself).
  onBeforeReport?: () => void
}

// The shared detail layout of the unified place UI (docs/plans/unified-
// results-detail-popup-redesign.md, "Detail V2"): hero (photo, else a tinted
// category tile), title block, verdict card, action bar, criteria card. Expert
// Mode appends a report action and grouped cards (contact & hours, offer,
// sources & platforms, technical details). Wrapped by SimpleDetail
// (Quickstart full screen) and PlaceDebugSheet (Expert dialog).
//
// The action bar deliberately has no default (filled) action: Route leaves
// the app, and none of the others is "the" thing to do on this screen.
export default function PlaceDetailView({ place, mode, distanceM, titleId, headingLevel = 2, topStart, topEnd, filters, onOpenFilters, onBeforeReport }: Props) {
  const t = useTranslations()
  const ti = t.info
  const { locale } = useLocale()
  const expert = mode === "expert"
  const openingStatus = useOpeningStatus(place)
  const address = useResolvedAddress(place)
  const imageUrl = usePlaceImage(place)
  // Remembers which URL failed to load, so a new place's photo is tried again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showImage = !!imageUrl && imageUrl !== failedUrl

  const [shareFeedback, setShareFeedback] = useState<"copied" | "shared" | null>(null)
  const [copiedField, setCopiedField] = useState<"address" | "osm" | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [lazyRaw, setLazyRaw] = useState<Record<number, { state: "loading" | "error" | "done"; data?: unknown }>>({})
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  const category = (t.categories as Record<string, string>)[place.category] ?? place.category
  const judgmentFilters = filters ?? { entrance: false, toilet: false, parking: false, seating: false, acceptUnknown: false }
  const verdictStatus = expert
    ? evaluatePlaceJudgment(place, judgmentFilters).status
    : evaluatePlaceJudgment(place, quickstartJudgmentFilters(place.category)).status
  const heroTint = verdictStatus === "pass" || verdictStatus === "pass_limited"
    ? "from-green-100 to-green-200"
    : verdictStatus === "fail" ? "from-red-100 to-red-200"
    : verdictStatus === "none" ? "from-slate-100 to-slate-200"
    : "from-amber-100 to-amber-200"

  const osm = getMeta(place, "osm")
  const google = getMeta(place, "google_places")
  const osmRecord = place.sourceRecords.find((r) => r.sourceId === "osm")
  const osmLink = osmRecord?.externalId ? `https://www.openstreetmap.org/${osmRecord.externalId}` : null
  const reportFormId = TALLY_DATA_ERROR_FORMS[locale]

  // "Nein" outranks "Unbekannt": a set "no" is a concrete claim someone can
  // dispute ("Datenfehler melden"); "unbekannt" alone only has a gap to fill
  // ("Info ergänzen"). Same Tally form either way.
  const e = place.accessibility.entrance.value, to = place.accessibility.toilet.value
  const reportMode: "report" | "contribute" =
    e === "no" || to === "no" ? "report" : e === "unknown" || to === "unknown" ? "contribute" : "report"

  function flash(setter: () => void, reset: () => void) {
    setter()
    timers.current.push(setTimeout(reset, 2000))
  }

  function handleShare() {
    hapticLight()
    // Deliberately NO `text` field: share targets concatenate text and url
    // (some without a separator), producing a broken link. The name already
    // rides in `title`; the url must stay the only body payload.
    void shareOrCopy({ title: place.name, url: buildPlaceDeepLink(place), dialogTitle: place.name }).then((outcome) => {
      if (outcome === "failed") return // user cancelled the share sheet
      hapticSuccess()
      flash(() => setShareFeedback(outcome), () => setShareFeedback(null))
    })
  }

  function handleCopy(text: string, field: "address" | "osm") {
    void navigator.clipboard.writeText(text).then(() => flash(() => setCopiedField(field), () => setCopiedField(null)))
  }

  function handleReport() {
    hapticLight()
    track("report_data_error", { category: place.category, mode: reportMode })
    const hidden: Record<string, string> = {
      deeplink:   buildPlaceDeepLink(place),
      placeName:  place.name,
      category:   place.category,
      entrance:   place.accessibility.entrance.value,
      toilet:     place.accessibility.toilet.value,
      parking:    place.accessibility.parking.value,
      sources:    [...new Set(place.sourceRecords.map((r) => r.sourceId))].join(","),
      appVersion: APP_VERSION,
    }
    if (osmLink) hidden.osmUrl = osmLink
    onBeforeReport?.()
    setTimeout(() => openTallyPopup(reportFormId, hidden), 150)
  }

  // Raw source records, fetched lazily (production strips `raw`).
  useEffect(() => {
    if (!showRaw) return
    const controller = new AbortController()
    place.sourceRecords.forEach((rec, i) => {
      if (rec.raw != null || lazyRaw[i]) return
      setLazyRaw((m) => ({ ...m, [i]: { state: "loading" } }))
      const qs = new URLSearchParams({ source: rec.sourceId, id: rec.externalId, lat: String(place.coordinates.lat), lon: String(place.coordinates.lon), cat: place.category })
      fetch(`/api/raw?${qs}`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status))
          const json = await res.json()
          setLazyRaw((m) => ({ ...m, [i]: { state: "done", data: json.raw } }))
        })
        .catch((err) => {
          if (err?.name === "AbortError") return
          setLazyRaw((m) => ({ ...m, [i]: { state: "error" } }))
        })
    })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRaw, place])

  // Offer facts (Expert).
  const email   = str(osm?.email) ?? str(osm?.["contact:email"])
  const cuisine = str(osm?.cuisine)?.split(";").map((s: string) => s.trim()).join(", ")
  const stars   = str(osm?.stars) ?? str(osm?.["tourism:stars"])
  const googleRating = google?.rating != null ? `${google.rating}/5 (${google.userRatingCount ?? "?"} ${ti.reviews})` : null
  const priceLevel = google?.priceLevel ? PRICE_LEVEL[google.priceLevel as string] ?? null : null
  const takeaway = str(osm?.takeaway)
  const delivery = str(osm?.delivery)
  const wifi     = osm?.internet_access != null && osm.internet_access !== "no"
  const dogTag   = str(osm?.dog) ?? str(osm?.dogs)
  const dogLabel =
    dogTag === "leashed"                           ? ti.dogsLeashed :
    dogTag === "outside"                           ? ti.dogsOutside :
    dogTag === "yes" || place.allowsDogs === true  ? ti.dogsYes     :
    dogTag === "no"  || place.allowsDogs === false ? ti.dogsNo      :
    dogTag ?? null
  const offer: string[] = [
    cuisine && `${ti.cuisine}: ${cuisine}`,
    stars && `${ti.stars}: ${"★".repeat(Math.min(5, parseInt(stars, 10) || 0))} (${stars})`,
    googleRating && `${ti.rating}: ${googleRating}`,
    priceLevel && `${ti.priceLevel}: ${priceLevel}`,
    place.isVegetarianFriendly && ti.vegetarian,
    place.isVeganFriendly && ti.vegan,
    dogLabel && `${ti.dogs}: ${dogLabel}`,
    takeaway && takeaway !== "no" && `${ti.takeaway}: ${takeaway === "only" ? ti.takeawayOnly : ti.yes}`,
    delivery && delivery !== "no" && ti.delivery,
    wifi && ti.wifi,
  ].filter((x): x is string => typeof x === "string" && x.length > 0)
  const wheelchairDesc = str(osm?.["wheelchair:description"]) ?? str(osm?.["wheelchair:description:de"])
  const acceslibreCommentaire = getMeta(place, "acceslibre")?.commentaire as string | null | undefined
  const openingHoursRaw = extractRawOpeningHours(place)

  const googleMapsLink = (() => {
    const g = place.sourceRecords.find((r) => r.sourceId === "google_places")
    const query = encodeURIComponent([place.name, place.address.city].filter(Boolean).join(" "))
    return `https://www.google.com/maps/search/?api=1&query=${query}${g?.externalId ? `&query_place_id=${g.externalId}` : ""}`
  })()
  const wheelmapLink = (() => {
    if (place.wheelmapUrl) return place.wheelmapUrl
    if (osmRecord) {
      const [type, id] = osmRecord.externalId.split("/")
      if (type === "node" && id) return `https://wheelmap.org/nodes/${id}`
    }
    return `https://wheelmap.org/?lat=${place.coordinates.lat}&lon=${place.coordinates.lon}&zoom=19`
  })()

  const criteria: CriterionKind[] = expert
    ? ["entrance", "toilet", "parking", ...(place.accessibility.seating ? ["seating" as const] : [])]
    : ["entrance", "toilet", "parking"]
  const attrOf = (k: CriterionKind) => (k === "seating" ? place.accessibility.seating! : place.accessibility[k])

  return (
    <div className="flex flex-col min-h-full bg-canvas">
      {/* ── Hero ── */}
      <div className={cn("relative h-[calc(11rem+env(safe-area-inset-top))] shrink-0 overflow-hidden", !showImage && `bg-gradient-to-br ${heroTint}`)}>
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl!} alt={t.place.photoAlt(place.name)} loading="lazy" onError={() => setFailedUrl(imageUrl)} className="w-full h-full object-cover" />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-6xl pb-4" aria-hidden>{CATEGORY_ICONS[place.category] ?? "📍"}</span>
        )}
        <div className="absolute inset-x-3 top-0 pt-safe-3 flex items-center gap-2">
          {topStart}
          <span className="flex-1" />
          {topEnd}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="relative -mt-5 rounded-t-3xl bg-canvas px-3.5 pt-4 pb-6 flex flex-col gap-3">
        <div className="px-1">
          {(() => {
            const Heading = headingLevel === 1 ? "h1" : "h2"
            return <Heading id={titleId} className="text-[22px] font-extrabold leading-tight tracking-tight break-words">{place.name}</Heading>
          })()}
          <p className="mt-1 text-sm text-muted-foreground flex items-center gap-1 flex-wrap">
            <span><span aria-hidden>{CATEGORY_ICONS[place.category] ?? "📍"} </span><span className="font-medium text-foreground">{category}</span></span>
            {distanceM !== undefined && <><span aria-hidden>·</span><span>{t.results.distanceShort(Math.round(distanceM))}</span></>}
            {openingStatus && <span aria-hidden>·</span>}
            <OpeningStatusChip status={openingStatus} size="sm" className="font-semibold" />
          </p>
        </div>

        <Card className="p-3.5">
          {expert
            ? <JudgmentLine place={place} filters={judgmentFilters} onOpenFilters={onOpenFilters} size="lg" />
            : <QuickstartVerdict place={place} size="lg" />}
        </Card>

        {/* Action bar — four equal tiles, no default action. */}
        <div className="grid grid-cols-4 gap-2">
          <NavigateButton coords={place.coordinates} variant="tile" />
          {place.phone ? (
            <a href={`tel:${place.phone}`} className={ACTION_TILE}><Phone className="w-5 h-5" aria-hidden />{t.simple.call}</a>
          ) : (
            <button type="button" disabled className={ACTION_TILE_DISABLED}><Phone className="w-5 h-5" aria-hidden />{t.simple.call}</button>
          )}
          {place.website ? (
            <NativeLink href={place.website} className={ACTION_TILE}><Globe className="w-5 h-5" aria-hidden />{t.place.website}</NativeLink>
          ) : (
            <button type="button" disabled className={ACTION_TILE_DISABLED}><Globe className="w-5 h-5" aria-hidden />{t.place.website}</button>
          )}
          <button type="button" onClick={handleShare} className={ACTION_TILE} aria-live="polite">
            <Share2 className="w-5 h-5" aria-hidden />
            {shareFeedback ? (shareFeedback === "shared" ? t.results.linkShared : t.results.linkCopied) : t.results.copyLink}
          </button>
        </div>

        {expert && <GroupTitle>{t.place.sectionAccessibility}</GroupTitle>}
        <Card>
          {expert ? (
            criteria.map((k) => <CriterionDetailRow key={k} kind={k} attr={attrOf(k)} filtered={!!judgmentFilters[k]} />)
          ) : (
            criteria.map((k) => (
              <div key={k} className="flex items-center gap-3 px-3.5 py-3 border-b border-border/70 last:border-b-0">
                <CriterionGlyph kind={k} value={attrOf(k).value} size="md" />
                <span className="text-[15px] font-medium">{criterionSentence(t, k as "entrance" | "toilet" | "parking", attrOf(k).value)}</span>
              </div>
            ))
          )}
        </Card>

        {expert && (wheelchairDesc || acceslibreCommentaire) && (
          <Card className="px-3.5 py-3 flex flex-col gap-2 text-sm">
            {wheelchairDesc && <p className="flex gap-2"><MessageSquare className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden /><span><span className="sr-only">{ti.description}: </span>{wheelchairDesc}</span></p>}
            {acceslibreCommentaire && <p className="flex gap-2 italic"><MessageSquare className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden /><span><span className="sr-only">{ti.description}: </span>{acceslibreCommentaire}</span></p>}
          </Card>
        )}

        {expert && reportFormId && (
          <button
            type="button"
            onClick={handleReport}
            className={cn(
              "self-start inline-flex items-center gap-1.5 px-1 text-sm font-medium hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              reportMode === "contribute" ? "text-green-700" : "text-primary-strong",
            )}
          >
            {reportMode === "contribute" ? <PenLine className="w-4 h-4" aria-hidden /> : <Flag className="w-4 h-4" aria-hidden />}
            {reportMode === "contribute" ? ti.contributeDataInfo : ti.reportDataError}
          </button>
        )}

        {/* ── Contact & hours ── */}
        {expert && <GroupTitle>{t.place.sectionContact}</GroupTitle>}
        {(address || openingStatus || (expert && (place.phone || place.website || email || openingHoursRaw))) && (
          <Card>
            {address && (
              <ListRow
                icon={MapPin}
                tone="blue"
                trailing={expert && (copiedField === "address"
                  ? <span className="text-xs text-green-700">{t.common.copied}</span>
                  : <button type="button" onClick={() => handleCopy(address, "address")} aria-label={`${ti.address}: ${t.common.copied}`} className="p-1.5 -m-1.5 text-muted-foreground hover:text-foreground rounded-md"><Copy className="w-4 h-4" aria-hidden /></button>)}
              >
                <span className="sr-only">{ti.address}: </span>{address}
                {distanceM !== undefined && <span className="block text-xs text-muted-foreground">{t.results.distanceFromHere(Math.round(distanceM))}</span>}
              </ListRow>
            )}
            {expert && place.phone && (
              <ListRow icon={Phone} tone="green"><span className="sr-only">{ti.phone}: </span><a href={`tel:${place.phone}`} className="text-primary-strong hover:underline">{place.phone}</a></ListRow>
            )}
            {expert && place.website && (
              <ListRow icon={Globe} tone="blue"><span className="sr-only">{ti.website}: </span><NativeLink href={place.website} className="text-primary-strong hover:underline break-all">{place.website.replace(/^https?:\/\//, "")}</NativeLink></ListRow>
            )}
            {expert && email && (
              <ListRow icon={Mail} tone="violet"><span className="sr-only">{ti.email}: </span><a href={`mailto:${email}`} className="text-primary-strong hover:underline break-all">{email}</a></ListRow>
            )}
            {(openingStatus || (expert && openingHoursRaw)) && (
              <ListRow icon={Clock} tone="orange">
                <span className="sr-only">{ti.openingHours}: </span>
                <OpeningStatusChip status={openingStatus} size="sm" className="font-semibold" />
                {expert && openingHoursRaw && <span className="block text-xs text-muted-foreground whitespace-pre-line mt-0.5">{openingHoursRaw}</span>}
              </ListRow>
            )}
          </Card>
        )}

        {/* ── Offer ── */}
        {expert && offer.length > 0 && (
          <>
            <GroupTitle>{ti.offer}</GroupTitle>
            <Card className="px-3.5 py-3">
              <ul className="flex flex-wrap gap-1.5">
                {offer.map((o) => <li key={o} className="text-[13px] bg-muted rounded-full px-2.5 py-1">{o}</li>)}
              </ul>
            </Card>
          </>
        )}

        {/* ── Sources & other platforms ── */}
        {expert && (
          <>
            <GroupTitle>{t.place.sectionSources}</GroupTitle>
            <Card>
              {osmLink && (
                <ListRow
                  icon={MapIcon}
                  trailing={copiedField === "osm"
                    ? <span className="text-xs text-green-700">{t.common.copied}</span>
                    : <button type="button" onClick={() => handleCopy(osmRecord!.externalId.replace(/^\w+\//, ""), "osm")} aria-label={`OpenStreetMap ID: ${t.common.copied}`} className="p-1.5 -m-1.5 text-muted-foreground hover:text-foreground rounded-md"><Copy className="w-4 h-4" aria-hidden /></button>}
                >
                  <NativeLink href={osmLink} className="text-primary-strong hover:underline">OpenStreetMap</NativeLink>
                  <span className="block text-xs text-muted-foreground">{osmRecord!.externalId}</span>
                </ListRow>
              )}
              <ListRow icon={Accessibility} tone="violet"><NativeLink href={wheelmapLink} className="text-primary-strong hover:underline">Wheelmap.org</NativeLink></ListRow>
              {place.gintoUrl && <ListRow icon={ShieldCheck} tone="green"><NativeLink href={place.gintoUrl} className="text-primary-strong hover:underline">Ginto.guide</NativeLink></ListRow>}
              {place.acceslibreUrl && <ListRow icon={ExternalLink} tone="blue"><NativeLink href={place.acceslibreUrl} className="text-primary-strong hover:underline">AccèsLibre</NativeLink></ListRow>}
              {place.sourceRecords.some((r) => r.sourceId === "reisen_fuer_alle") && (
                <ListRow icon={Award} tone="orange">Reisen für Alle<span className="block text-xs text-muted-foreground">{t.place.certifiedEntry}</span></ListRow>
              )}
              <ListRow icon={MapIcon} tone="blue"><NativeLink href={googleMapsLink} className="text-primary-strong hover:underline">Google Maps</NativeLink></ListRow>
            </Card>

            {/* ── Technical details (raw data) ── */}
            <Card>
              <button
                type="button"
                onClick={() => setShowRaw((v) => !v)}
                aria-expanded={showRaw}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 text-sm text-left rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className={cn("w-8 h-8 rounded-lg grid place-items-center shrink-0", ICON_TILE.slate)} aria-hidden><Braces className="w-4 h-4" /></span>
                <span className="flex-1">
                  {showRaw ? ti.hideRawData : ti.showRawData}
                  <span className="block text-xs text-muted-foreground">{t.place.sectionTechnical} · {t.place.technicalHint}</span>
                </span>
                <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", showRaw && "rotate-180")} aria-hidden />
              </button>
              {showRaw && (
                <div className="px-3.5 pb-3.5 space-y-3">
                  {place.sourceRecords.map((rec, i) => (
                    <div key={i} className="border border-border rounded-md overflow-hidden">
                      <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/50 flex-wrap">
                        <span className="font-medium text-xs">{SOURCE_LABELS[rec.sourceId]}</span>
                        <code className="font-mono text-muted-foreground text-[11px]">#{rec.externalId}</code>
                        <span className="text-muted-foreground text-[11px] ml-auto">{new Date(rec.fetchedAt).toLocaleString()}</span>
                      </div>
                      <pre className="font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-all p-2 max-h-48 overflow-y-auto text-muted-foreground">
                        {rec.raw != null
                          ? JSON.stringify(rec.raw, null, 2)
                          : lazyRaw[i]?.state === "done" && lazyRaw[i]?.data != null
                            ? JSON.stringify(lazyRaw[i].data, null, 2)
                            : lazyRaw[i]?.state === "loading"
                              ? ti.rawDataLoading
                              : lazyRaw[i]?.state === "error"
                                ? ti.rawDataUnavailable
                                : rec.metadata != null && Object.keys(rec.metadata).length > 0
                                  ? JSON.stringify(rec.metadata, null, 2)
                                  : ti.rawDataUnavailable}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
