"use client"

import { useState, useRef, useEffect, Fragment } from "react"
import { useFocusTrap } from "@/hooks/useFocusTrap"
import {
  X, MapPin, Phone, Globe, Tag, Clock, Mail,
  Utensils, Leaf, Dog, Wifi, Star, DollarSign,
  MessageSquare, ExternalLink, Accessibility,
  ShieldCheck, Award, ChevronDown, ChevronUp, CheckCircle2,
  Truck, ShoppingBag, Share2, Car, DoorOpen, Toilet as ToiletIcon, Armchair,
  Hash, Navigation, Copy, Flag, PenLine,
} from "lucide-react"
import { shareOrCopy } from "@/lib/native/share"
import { hapticLight, hapticSuccess } from "@/lib/native/haptics"
import { SOURCE_LABELS, APP_VERSION, TALLY_DATA_ERROR_FORMS } from "@/lib/config"
import { CATEGORY_ICONS } from "@/lib/category-icons"
import { NativeLink } from "@/components/ui/native-link"
import NavigateButton from "@/components/ui/navigate-button"
import { useTranslations, useLocale } from "@/lib/i18n"
import { buildPlaceDeepLink } from "@/lib/place-link"
import { openTallyPopup } from "@/lib/tally"
import { track } from "@/lib/analytics"
import JudgmentLine from "./JudgmentLine"
import { criterionTier, attrVerifiedAt, type JudgmentFilters, type ConfidenceTier } from "@/lib/reliability"
import { cn } from "@/lib/utils"
import type { Place, SourceId, ParkingDetails, EntranceDetails, ToiletDetails, SeatingDetails, AccessibilityAttribute, SearchFilters } from "@/lib/types"

interface Props {
  place:    Place
  onClose:  () => void
  filters?: SearchFilters
  // Opens the filter view — passed through to JudgmentLine so its
  // "Kriterien" text becomes a real link here (the only surface where this
  // link exists, see JudgmentLine.tsx's own comment on why).
  onOpenFilters?: () => void
}

const NO_FILTERS: JudgmentFilters = { entrance: false, toilet: false, parking: false, seating: false, acceptUnknown: false }

const VALUE_COLORS: Record<string, string> = {
  yes:     "text-green-600",
  limited: "text-amber-600",
  no:      "text-red-600",
  unknown: "text-zinc-400",
}

// Per-criterion reliability indicator (v13, docs/plans/reliability-tiers.md;
// bar form since the 2026-08-03 table redesign) — surfaces the tier the app
// already computes for each accessibility attribute, so a value resting on a
// single weak source (e.g. Google-only) reads as "gering" instead of an
// authoritative-looking plain "Ja". Always neutral/grey: reliability is a
// separate axis from the sachebene yes/limited/no colour (VALUE_COLORS
// above) and must never look like a second traffic light next to it. Three
// bars (not a coloured pill) so tiers are comparable across rows at a
// glance — the tier word itself is still the accessible name (role="img"
// aria-label), never conveyed by fill count alone.
const TIER_BAR_COUNT: Record<ConfidenceTier, number> = { sehr_hoch: 3, gut: 2, gering: 1, keine: 0 }

function ReliabilityBars({ attr }: { attr: AccessibilityAttribute }) {
  const t      = useTranslations()
  const tier   = criterionTier(attr)
  const filled = TIER_BAR_COUNT[tier]
  return (
    <span className="inline-flex items-center gap-[2px]" role="img" aria-label={t.results.tier[tier]}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className={cn("block w-1 h-2.5 rounded-[1px]", i < filled ? "bg-slate-500" : "bg-slate-200")}
        />
      ))}
    </span>
  )
}

// Verified-on-site date (decision 8): folded in as a trailing clause after
// the source list rather than a separate badge.
function verifiedSuffix(t: ReturnType<typeof useTranslations>, attr: AccessibilityAttribute): string {
  const iso = attrVerifiedAt(attr)
  if (!iso) return ""
  const s = t.results.verifiedAt(iso, [])
  return ` · ${s.charAt(0).toLowerCase()}${s.slice(1)}`
}

const PRICE_LEVEL: Record<string, string> = {
  PRICE_LEVEL_FREE:           "kostenlos / free",
  PRICE_LEVEL_INEXPENSIVE:    "€",
  PRICE_LEVEL_MODERATE:       "€€",
  PRICE_LEVEL_EXPENSIVE:      "€€€",
  PRICE_LEVEL_VERY_EXPENSIVE: "€€€€",
}

function getMeta(place: Place, sourceId: SourceId): Record<string, any> | null {
  const rec = place.sourceRecords.find((r) => r.sourceId === sourceId)
  if (!rec) return null
  return (rec.metadata ?? rec.raw ?? null) as Record<string, any> | null
}

function str(v: unknown): string | null {
  if (v == null || v === "" || v === "unknown") return null
  return String(v)
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5 text-xs">
      <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
      <span className="text-muted-foreground shrink-0 w-28">{label}</span>
      <span className="flex-1 min-w-0 break-words">{children}</span>
    </div>
  )
}

function Section({
  title,
  icon: Icon,
  chipClass,
  children,
}: {
  title: string
  icon: React.ElementType
  chipClass: string
  children: React.ReactNode
}) {
  const chipClasses = cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold mb-3 border", chipClass)
  return (
    <section className="py-4">
      <div className={chipClasses}>
        <Icon className="w-3 h-3 shrink-0" />
        <span role="heading" aria-level={3} className="uppercase tracking-wide">{title}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

export default function PlaceDebugSheet({ place, onClose, filters, onOpenFilters }: Props) {
  const [shareFeedback, setShareFeedback] = useState<"copied" | "shared" | null>(null)
  const [copiedField,  setCopiedField]  = useState<"address" | "osm" | null>(null)
  const copyTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fieldTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Focus management for the modal info sheet (WCAG 2.1.2 / 2.4.3): focus in on
  // open, trap Tab, close on Escape, restore focus to the trigger on close.
  const panelRef = useFocusTrap<HTMLDivElement>(onClose)

  function handleCopyField(text: string, field: "address" | "osm") {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field)
      if (fieldTimerRef.current) clearTimeout(fieldTimerRef.current)
      fieldTimerRef.current = setTimeout(() => setCopiedField(null), 2000)
    })
  }
  const [resolvedAddr, setResolvedAddr] = useState<string | null>(null)
  const [placeImage,   setPlaceImage]   = useState<string | null>(null)
  const [imageLoaded,  setImageLoaded]  = useState(false)

  function handleShareLink() {
    hapticLight()
    const url = buildPlaceDeepLink(place)
    // Deliberately NO `text` field: share targets concatenate text and url
    // (some without a separator), producing a broken link like
    // "…&cat=doctorsHausarztzentrum am Metznerpark…". The name already rides
    // in `title`; the url must stay the only body payload.
    void shareOrCopy({ title: place.name, url, dialogTitle: place.name }).then((outcome) => {
      if (outcome === "failed") return // user cancelled the share sheet — no feedback
      hapticSuccess()
      setShareFeedback(outcome)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setShareFeedback(null), 2000)
    })
  }
  const t  = useTranslations()
  const ti = t.info
  const { locale } = useLocale()
  const reportFormId = TALLY_DATA_ERROR_FORMS[locale]

  // "Nein" outranks "Unbekannt": a set "no" is a concrete claim someone can
  // dispute ("Datenfehler melden"); "unbekannt" alone has nothing to dispute,
  // only a gap to fill ("Info ergänzen") — docs/prototypes/report-button-
  // context-label.html. Same button, same Tally form either way; only the
  // label/icon change so the wording matches what's actually being asked of
  // the reporter.
  const reportButtonMode: "report" | "contribute" =
    place.accessibility.entrance.value === "no" || place.accessibility.toilet.value === "no"
      ? "report"
      : place.accessibility.entrance.value === "unknown" || place.accessibility.toilet.value === "unknown"
        ? "contribute"
        : "report"

  function handleReportDataError() {
    hapticLight()
    track("report_data_error", { category: place.category, mode: reportButtonMode })
    const hiddenFields: Record<string, string> = {
      deeplink:   buildPlaceDeepLink(place),
      placeName:  place.name,
      category:   place.category,
      entrance:   place.accessibility.entrance.value,
      toilet:     place.accessibility.toilet.value,
      parking:    place.accessibility.parking.value,
      sources:    [...new Set(place.sourceRecords.map((r) => r.sourceId))].join(","),
      appVersion: APP_VERSION,
    }
    if (osmLink) hiddenFields.osmUrl = osmLink
    // Close the sheet before opening the Tally overlay: the sheet's focus trap
    // would otherwise block Tab from reaching the popup iframe, and the trap's
    // focus restore would steal focus from it. The delay lets unmount + focus
    // restore settle first.
    onClose()
    setTimeout(() => openTallyPopup(reportFormId, hiddenFields), 150)
  }
  const [showRaw, setShowRaw] = useState(false)
  // Lazily-fetched full raw data, keyed by source record index. In production
  // the search payload ships no `raw` (only a whitelisted `metadata` slice), so
  // the raw block fetches the complete upstream object on demand from /api/raw.
  const [lazyRaw, setLazyRaw] = useState<Record<number, { state: "loading" | "error" | "done"; data?: unknown }>>({})

  useEffect(() => {
    if (!showRaw) return
    const controller = new AbortController()
    place.sourceRecords.forEach((rec, i) => {
      // Skip records that already carry inline raw (dev) or are already loading/loaded.
      if (rec.raw != null || lazyRaw[i]) return
      setLazyRaw((m) => ({ ...m, [i]: { state: "loading" } }))
      const qs = new URLSearchParams({
        source: rec.sourceId,
        id:     rec.externalId,
        lat:    String(place.coordinates.lat),
        lon:    String(place.coordinates.lon),
        cat:    place.category,
      })
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

  const osm    = getMeta(place, "osm")
  const google = getMeta(place, "google_places")

  // Opening hours: OSM string or Google weekday array
  const openingHours =
    str(osm?.opening_hours) ??
    (Array.isArray(google?.regularOpeningHours?.weekdayDescriptions)
      ? (google.regularOpeningHours.weekdayDescriptions as string[]).join("\n")
      : null)

  const email   = str(osm?.email) ?? str(osm?.["contact:email"])
  const cuisine = str(osm?.cuisine)?.split(";").map((s: string) => s.trim()).join(", ")
  const stars   = str(osm?.stars) ?? str(osm?.["tourism:stars"])

  const googleRating =
    google?.rating != null
      ? `${google.rating}/5 (${google.userRatingCount ?? "?"} ${ti.reviews})`
      : null
  const priceLevel = google?.priceLevel ? PRICE_LEVEL[google.priceLevel as string] ?? null : null

  const takeaway = str(osm?.takeaway)
  const delivery = str(osm?.delivery)
  const wifi     = osm?.internet_access != null && osm.internet_access !== "no"

  const dogTag = str(osm?.dog) ?? str(osm?.dogs)
  const dogLabel =
    dogTag === "leashed"                          ? ti.dogsLeashed :
    dogTag === "outside"                          ? ti.dogsOutside :
    dogTag === "yes" || place.allowsDogs === true ? ti.dogsYes     :
    dogTag === "no"  || place.allowsDogs === false? ti.dogsNo      :
    dogTag ?? null

  const wheelchairDesc =
    str(osm?.["wheelchair:description"]) ??
    str(osm?.["wheelchair:description:de"])

  const hasAngebot =
    cuisine || stars || googleRating || priceLevel ||
    (takeaway && takeaway !== "no") ||
    (delivery && delivery !== "no") ||
    wifi || dogLabel ||
    place.isVegetarianFriendly || place.isVeganFriendly

  const addr = place.address
  const addrLine1 = [addr.street, addr.houseNumber].filter(Boolean).join(" ")
  const addrLine2 = [addr.postalCode, addr.city].filter(Boolean).join(" ")
  const addrStr   = [addrLine1, addrLine2].filter(Boolean).join(", ") || resolvedAddr || ""

  useEffect(() => {
    if (addrLine1 || addrLine2) return
    const { lat, lon } = place.coordinates
    fetch(`/api/geocode/reverse?lat=${lat}&lon=${lon}&detail=1`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return
        const line1 = [d.street, d.houseNumber].filter(Boolean).join(" ")
        const line2 = [d.postalCode, d.city].filter(Boolean).join(" ")
        const full  = [line1, line2].filter(Boolean).join(", ")
        if (full) setResolvedAddr(full)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place.coordinates.lat, place.coordinates.lon])

  // One icon per criterion (not the generic wheelchair glyph everywhere) —
  // 2026-08-03 table redesign: rows read faster when entrance/toilet/seating
  // are silhouette-distinct, the same reasoning as CriterionIcon in
  // Quickstart (components/simple/CriterionIcon.tsx) applied to Turbo.
  const CRITERION_ROW_ICONS: Record<"entrance" | "toilet" | "seating", React.ElementType> = {
    entrance: DoorOpen,
    toilet:   ToiletIcon,
    seating:  Armchair,
  }

  const criteria = [
    { key: "entrance" as const, label: t.criteria.entrance, attr: place.accessibility.entrance },
    { key: "toilet"   as const, label: t.criteria.toilet,   attr: place.accessibility.toilet   },
    ...(place.accessibility.seating
      ? [{ key: "seating" as const, label: t.criteria.seating, attr: place.accessibility.seating }]
      : []),
  ]

  // Shared with JudgmentLine below — also drives the table's "Gefiltert"
  // column, so both surfaces agree on exactly which criteria count as
  // "yours" without computing it twice.
  const judgmentFilters: JudgmentFilters = filters
    ? { entrance: filters.entrance, toilet: filters.toilet, parking: filters.parking, parkingNearby: filters.parkingNearby, seating: filters.seating, onlyVerified: filters.onlyVerified, acceptUnknown: filters.acceptUnknown }
    : NO_FILTERS

  const parkingAttr = place.accessibility.parking
  const parkingD    = parkingAttr.details as ParkingDetails
  const parkingNearby = parkingD.nearbyOnly === true
  const parkingNearbyDistM = parkingD.nearbyParkingDistanceM
  const parkingValueLabel  = parkingNearby
    ? `${t.a11y.yesNearby}${parkingNearbyDistM != null ? ` (${parkingNearbyDistM} m)` : ""}`
    : t.a11y[parkingAttr.value]

  const osmRecord  = place.sourceRecords.find((r) => r.sourceId === "osm")
  const acceslibreCommentaire = getMeta(place, "acceslibre")?.commentaire as string | null | undefined

  // Image priority: OSM image/wikimedia_commons → Wikidata P18. Google Places
  // photos were dropped (2026-07) — the Photo API bills separately from Text
  // Search and was an unnecessary cost surface for a "nice to have" feature
  // (Google is the lowest-weight, off-by-default supplementary source).
  useEffect(() => {
    setPlaceImage(null)
    setImageLoaded(false)

    const controller = new AbortController()

    const osmMeta = osmRecord ? (osmRecord.metadata ?? osmRecord.raw) as Record<string, unknown> | null : null
    if (!osmMeta) return

    const imageTag = str(osmMeta.image)
    if (imageTag) {
      if (imageTag.startsWith("File:")) {
        setPlaceImage(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageTag.slice(5))}?width=500`)
      } else if (imageTag.startsWith("http")) {
        setPlaceImage(imageTag)
      }
      return
    }

    const commonsTag = str(osmMeta.wikimedia_commons)
    if (commonsTag?.startsWith("File:")) {
      setPlaceImage(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(commonsTag.slice(5))}?width=500`)
      return
    }

    const wikidataId = str(osmMeta.wikidata)
    if (!wikidataId) return

    fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&props=claims&format=json&origin=*`,
      { signal: controller.signal },
    )
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        const filename = data?.entities?.[wikidataId]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
        if (typeof filename === "string") {
          setPlaceImage(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename.replace(/ /g, "_"))}?width=500`)
        }
      })
      .catch(() => {})
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osmRecord?.externalId])

  const osmLink    = osmRecord?.externalId
    ? `https://www.openstreetmap.org/${osmRecord.externalId}`
    : null

  const googleMapsLink = (() => {
    const gRecord = place.sourceRecords.find((r) => r.sourceId === "google_places")
    const query = [place.name, place.address.city].filter(Boolean).join(" ")
    if (gRecord?.externalId) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}&query_place_id=${gRecord.externalId}`
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
  })()

  const wheelmapLink = (() => {
    if (place.wheelmapUrl) return place.wheelmapUrl
    if (osmRecord) {
      const [type, id] = osmRecord.externalId.split("/")
      if (type === "node" && id) return `https://wheelmap.org/nodes/${id}`
    }
    return `https://wheelmap.org/?lat=${place.coordinates.lat}&lon=${place.coordinates.lon}&zoom=19`
  })()

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div
        className="fixed inset-0 z-[1050] bg-black/25"
        onClick={onClose}
        onTouchEnd={(e) => { e.preventDefault(); onClose() }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="place-sheet-title"
        tabIndex={-1}
        className="fixed right-0 top-0 z-[1051] h-full w-[520px] max-w-full bg-white shadow-2xl border-l border-border flex flex-col safe-area-inset-top safe-area-inset-bottom focus:outline-none"
      >

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
          <div className="min-w-0">
            <h2 id="place-sheet-title" className="font-semibold text-sm truncate">{place.name}</h2>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <span aria-hidden>{CATEGORY_ICONS[place.category] ?? "📍"}</span>
              <span>{(t.categories as Record<string, string>)[place.category] ?? place.category}</span>
            </p>
            {addrStr && <p className="text-xs text-muted-foreground mt-0.5 truncate">{addrStr}</p>}
          </div>
          <div className="flex items-center gap-3 shrink-0 mt-0.5">
            {shareFeedback ? (
              <span className="text-xs text-green-600 px-1">{shareFeedback === "shared" ? t.results.linkShared : t.results.linkCopied}</span>
            ) : (
              <button
                onClick={handleShareLink}
                className="text-muted-foreground hover:text-foreground transition-colors p-1.5 -m-1.5"
                aria-label={t.results.copyLink}
                title={t.results.copyLink}
              >
                <Share2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              onTouchEnd={(e) => { e.preventDefault(); onClose() }}
              className="text-muted-foreground hover:text-foreground transition-colors p-1.5 -m-1.5"
              aria-label={t.common.close}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Judgement line (v13): does this place satisfy the ACTIVE filters?
            A separate axis from the reliability tiers in the section below —
            see docs/plans/reliability-tiers.md. */}
        <div className="px-4 py-3 border-b border-border shrink-0">
          <JudgmentLine
            place={place}
            filters={judgmentFilters}
            // Also closes this sheet (2026-08-03): onOpenFilters alone only
            // flips state behind the scenes (setActiveTab("filter") on
            // mobile, setFilterCollapsed(false) on desktop) — this sheet is
            // a fixed full-screen overlay on top of it, so without closing
            // it too, the switch happens invisibly and the click looks like
            // it did nothing. Only wired here, not inside JudgmentLine
            // itself, so JudgmentLine stays agnostic of onClose.
            onOpenFilters={onOpenFilters ? () => { onClose(); onOpenFilters() } : undefined}
          />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 text-xs divide-y divide-border">

          {/* ── Barrierefreiheit + Parkplatz ── */}
          <Section
            title={ti.reliability}
            icon={Accessibility}
            chipClass="bg-slate-100 text-slate-700 border-slate-200"
          >
            {wheelchairDesc && (
              <InfoRow icon={MessageSquare} label={ti.description}>{wheelchairDesc}</InfoRow>
            )}
            {/* Lösung A (2026-08-03 prototype): the table keeps its natural
                width and scrolls horizontally rather than squeezing columns
                illegibly on a narrow screen or at a large system font size —
                see docs artifact "Turbo-Modus: Verlässlichkeit-Tabelle". */}
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full min-w-[420px] text-xs border-collapse">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left font-normal pb-1.5 pr-2">{t.results.scoreCriterionCol}</th>
                    <th className="text-left font-normal pb-1.5 pr-2">{t.results.tableValueCol}</th>
                    <th className="text-center font-normal pb-1.5 pr-2">{t.results.tableFilteredCol}</th>
                    <th className="text-left font-normal pb-1.5 pr-2">{t.results.tableReliabilityCol}</th>
                    <th className="text-left font-normal pb-1.5">{t.results.tableSourceCol}</th>
                  </tr>
                </thead>
                <tbody>
                  {criteria.map(({ key, label, attr }) => {
                    const ed = key === "entrance" ? (attr.details as EntranceDetails) : null
                    const td = key === "toilet"   ? (attr.details as ToiletDetails)   : null
                    const sd = key === "seating"  ? (attr.details as SeatingDetails)  : null
                    const subRows = (
                      <>
                        {ed?.isLevel           != null && <InfoRow icon={Accessibility} label={t.details.entrance.isLevel}>{ed.isLevel ? "✓" : "✗"}</InfoRow>}
                        {ed?.hasRamp           != null && <InfoRow icon={Accessibility} label={t.details.entrance.hasRamp}>{ed.hasRamp ? "✓" : "✗"}</InfoRow>}
                        {ed?.rampSlopePercent  != null && <InfoRow icon={Hash}          label={t.details.entrance.rampSlopePercent}>{ed.rampSlopePercent} {t.details.units.percent}</InfoRow>}
                        {ed?.stepCount         != null && <InfoRow icon={Hash}          label={t.details.entrance.stepCount}>{ed.stepCount}</InfoRow>}
                        {ed?.stepHeightCm      != null && <InfoRow icon={Hash}          label={t.details.entrance.stepHeightCm}>{ed.stepHeightCm} {t.details.units.cm}</InfoRow>}
                        {ed?.doorWidthCm       != null && <InfoRow icon={Hash}          label={t.details.entrance.doorWidthCm}>{ed.doorWidthCm} {t.details.units.cm}</InfoRow>}
                        {ed?.hasAutomaticDoor  != null && <InfoRow icon={Accessibility} label={t.details.entrance.hasAutomaticDoor}>{ed.hasAutomaticDoor ? "✓" : "✗"}</InfoRow>}
                        {ed?.hasHoist          != null && <InfoRow icon={Accessibility} label={t.details.entrance.hasHoist}>{ed.hasHoist ? "✓" : "✗"}</InfoRow>}
                        {ed?.description             && <InfoRow icon={MessageSquare}  label={t.details.entrance.description}>{ed.description}</InfoRow>}
                        {td?.isDesignated          != null && <InfoRow icon={Accessibility} label={t.details.toilet.isDesignated}>{td.isDesignated ? "✓" : "✗"}</InfoRow>}
                        {td?.isInside              != null && <InfoRow icon={Accessibility} label={t.details.toilet.isInside}>{td.isInside ? "✓" : "✗"}</InfoRow>}
                        {td?.hasGrabBars           != null && <InfoRow icon={Accessibility} label={t.details.toilet.hasGrabBars}>{td.hasGrabBars ? "✓" : "✗"}</InfoRow>}
                        {td?.grabBarsOnBothSides   != null && <InfoRow icon={Accessibility} label={t.details.toilet.grabBarsOnBothSides}>{td.grabBarsOnBothSides ? "✓" : "✗"}</InfoRow>}
                        {td?.grabBarsFoldable      != null && <InfoRow icon={Accessibility} label={t.details.toilet.grabBarsFoldable}>{td.grabBarsFoldable ? "✓" : "✗"}</InfoRow>}
                        {td?.turningRadiusCm       != null && <InfoRow icon={Hash}          label={t.details.toilet.turningRadiusCm}>{td.turningRadiusCm} {t.details.units.cm}</InfoRow>}
                        {td?.doorWidthCm           != null && <InfoRow icon={Hash}          label={t.details.toilet.doorWidthCm}>{td.doorWidthCm} {t.details.units.cm}</InfoRow>}
                        {td?.hasEmergencyPullstring != null && <InfoRow icon={Accessibility} label={t.details.toilet.hasEmergencyPullstring}>{td.hasEmergencyPullstring ? "✓" : "✗"}</InfoRow>}
                        {sd?.isAccessible          != null && <InfoRow icon={Accessibility} label={t.details.seating.isAccessible}>{sd.isAccessible ? "✓" : "✗"}</InfoRow>}
                      </>
                    )
                    const hasSubRows = ed != null
                      ? Object.values(ed).some((v) => v != null)
                      : td != null
                        ? Object.values(td).some((v) => v != null)
                        : sd?.isAccessible != null
                    const Icon = CRITERION_ROW_ICONS[key]
                    const isFiltered = judgmentFilters[key]
                    return (
                      <Fragment key={key}>
                        <tr className={cn("border-t border-border", isFiltered && "bg-primary/5")}>
                          <td className="py-1.5 pr-2 align-top">
                            <span className="flex items-center gap-1.5 font-medium text-foreground">
                              <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden />
                              {label}
                            </span>
                          </td>
                          <td className={cn("py-1.5 pr-2 align-top font-medium", VALUE_COLORS[attr.value])}>
                            {t.a11y[attr.value]}
                          </td>
                          <td className="py-1.5 pr-2 align-top text-center">
                            {isFiltered
                              ? <CheckCircle2 className="w-3.5 h-3.5 text-primary inline" aria-label={t.results.tableFilteredYes} />
                              : <span className="inline-block w-1.5 h-1.5 rounded-full bg-border" aria-label={t.results.tableFilteredNo} />}
                          </td>
                          <td className="py-1.5 pr-2 align-top">
                            {attr.value !== "unknown" ? <ReliabilityBars attr={attr} /> : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="py-1.5 align-top text-muted-foreground">
                            {attr.sources.length > 0
                              ? <>{attr.sources.map((s) => SOURCE_LABELS[s.sourceId]).join(", ")}{verifiedSuffix(t, attr)}</>
                              : "—"}
                          </td>
                        </tr>
                        {hasSubRows && (
                          <tr>
                            <td colSpan={5} className="pb-1.5">
                              <div className="ml-5 pl-3 pt-1 border-l border-border space-y-2">
                                {subRows}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  {/* Parkplatz — innerhalb der Barrierefreiheits-Sektion */}
                  <tr className={cn("border-t border-border", judgmentFilters.parking && "bg-primary/5")}>
                    <td className="py-1.5 pr-2 align-top">
                      <span className="flex items-center gap-1.5 font-medium text-foreground">
                        <Car className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden />
                        {t.criteria.parking}
                      </span>
                    </td>
                    <td className={cn("py-1.5 pr-2 align-top font-medium", VALUE_COLORS[parkingAttr.value])}>
                      {parkingValueLabel}
                    </td>
                    <td className="py-1.5 pr-2 align-top text-center">
                      {judgmentFilters.parking
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-primary inline" aria-label={t.results.tableFilteredYes} />
                        : <span className="inline-block w-1.5 h-1.5 rounded-full bg-border" aria-label={t.results.tableFilteredNo} />}
                    </td>
                    <td className="py-1.5 pr-2 align-top">
                      {parkingAttr.value !== "unknown" ? <ReliabilityBars attr={parkingAttr} /> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-1.5 align-top text-muted-foreground">
                      {parkingAttr.sources.length > 0
                        ? <>{parkingAttr.sources.map((s) => SOURCE_LABELS[s.sourceId]).join(", ")}{verifiedSuffix(t, parkingAttr)}</>
                        : "—"}
                    </td>
                  </tr>
                  {(parkingD.hasWheelchairSpaces != null || parkingD.spaceCount != null || parkingD.distanceToEntranceM != null || (parkingNearby && parkingNearbyDistM != null)) && (
                    <tr>
                      <td colSpan={5} className="pb-1.5">
                        <div className="ml-5 pl-3 pt-1 border-l border-border space-y-2">
                          {parkingD.hasWheelchairSpaces != null && (
                            <InfoRow icon={Car} label={t.details.parking.hasWheelchairSpaces}>
                              {parkingD.hasWheelchairSpaces ? "✓" : "✗"}
                            </InfoRow>
                          )}
                          {parkingD.spaceCount != null && (
                            <InfoRow icon={Hash} label={t.details.parking.spaceCount}>
                              {parkingD.spaceCount}
                            </InfoRow>
                          )}
                          {parkingD.distanceToEntranceM != null && (
                            <InfoRow icon={MapPin} label={t.details.parking.distanceToEntranceM}>
                              {parkingD.distanceToEntranceM} {t.details.units.m}
                            </InfoRow>
                          )}
                          {parkingNearby && parkingNearbyDistM != null && (
                            <InfoRow icon={Navigation} label={t.details.parking.nearbyParkingDistanceM}>
                              {parkingNearbyDistM} {t.details.units.m}
                            </InfoRow>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {acceslibreCommentaire && (
              <InfoRow icon={MessageSquare} label={ti.description}>
                <span className="italic">{acceslibreCommentaire}</span>
              </InfoRow>
            )}
            {reportFormId && (
              <button
                onClick={handleReportDataError}
                className={cn(
                  "flex items-center gap-1.5 text-xs hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm py-1 transition-colors",
                  reportButtonMode === "contribute" ? "text-green-700" : "text-primary-strong",
                )}
              >
                {reportButtonMode === "contribute"
                  ? <PenLine className="w-3.5 h-3.5" />
                  : <Flag className="w-3.5 h-3.5" />}
                {reportButtonMode === "contribute" ? ti.contributeDataInfo : ti.reportDataError}
              </button>
            )}
          </Section>

          {/* ── Grunddaten ── */}
          <Section title={ti.basicInfo} icon={MapPin} chipClass="bg-blue-50 text-blue-700 border-blue-200">
            {addrStr && (
              <InfoRow icon={MapPin} label={ti.address}>
                <span className="flex items-center gap-1.5 flex-wrap">
                  <span>{addrStr}</span>
                  {copiedField === "address" ? (
                    <span className="text-green-600 text-[11px] shrink-0">{t.common.copied}</span>
                  ) : (
                    <button
                      onClick={() => handleCopyField(addrStr, "address")}
                      className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                      aria-label={t.common.copied}
                      title={t.common.copied}
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  )}
                </span>
              </InfoRow>
            )}
            {place.phone && (
              <InfoRow icon={Phone} label={ti.phone}>
                <a href={`tel:${place.phone}`} className="text-blue-600 hover:underline">
                  {place.phone}
                </a>
              </InfoRow>
            )}
            {place.website && (
              <InfoRow icon={Globe} label={ti.website}>
                <NativeLink
                  href={place.website}
                  className="text-blue-600 hover:underline break-all"
                >
                  {place.website.replace(/^https?:\/\//, "")}
                </NativeLink>
              </InfoRow>
            )}
            <InfoRow icon={Tag} label={ti.category}>
              {(t.categories as Record<string, string>)[place.category] ?? place.category}
            </InfoRow>
            {email && (
              <InfoRow icon={Mail} label={ti.email}>
                <a href={`mailto:${email}`} className="text-blue-600 hover:underline">{email}</a>
              </InfoRow>
            )}
            {openingHours && (
              <InfoRow icon={Clock} label={ti.openingHours}>
                <span className="whitespace-pre-line">{openingHours}</span>
              </InfoRow>
            )}
          </Section>

          {/* ── Angebot ── */}
          {hasAngebot && (
            <Section title={ti.offer} icon={Utensils} chipClass="bg-amber-50 text-amber-700 border-amber-200">
              {cuisine && <InfoRow icon={Utensils} label={ti.cuisine}>{cuisine}</InfoRow>}
              {stars && (
                <InfoRow icon={Star} label={ti.stars}>{"★".repeat(Math.min(5, parseInt(stars, 10) || 0))} ({stars})</InfoRow>
              )}
              {googleRating && <InfoRow icon={Star} label={ti.rating}>{googleRating}</InfoRow>}
              {priceLevel && <InfoRow icon={DollarSign} label={ti.priceLevel}>{priceLevel}</InfoRow>}
              {(place.isVeganFriendly || place.isVegetarianFriendly) && (
                <InfoRow icon={Leaf} label={ti.diet}>
                  {[place.isVeganFriendly && ti.vegan, place.isVegetarianFriendly && ti.vegetarian]
                    .filter(Boolean).join(", ")}
                </InfoRow>
              )}
              {dogLabel && (
                <InfoRow icon={Dog} label={ti.dogs}>{dogLabel}</InfoRow>
              )}
              {takeaway && takeaway !== "no" && (
                <InfoRow icon={ShoppingBag} label={ti.takeaway}>
                  {takeaway === "only" ? ti.takeawayOnly : ti.yes}
                </InfoRow>
              )}
              {delivery && delivery !== "no" && (
                <InfoRow icon={Truck} label={ti.delivery}>{ti.yes}</InfoRow>
              )}
              {wifi && <InfoRow icon={Wifi} label={ti.wifi}>{ti.yes}</InfoRow>}
            </Section>
          )}

          {/* ── Externe Links ── */}
          <Section title={ti.externalLinks} icon={ExternalLink} chipClass="bg-zinc-100 text-zinc-600 border-zinc-200">
            {osmLink && (
              <InfoRow icon={ExternalLink} label="OpenStreetMap">
                <span className="flex items-center gap-1.5 flex-wrap">
                  <NativeLink href={osmLink} className="text-blue-600 hover:underline">
                    {osmRecord?.externalId}
                  </NativeLink>
                  {copiedField === "osm" ? (
                    <span className="text-green-600 text-[11px] shrink-0">{t.common.copied}</span>
                  ) : (
                    <button
                      onClick={() => handleCopyField(osmRecord?.externalId?.replace(/^\w+\//, "") ?? "", "osm")}
                      className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                      aria-label={t.common.copied}
                      title={t.common.copied}
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  )}
                </span>
              </InfoRow>
            )}
            <InfoRow icon={Accessibility} label="Wheelmap">
              <NativeLink href={wheelmapLink} className="text-blue-600 hover:underline">
                Wheelmap.org
              </NativeLink>
            </InfoRow>
            {place.gintoUrl && (
              <InfoRow icon={ShieldCheck} label="Ginto">
                <NativeLink href={place.gintoUrl} className="text-blue-600 hover:underline">
                  Ginto.guide
                </NativeLink>
              </InfoRow>
            )}
            {place.acceslibreUrl && (
              <InfoRow icon={ExternalLink} label="AccèsLibre">
                <NativeLink href={place.acceslibreUrl} className="text-blue-600 hover:underline">
                  acceslibre.beta.gouv.fr
                </NativeLink>
              </InfoRow>
            )}
            {place.sourceRecords.some((r) => r.sourceId === "reisen_fuer_alle") && (
              <InfoRow icon={Award} label="Reisen für Alle">
                <span className="text-muted-foreground">Zertifizierter Eintrag</span>
              </InfoRow>
            )}
            <InfoRow icon={ExternalLink} label="Google Maps">
              <NativeLink href={googleMapsLink} className="text-blue-600 hover:underline">
                Google Maps
              </NativeLink>
            </InfoRow>
          </Section>

          {/* ── Rohdaten (ausklappbar) ── */}
          <div className="py-4">
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              {showRaw
                ? <ChevronUp   className="w-3.5 h-3.5" />
                : <ChevronDown className="w-3.5 h-3.5" />}
              {showRaw ? ti.hideRawData : ti.showRawData}
            </button>

            {showRaw && (
              <div className="space-y-3 mt-2">
                {place.sourceRecords.map((rec, i) => (
                  <div key={i} className="border border-border rounded-md overflow-hidden">
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/50 flex-wrap">
                      <span className="font-medium text-xs">{SOURCE_LABELS[rec.sourceId]}</span>
                      <code className="font-mono text-muted-foreground text-[11px]">#{rec.externalId}</code>
                      <span className="text-muted-foreground text-[11px] ml-auto">
                        {new Date(rec.fetchedAt).toLocaleString()}
                      </span>
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
          </div>

          {/* ── Foto ── */}
          {placeImage && (
            <div className="py-4">
              <img
                src={placeImage}
                alt={place.name}
                loading="lazy"
                onLoad={() => setImageLoaded(true)}
                onError={() => setPlaceImage(null)}
                className={cn(
                  "w-full rounded-md object-cover max-h-64 transition-opacity duration-300",
                  imageLoaded ? "opacity-100" : "opacity-0 h-0",
                )}
              />
            </div>
          )}

        </div>

        {/* Sticky footer: navigation CTA (Placement 3 — docs/plans/native-navigate-here.md)
            + close button. Reachable regardless of scroll position within the
            accessibility-details content above. */}
        <div className="shrink-0 px-4 py-3 border-t border-border flex flex-col gap-2">
          <NavigateButton coords={place.coordinates} variant="sticky" />
          <button
            onClick={onClose}
            className="w-full py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  )
}
