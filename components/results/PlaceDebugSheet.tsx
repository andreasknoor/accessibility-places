"use client"

import { useState, useRef, useEffect } from "react"
import {
  X, MapPin, Phone, Globe, Tag, Clock, Mail,
  Utensils, Leaf, Dog, Wifi, Star, DollarSign,
  MessageSquare, ExternalLink, Accessibility,
  ShieldCheck, Award, ChevronDown, ChevronUp,
  Truck, ShoppingBag, Link2, Car, Hash, Navigation, Copy,
} from "lucide-react"
import { SOURCE_LABELS } from "@/lib/config"
import { NativeLink } from "@/components/ui/native-link"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Place, SourceId, ParkingDetails } from "@/lib/types"

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
  return (
    <section className="py-4">
      <div className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold mb-3 border", chipClass)}>
        <Icon className="w-3 h-3 shrink-0" />
        <span className="uppercase tracking-wide">{title}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

export default function PlaceDebugSheet({ place, onClose }: Props) {
  const [linkCopied,   setLinkCopied]   = useState(false)
  const [copiedField,  setCopiedField]  = useState<"address" | "osm" | null>(null)
  const copyTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fieldTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  function handleCopyLink() {
    const homePath = window.location.pathname.startsWith("/en") ? "/en/" : "/"
    const params = new URLSearchParams({
      selectLat:  String(place.coordinates.lat),
      selectLon:  String(place.coordinates.lon),
      selectName: place.name,
      cat:        place.category,
    })
    void navigator.clipboard.writeText(`${window.location.origin}${homePath}?${params}`).then(() => {
      setLinkCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setLinkCopied(false), 2000)
    })
  }
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

  const criteria = [
    { key: "entrance" as const, label: t.criteria.entrance, attr: place.accessibility.entrance },
    { key: "toilet"   as const, label: t.criteria.toilet,   attr: place.accessibility.toilet   },
    ...(place.accessibility.seating
      ? [{ key: "seating" as const, label: t.criteria.seating, attr: place.accessibility.seating }]
      : []),
  ]

  const parkingAttr = place.accessibility.parking
  const parkingD    = parkingAttr.details as ParkingDetails
  const parkingNearby = parkingD.nearbyOnly === true
  const parkingNearbyDistM = parkingD.nearbyParkingDistanceM
  const parkingValueLabel  = parkingNearby
    ? `${t.a11y.yesNearby}${parkingNearbyDistM != null ? ` (${parkingNearbyDistM} m)` : ""}`
    : t.a11y[parkingAttr.value]

  const osmRecord  = place.sourceRecords.find((r) => r.sourceId === "osm")

  const googleRecord = place.sourceRecords.find((r) => r.sourceId === "google_places")

  // Image priority: Google Places photo (if source active) → OSM image/wikimedia_commons → Wikidata P18
  useEffect(() => {
    setPlaceImage(null)
    setImageLoaded(false)

    const controller = new AbortController()

    // Google: photoName is stored as photos[0].name in Google Places metadata
    const googleMeta = googleRecord ? (googleRecord.metadata ?? googleRecord.raw) as Record<string, unknown> | null : null
    const photoName  = (Array.isArray(googleMeta?.photos) && googleMeta.photos.length > 0)
      ? (googleMeta.photos[0] as Record<string, unknown>)?.name
      : undefined
    if (typeof photoName === "string" && photoName) {
      fetch(`/api/image/google?photoName=${encodeURIComponent(photoName)}`, { signal: controller.signal })
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d?.url) setPlaceImage(d.url) })
        .catch(() => {})
      return () => controller.abort()
    }

    // Fallback: OSM image/wikimedia_commons/wikidata
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
  }, [googleRecord?.externalId, osmRecord?.externalId])

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
          <div className="flex items-center gap-3 shrink-0 mt-0.5">
            {linkCopied ? (
              <span className="text-xs text-green-600 px-1">{t.results.linkCopied}</span>
            ) : (
              <button
                onClick={handleCopyLink}
                className="text-muted-foreground hover:text-foreground transition-colors p-1.5 -m-1.5"
                aria-label={t.results.copyLink}
                title={t.results.copyLink}
              >
                <Link2 className="w-4 h-4" />
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

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 text-xs divide-y divide-border">

          {/* ── Barrierefreiheit + Parkplatz ── */}
          <Section
            title={`${ti.reliability} · ${Math.round(place.overallConfidence * 100)}%`}
            icon={Accessibility}
            chipClass="bg-green-50 text-green-700 border-green-200"
          >
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
            {/* Parkplatz — innerhalb der Barrierefreiheits-Sektion */}
            <InfoRow icon={Car} label={t.criteria.parking}>
              <span className={cn("font-medium", VALUE_COLORS[parkingAttr.value])}>
                {parkingValueLabel}
              </span>
              {parkingAttr.sources.length > 0 && (
                <span className="text-muted-foreground ml-1.5">
                  · {parkingAttr.sources.map((s) => SOURCE_LABELS[s.sourceId]).join(", ")}
                </span>
              )}
            </InfoRow>
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
                        : rec.metadata != null
                          ? JSON.stringify(rec.metadata, null, 2)
                          : "(no data)"}
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
