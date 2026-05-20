"use client"

import { useState } from "react"
import {
  X, MapPin, Phone, Globe, Tag, Clock, Mail,
  Utensils, Leaf, Dog, Wifi, Star, DollarSign,
  MessageSquare, ExternalLink, Accessibility,
  ShieldCheck, Award, ChevronDown, ChevronUp,
  Truck, ShoppingBag,
} from "lucide-react"
import { SOURCE_LABELS } from "@/lib/config"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Place, SourceId } from "@/lib/types"

interface Props {
  place:   Place
  onClose: () => void
}

const VALUE_COLORS: Record<string, string> = {
  yes:     "text-green-600",
  limited: "text-amber-600",
  no:      "text-red-600",
  unknown: "text-zinc-400",
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

export default function PlaceDebugSheet({ place, onClose }: Props) {
  const t  = useTranslations()
  const ti = t.info
  const [showRaw, setShowRaw] = useState(false)

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
  const addrStr   = [addrLine1, addrLine2].filter(Boolean).join(", ")

  const criteria = [
    { key: "entrance" as const, label: t.criteria.entrance, attr: place.accessibility.entrance },
    { key: "toilet"   as const, label: t.criteria.toilet,   attr: place.accessibility.toilet   },
    { key: "parking"  as const, label: t.criteria.parking,  attr: place.accessibility.parking  },
    ...(place.accessibility.seating
      ? [{ key: "seating" as const, label: t.criteria.seating, attr: place.accessibility.seating }]
      : []),
  ]

  const osmRecord  = place.sourceRecords.find((r) => r.sourceId === "osm")
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
      <div className="fixed right-0 top-0 z-[1051] h-full w-[520px] max-w-full bg-white shadow-2xl border-l border-border flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{place.name}</p>
            {addrStr && <p className="text-xs text-muted-foreground mt-0.5 truncate">{addrStr}</p>}
          </div>
          <button
            onClick={onClose}
            onTouchEnd={(e) => { e.preventDefault(); onClose() }}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 text-xs">

          {/* ── Grunddaten ── */}
          <Section title={ti.basicInfo}>
            {addrStr && (
              <InfoRow icon={MapPin} label={ti.address}>{addrStr}</InfoRow>
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
                <a
                  href={place.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline break-all"
                >
                  {place.website.replace(/^https?:\/\//, "")}
                </a>
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
            <Section title={ti.offer}>
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

          {/* ── Barrierefreiheit ── */}
          <Section title={`${ti.accessibility} (${ti.reliability}: ${Math.round(place.overallConfidence * 100)}%)`}>
            {wheelchairDesc && (
              <InfoRow icon={MessageSquare} label={ti.description}>{wheelchairDesc}</InfoRow>
            )}
            {criteria.map(({ key, label, attr }) => (
              <InfoRow key={key} icon={Accessibility} label={label}>
                <span className={cn("font-medium", VALUE_COLORS[attr.value])}>
                  {t.a11y[attr.value]}
                </span>
                {attr.sources.length > 0 && (
                  <span className="text-muted-foreground ml-1.5">
                    · {attr.sources.map((s) => SOURCE_LABELS[s.sourceId]).join(", ")}
                  </span>
                )}
              </InfoRow>
            ))}
          </Section>

          {/* ── Externe Links ── */}
          <Section title={ti.externalLinks}>
            {osmLink && (
              <InfoRow icon={ExternalLink} label="OpenStreetMap">
                <a href={osmLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  {osmRecord?.externalId}
                </a>
              </InfoRow>
            )}
            <InfoRow icon={Accessibility} label="Wheelmap">
              <a href={wheelmapLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                Wheelmap.org
              </a>
            </InfoRow>
            {place.gintoUrl && (
              <InfoRow icon={ShieldCheck} label="Ginto">
                <a href={place.gintoUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  Ginto.guide
                </a>
              </InfoRow>
            )}
            {place.sourceRecords.some((r) => r.sourceId === "reisen_fuer_alle") && (
              <InfoRow icon={Award} label="Reisen für Alle">
                <span className="text-muted-foreground">Zertifizierter Eintrag</span>
              </InfoRow>
            )}
            <InfoRow icon={ExternalLink} label="Google Maps">
              <a href={googleMapsLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                Google Maps
              </a>
            </InfoRow>
          </Section>

          {/* ── Rohdaten (ausklappbar) ── */}
          <div className="pt-1 border-t border-border">
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
                        : rec.metadata != null
                          ? JSON.stringify(rec.metadata, null, 2)
                          : "(no data)"}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Sticky close button */}
        <div className="shrink-0 px-4 py-3 border-t border-border">
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
