"use client"

import { useState } from "react"
import { createPortal } from "react-dom"
import { MapPin, Globe, Phone, ChevronDown, ChevronUp, ChevronRight, Accessibility, PawPrint, Salad, Leaf, Map, ShieldCheck } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { NativeLink } from "@/components/ui/native-link"
import NavigateButton from "@/components/ui/navigate-button"
import { Badge } from "@/components/ui/badge"
import ConfidenceBadge, { VerifiedBadge } from "./ConfidenceBadge"
import A11yAttribute    from "./A11yAttribute"
import PlaceDebugSheet  from "./PlaceDebugSheet"
import { NotAccessibleWarningBox, NotAccessibleWarningToggle } from "./NotAccessibleWarning"
import { track } from "@/lib/analytics"
import { useTranslations } from "@/lib/i18n"
import { SOURCE_LABELS }   from "@/lib/config"
import { CATEGORY_ICONS }  from "@/lib/category-icons"
import { placeMayNotBeAccessible } from "@/lib/matching/merge"
import { cn } from "@/lib/utils"
import type { Place } from "@/lib/types"

interface Props {
  place:       Place
  isSelected?: boolean
  onClick?:    () => void
  distanceM?:  number
}

export default function PlaceCard({ place, isSelected, onClick, distanceM }: Props) {
  const t = useTranslations()
  const [expanded,  setExpanded]  = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const [warnExpanded, setWarnExpanded] = useState(false)
  const showNotAccessibleWarning = placeMayNotBeAccessible(place)
  const notAccessibleToggle = (value: string) =>
    showNotAccessibleWarning && (value === "no" || value === "unknown")
      ? <NotAccessibleWarningToggle expanded={warnExpanded} onToggle={() => setWarnExpanded((v) => !v)} />
      : undefined

  const addr = [place.address.street, place.address.houseNumber, place.address.city]
    .filter(Boolean).join(" ")

  const allAttrs = [
    place.accessibility.entrance,
    place.accessibility.toilet,
    place.accessibility.parking,
    ...(place.accessibility.seating ? [place.accessibility.seating] : []),
  ]
  const HIDDEN_DETAIL_KEYS = new Set(["isInside", "nearbyOnly", "nearbyParkingDistanceM"])
  const hasAnyDetails = allAttrs.some((attr) =>
    Object.entries(attr.details).some(([k, v]) => v != null && !HIDDEN_DETAIL_KEYS.has(k)),
  )

  // Wheelmap deep-link priority:
  //   1. authoritative URL from accessibility.cloud (`infoPageUrl`)
  //   2. constructed URL from an OSM node id
  //   3. coordinate-centred map view that always works
  const googleMapsHref = (() => {
    const gRecord = place.sourceRecords.find((r) => r.sourceId === "google_places")
    const query = [place.name, place.address.city].filter(Boolean).join(" ")
    if (gRecord?.externalId) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}&query_place_id=${gRecord.externalId}`
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
  })()

  const wheelmapHref = (() => {
    if (place.wheelmapUrl) return place.wheelmapUrl
    const osm = place.sourceRecords.find((r) => r.sourceId === "osm")
    if (osm) {
      const [type, id] = osm.externalId.split("/")
      if (type === "node" && id) return `https://wheelmap.org/nodes/${id}`
    }
    return `https://wheelmap.org/?lat=${place.coordinates.lat}&lon=${place.coordinates.lon}&zoom=19`
  })()

  function openDetails() {
    setShowDebug(true)
    track("detail_sheet_open", { category: place.category })
  }

  return (
    <Card
      className={cn(
        "transition-all shadow-sm border overflow-hidden",
        isSelected ? "border-primary ring-1 ring-primary" : "border-card-border",
      )}
    >
      <CardContent className="p-3 flex flex-col gap-2">
        {/* ── Header: the single tap target that opens the detail sheet ──
            A framed, inset box (not touching the card's own edges/corners) so
            it reads as one clickable control, not a whole clickable card with
            scattered interactive icons in it. role="button" div, not a real
            <button>, because <button>'s content model forbids a heading (h3)
            child — a real button can't legally wrap place.name's <h3>. The
            confidence badge is a plain, non-stopPropagation child here
            (decision D2c): tapping it opens this same detail sheet instead of
            its own separate quick-view, so there is exactly one exception-free
            tap target for the whole box, badge included. */}
        <div
          role="button"
          tabIndex={0}
          onClick={openDetails}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetails() }
          }}
          aria-label={t.results.openDetails(place.name)}
          className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2 cursor-pointer hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="text-base shrink-0" aria-hidden>
            {CATEGORY_ICONS[place.category] ?? "📍"}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm leading-snug line-clamp-2 break-words">
              {place.name}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {(t.categories as Record<string, string>)[place.category] ?? place.category}
            </p>
            {(addr || distanceM !== undefined) && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3 shrink-0" />
                {addr && <span className="truncate min-w-0">{addr}</span>}
                {distanceM !== undefined && (
                  <>
                    {addr && <span className="shrink-0">·</span>}
                    <span className="shrink-0">{t.results.distanceFromHere(Math.round(distanceM))}</span>
                  </>
                )}
              </p>
            )}
          </div>
          <ConfidenceBadge confidence={place.overallConfidence} place={place} className="shrink-0 self-start" />
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 self-center mt-0.5" aria-hidden />
        </div>

        {/* ── Source badge ── */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground">{t.results.primarySource}:</span>
          <Badge variant="secondary" className="text-xs px-1.5 py-0">
            {SOURCE_LABELS[place.primarySource]}
          </Badge>
          {place.sourceRecords.length > 1 && (
            <span className="text-xs text-muted-foreground">
              +{place.sourceRecords.length - 1}
            </span>
          )}
          {place.allowsDogs !== undefined && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-xs",
                place.allowsDogs ? "text-amber-700" : "text-muted-foreground line-through",
              )}
              title={place.allowsDogs ? t.results.allowsDogs : t.results.noDogs}
              aria-label={place.allowsDogs ? t.results.allowsDogs : t.results.noDogs}
            >
              <PawPrint className="w-3 h-3" />
              <span>{place.allowsDogs ? t.results.allowsDogs : t.results.noDogs}</span>
            </span>
          )}
          {place.isVegetarianFriendly === true && (
            <span
              className="inline-flex items-center gap-0.5 text-xs text-emerald-700"
              title={t.results.vegetarian}
              aria-label={t.results.vegetarian}
            >
              <Salad className="w-3 h-3" />
              <span>{t.results.vegetarian}</span>
            </span>
          )}
          {place.isVeganFriendly === true && (
            <span
              className="inline-flex items-center gap-0.5 text-xs text-green-700"
              title={t.results.vegan}
              aria-label={t.results.vegan}
            >
              <Leaf className="w-3 h-3" />
              <span>{t.results.vegan}</span>
            </span>
          )}
        </div>

        {/* ── Accessibility attributes ── */}
        <div className="flex flex-col gap-1.5">
          <A11yAttribute label={t.criteria.entrance} attr={place.accessibility.entrance} detailType="entrance" showDetails={expanded} headerExtra={notAccessibleToggle(place.accessibility.entrance.value)} />
          <A11yAttribute label={t.criteria.toilet}   attr={place.accessibility.toilet}   detailType="toilet"   showDetails={expanded} headerExtra={notAccessibleToggle(place.accessibility.toilet.value)} />
          <A11yAttribute label={t.criteria.parking} attr={place.accessibility.parking} detailType="parking" showDetails={expanded} />
          {place.accessibility.seating && (
            <A11yAttribute label={t.criteria.seating} attr={place.accessibility.seating} detailType="seating" showDetails={expanded} />
          )}
        </div>

        {showNotAccessibleWarning && warnExpanded && <NotAccessibleWarningBox />}

        {/* ── Expand / contact ── */}
        <div className="flex items-center justify-between mt-0.5">
          <div className="flex items-center gap-3">
            {place.gintoUrl && (
              <NativeLink
                href={place.gintoUrl}
                aria-label={t.results.gintoLink}
                title={t.results.gintoLink}
                onClick={(e) => e.stopPropagation()}
                className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ShieldCheck className="w-[1.1rem] h-[1.1rem]" />
              </NativeLink>
            )}
            {place.website && (
              <NativeLink
                href={place.website}
                aria-label={t.results.websiteLink}
                title={t.results.websiteLink}
                onClick={(e) => e.stopPropagation()}
                className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Globe className="w-[1.1rem] h-[1.1rem]" />
              </NativeLink>
            )}
            {place.phone && (
              <a
                href={`tel:${place.phone}`}
                aria-label={t.results.phoneLink}
                title={t.results.phoneLink}
                onClick={(e) => e.stopPropagation()}
                className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Phone className="w-[1.1rem] h-[1.1rem]" />
              </a>
            )}
            <NativeLink
              href={wheelmapHref}
              aria-label={t.results.wheelmapLink}
              title={t.results.wheelmapLink}
              onClick={(e) => e.stopPropagation()}
              className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Accessibility className="w-[1.1rem] h-[1.1rem]" />
            </NativeLink>
            <NativeLink
              href={googleMapsHref}
              aria-label={t.results.googleMapsLink}
              title={t.results.googleMapsLink}
              onClick={(e) => e.stopPropagation()}
              className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Map className="w-[1.1rem] h-[1.1rem]" />
            </NativeLink>
            <NavigateButton coords={place.coordinates} variant="icon" />
            <VerifiedBadge place={place} />
          </div>

          <div className="flex items-center gap-2">
            {hasAnyDetails && (
              <button
                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {expanded ? <ChevronUp className="w-[1.1rem] h-[1.1rem]" /> : <ChevronDown className="w-[1.1rem] h-[1.1rem]" />}
                {expanded ? t.results.detailsCollapse : t.results.detailsExpand}
              </button>
            )}
            {onClick && (
              <button
                onClick={(e) => { e.stopPropagation(); onClick() }}
                className="flex items-center gap-1 text-xs text-primary bg-primary/10 hover:bg-primary/20 transition-colors rounded-full px-2.5 py-1"
                aria-label={t.results.showOnMap}
                title={t.results.showOnMap}
              >
                <MapPin className="w-[1.1rem] h-[1.1rem] shrink-0" />
                {t.results.showOnMap}
              </button>
            )}
          </div>
        </div>
      </CardContent>

      {showDebug && createPortal(
        <PlaceDebugSheet place={place} onClose={() => setShowDebug(false)} />,
        document.body,
      )}
    </Card>
  )
}
