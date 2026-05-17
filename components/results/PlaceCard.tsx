"use client"

import { useState } from "react"
import { createPortal } from "react-dom"
import { MapPin, Globe, Phone, ChevronDown, ChevronUp, Info, Accessibility, PawPrint, Salad, Leaf, Map, ShieldCheck, Loader2, Search, CheckCircle2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import ConfidenceBadge  from "./ConfidenceBadge"
import A11yAttribute    from "./A11yAttribute"
import PlaceDebugSheet  from "./PlaceDebugSheet"
import { useTranslations } from "@/lib/i18n"
import { SOURCE_LABELS }   from "@/lib/config"
import { cn } from "@/lib/utils"
import type { Place } from "@/lib/types"

interface Props {
  place:                Place
  isSelected?:          boolean
  onClick?:             () => void
  distanceM?:           number
  onShowNearbyParking?: (place: Place) => Promise<number>
  parkingNoResult?:     boolean
  parkingFoundCount?:   number
}

const CATEGORY_ICONS: Record<string, string> = {
  cafe:        "☕",
  restaurant:  "🍽",
  bar:         "🍸",
  pub:         "🍺",
  biergarten:  "🍻",
  fast_food:   "🍔",
  hotel:       "🏨",
  hostel:      "🛏",
  apartment:   "🏠",
  museum:      "🏛",
  theater:     "🎭",
  cinema:      "🎬",
  library:     "📚",
  gallery:     "🎨",
  attraction:  "🎡",
}

/** Set to false (or delete the footer block below) to revert option A */
const SHOW_MAP_FOOTER = true

export default function PlaceCard({ place, isSelected, onClick, distanceM, onShowNearbyParking, parkingNoResult, parkingFoundCount }: Props) {
  const t = useTranslations()
  const [expanded,        setExpanded]        = useState(false)
  const [showDebug,       setShowDebug]       = useState(false)
  const [loadingParking,  setLoadingParking]  = useState(false)

  const addr = [place.address.street, place.address.houseNumber, place.address.city]
    .filter(Boolean).join(" ")

  const criteriaKeys = ["entrance", "toilet", "parking"] as const
  const criteriaLabels = [t.criteria.entrance, t.criteria.toilet, t.criteria.parking]

  const allAttrs = [
    place.accessibility.entrance,
    place.accessibility.toilet,
    place.accessibility.parking,
    ...(place.accessibility.seating ? [place.accessibility.seating] : []),
  ]
  const HIDDEN_DETAIL_KEYS = new Set(["isInside"])
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
      // search/?api=1 is the documented cross-platform URL scheme; it works in both
      // the Google Maps web app and the native iOS app. The undocumented
      // /maps/place/?q=place_id:... format works on desktop but fails on iOS.
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

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md border overflow-hidden",
        isSelected ? "border-primary ring-1 ring-primary" : "border-border",
      )}
      onClick={onClick}
    >
      <CardContent className="p-3 flex flex-col gap-2">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <span className="text-base shrink-0" aria-hidden>
              {CATEGORY_ICONS[place.category] ?? "📍"}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-sm leading-snug truncate">
                {place.name}
              </h3>
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
          </div>
          <ConfidenceBadge confidence={place.overallConfidence} place={place} className="shrink-0" />
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
          <A11yAttribute label={t.criteria.entrance} attr={place.accessibility.entrance} detailType="entrance" showDetails={expanded} />
          <A11yAttribute label={t.criteria.toilet}   attr={place.accessibility.toilet}   detailType="toilet"   showDetails={expanded} />
          {/* Parking row — shows inline search button when value is unknown */}
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              {parkingFoundCount != null && parkingFoundCount > 0 ? (
                <div className="rounded-md px-2.5 py-1.5 flex flex-col gap-1 bg-green-50">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-600" />
                    <span className="text-xs font-medium text-foreground min-w-0 flex-1 truncate">{t.criteria.parking}</span>
                    <span className="text-xs shrink-0 text-green-600">{t.results.nearbyParkingCount(parkingFoundCount)}</span>
                  </div>
                </div>
              ) : (
                <A11yAttribute
                  label={t.criteria.parking}
                  attr={parkingNoResult ? { ...place.accessibility.parking, value: "no" } : place.accessibility.parking}
                  detailType="parking"
                  showDetails={expanded}
                />
              )}
            </div>
            {onShowNearbyParking && place.accessibility.parking.value === "unknown" && !parkingNoResult && !(parkingFoundCount && parkingFoundCount > 0) && (
              <button
                onClick={async (e) => {
                  e.stopPropagation()
                  setLoadingParking(true)
                  try { await onShowNearbyParking(place) } finally { setLoadingParking(false) }
                }}
                disabled={loadingParking}
                title={t.results.showNearbyParking}
                className="shrink-0 mt-1 inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
              >
                {loadingParking
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Search className="w-3 h-3" />
                }
              </button>
            )}
          </div>
          {place.accessibility.seating && (
            <A11yAttribute label={t.criteria.seating} attr={place.accessibility.seating} detailType="seating" showDetails={expanded} />
          )}
        </div>

        {/* ── Expand / contact ── */}
        <div className="flex items-center justify-between mt-0.5">
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); setShowDebug(true) }}
              aria-label={t.results.showRawData}
              title={t.results.showRawData}
              className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Info className="w-[1.1rem] h-[1.1rem]" />
            </button>
            {place.gintoUrl && (
              <a
                href={place.gintoUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t.results.gintoLink}
                title={t.results.gintoLink}
                onClick={(e) => e.stopPropagation()}
                className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ShieldCheck className="w-[1.1rem] h-[1.1rem]" />
              </a>
            )}
            {place.website && (
              <a
                href={place.website}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t.results.websiteLink}
                title={t.results.websiteLink}
                onClick={(e) => e.stopPropagation()}
                className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Globe className="w-[1.1rem] h-[1.1rem]" />
              </a>
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
            <a
              href={wheelmapHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t.results.wheelmapLink}
              title={t.results.wheelmapLink}
              onClick={(e) => e.stopPropagation()}
              className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Accessibility className="w-[1.1rem] h-[1.1rem]" />
            </a>
            <a
              href={googleMapsHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t.results.googleMapsLink}
              title={t.results.googleMapsLink}
              onClick={(e) => e.stopPropagation()}
              className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Map className="w-[1.1rem] h-[1.1rem]" />
            </a>
            {/* ── Map CTA inline (option A) — set SHOW_MAP_FOOTER=false above to revert ── */}
            {SHOW_MAP_FOOTER && onClick && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground ml-1 pl-2 border-l border-border">
                <MapPin className="w-[1.1rem] h-[1.1rem] shrink-0 text-primary" />
                {t.results.showOnMap}
              </span>
            )}
          </div>

          {hasAnyDetails && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? <ChevronUp className="w-[1.1rem] h-[1.1rem]" /> : <ChevronDown className="w-[1.1rem] h-[1.1rem]" />}
              {expanded ? t.results.detailsCollapse : t.results.detailsExpand}
            </button>
          )}
        </div>
      </CardContent>

      {showDebug && createPortal(
        <PlaceDebugSheet place={place} onClose={() => setShowDebug(false)} />,
        document.body,
      )}
    </Card>
  )
}
