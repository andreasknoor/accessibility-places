"use client"

import { useState } from "react"
import { MapPin, Map, Accessibility, Flag } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { NativeLink } from "@/components/ui/native-link"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import CriterionBox, { type CriterionTone } from "@/components/results/CriterionBox"
import { SOURCE_LABELS } from "@/lib/config"
import type { AmenityFeature, AmenityType } from "@/lib/types"

interface Props {
  spot:        AmenityFeature
  amenityType: AmenityType
  isSelected?: boolean
  onClick?:    () => void
  distanceM?:  number
}

// Mirrors PlaceCard's layout (header / criteria pill / detail rows / footer
// with external links + "Zur Karte") so amenity results read consistently
// with venue results — only the criteria shown differ (point-feature data
// has no entrance/toilet/seating, just what OSM tags on the node itself).
export default function AmenityCard({ spot, amenityType, isSelected, onClick, distanceM }: Props) {
  const t = useTranslations()
  const [reportState, setReportState] = useState<"idle" | "sending" | "done" | "error">("idle")

  const isParking = amenityType === "parking"
  const tier = spot.tier === "weak" ? "weak" : "strong"

  const title = isParking
    ? (tier === "weak"
        ? t.map.parkingAccessible
        : spot.capacity != null && spot.capacity > 0 ? t.map.parkingSpots(spot.capacity) : t.map.parkingSpot)
    : (tier === "strong" ? t.map.toiletDesignated : t.map.toiletAccessible)

  const hostName = !isParking && spot.host?.kind === "venue"
    ? (spot.host.name ?? t.map.toiletVenueGeneric)
    : undefined

  // Fee / access badges (parking) — only shown when the OSM tag is present.
  const feeText = isParking
    ? (spot.fee === "no" ? t.map.parkingFree : spot.fee === "yes" ? t.map.parkingPaid : spot.fee ?? undefined)
    : undefined
  const accessText = isParking
    ? (spot.access === "private" ? t.map.parkingPrivate : spot.access === "customers" ? t.map.parkingCustomers : undefined)
    : (spot.host?.access === "customers" || spot.access === "customers" ? t.map.toiletCustomers : undefined)
  const maxstayText = isParking ? spot.maxstay : undefined

  // Unified accessibility-criterion box (same visual as the venue A11yAttribute
  // rows). The box header *is* the wheelchair verdict — for parking the tier is
  // also reflected by the colour (green=reserved, amber=accessible-only) and the
  // clarifying note, so there is no second "Rollstuhlgerecht" row.
  const tone: CriterionTone = tier === "strong" ? "yes" : "limited"
  const boxValue = isParking
    ? t.a11y.yes
    : (tier === "strong" ? t.map.toiletDesignatedValue : t.a11y.yes)
  const boxRows: { label: string; value: string; tone?: CriterionTone }[] = []
  if (isParking) {
    // The decisive parking distinction: reserved/dedicated bays (strong) vs a
    // merely accessible lot anyone may use (weak). Shown first, with a ✓/✗ icon.
    boxRows.push({
      label: t.map.parkingDedicatedLabel,
      value: tier === "strong" ? t.a11y.yes : t.a11y.no,
      tone:  tier === "strong" ? "yes" : "no",
    })
    if (feeText)     boxRows.push({ label: t.map.parkingFeeLabel,   value: feeText })
    if (maxstayText) boxRows.push({ label: t.map.parkingMaxstay,    value: maxstayText })
    if (accessText)  boxRows.push({ label: t.map.toiletAccessLabel, value: accessText })
  } else {
    if (spot.euroKey)       boxRows.push({ label: t.map.toiletEuroKey,       value: "✓" })
    if (spot.changingTable) boxRows.push({ label: t.map.toiletChangingTable, value: "✓" })
    if (accessText)         boxRows.push({ label: t.map.toiletAccessLabel,   value: accessText })
  }

  // Wheelmap only indexes OSM nodes, not ways/relations.
  const osmNodeId   = spot.osmId?.startsWith("node/") ? spot.osmId.slice(5) : undefined
  const wheelmapUrl = osmNodeId ? `https://wheelmap.org/nodes/${osmNodeId}` : undefined
  const googleMapsHref = `https://www.google.com/maps?q=${spot.lat},${spot.lon}`

  function reportWeakParking() {
    setReportState("sending")
    fetch("/api/report-parking", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ lat: spot.lat, lon: spot.lon, osmId: spot.osmId }),
    })
      .then((r) => setReportState(r.ok ? "done" : "error"))
      .catch(() => setReportState("error"))
  }

  return (
    <Card
      className={cn(
        "transition-all shadow-sm border overflow-hidden",
        isSelected ? "border-primary ring-1 ring-primary" : "border-card-border",
      )}
    >
      <CardContent className="p-3 flex flex-col gap-2">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <span className="text-base shrink-0" aria-hidden>{isParking ? "🅿" : "🚻"}</span>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-sm leading-snug break-words">
                {hostName ?? title}
              </h3>
              {/* Type line only when the header shows a venue name — for a
                  standalone amenity the title already names it (and a contradictory
                  "Behindertenparkplatz" sub-label under a weak-tier "accessible
                  parking" title is exactly what we want to avoid). */}
              {hostName && (
                <p className="text-xs text-muted-foreground mt-0.5">{title}</p>
              )}
              {distanceM !== undefined && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span>{t.results.distanceFromHere(Math.round(distanceM))}</span>
                </p>
              )}
            </div>
          </div>
          {/* Reservation-status badge — top-right, mirroring the venue card's
              confidence badge slot. The at-a-glance distinction between a reserved
              disabled bay (green) and a merely accessible lot (amber). Word-carried
              so colour is only reinforcement (WCAG). */}
          {isParking && (
            <span className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 self-start",
              tier === "strong" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800",
            )}>
              <span
                className={cn("w-1.5 h-1.5 rounded-full", tier === "strong" ? "bg-green-600" : "bg-amber-500")}
                aria-hidden
              />
              {tier === "strong" ? t.map.parkingReservedBadge : t.map.parkingNotReservedBadge}
            </span>
          )}
        </div>

        {/* ── Accessibility criterion (same visual as venue A11yAttribute rows) ── */}
        <CriterionBox
          tone={tone}
          label={t.map.toiletWheelchairLabel}
          value={boxValue}
          rows={boxRows}
          rowsVariant="criterion"
        />

        {/* ── Data source — amenity features are single-source (OSM/Overpass). ── */}
        <p className="text-[11px] text-muted-foreground">
          {t.map.source}: {SOURCE_LABELS.osm}
        </p>

        {/* ── Footer: external links + report (weak parking) + "Zur Karte" ── */}
        <div className="flex items-center justify-between mt-0.5">
          <div className="flex items-center gap-3">
            <NativeLink
              href={googleMapsHref}
              aria-label={t.results.googleMapsLink}
              title={t.results.googleMapsLink}
              onClick={(e) => e.stopPropagation()}
              className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Map className="w-[1.1rem] h-[1.1rem]" />
            </NativeLink>
            {wheelmapUrl && (
              <NativeLink
                href={wheelmapUrl}
                aria-label={t.results.wheelmapLink}
                title={t.results.wheelmapLink}
                onClick={(e) => e.stopPropagation()}
                className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Accessibility className="w-[1.1rem] h-[1.1rem]" />
              </NativeLink>
            )}
            {isParking && tier === "weak" && (
              <button
                onClick={(e) => { e.stopPropagation(); if (reportState === "idle") reportWeakParking() }}
                disabled={reportState !== "idle"}
                className="flex items-center gap-1 text-xs text-amber-700 hover:underline disabled:no-underline disabled:opacity-70"
              >
                <Flag className="w-[1.1rem] h-[1.1rem] shrink-0" />
                {reportState === "idle"    ? t.map.parkingReportButton
                  : reportState === "sending" ? t.map.parkingReportButton
                  : reportState === "done"    ? t.map.parkingReportDone
                  : t.map.parkingReportError}
              </button>
            )}
          </div>

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
      </CardContent>
    </Card>
  )
}
