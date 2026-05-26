import Link from "next/link"
import { Accessibility, Map, Globe } from "lucide-react"
import type { Place, A11yValue, EntranceDetails, ToiletDetails, ParkingDetails } from "@/lib/types"
import { CITIES, SEO_CATEGORY_LABEL, SEO_CATEGORY_TO_CHIP_IDX, type City } from "@/lib/cities"
import { confidenceLabel } from "@/lib/matching/merge"
import { hasData } from "@/lib/seo-validity"
import NavigationProgress from "@/components/seo/NavigationProgress"

const BASE = "https://accessible-places.org"

type Locale = "de" | "en"

interface Props {
  locale:       Locale
  city:         City
  categorySlug: string
  places:       Place[]
}

// ─── A11y value helpers ──────────────────────────────────────────────────────

const VALUE_LABEL: Record<A11yValue, { de: string; en: string }> = {
  yes:     { de: "Ja",           en: "Yes" },
  limited: { de: "Eingeschränkt", en: "Limited" },
  no:      { de: "Nein",         en: "No" },
  unknown: { de: "Unbekannt",    en: "Unknown" },
}

const VALUE_CLASSES: Record<A11yValue, string> = {
  yes:     "bg-green-100 text-green-800",
  limited: "bg-amber-100 text-amber-800",
  no:      "bg-red-100 text-red-800",
  unknown: "bg-gray-100 text-gray-500",
}

function a11yLabel(value: A11yValue, locale: Locale) {
  return VALUE_LABEL[value][locale]
}

// ─── Detail item builders ────────────────────────────────────────────────────

function entranceDetailItems(d: EntranceDetails, locale: Locale): string[] {
  const de = locale === "de"
  const items: string[] = []
  if (d.isLevel === true)              items.push(de ? "Ebenerdig"           : "Level access")
  if (d.isLevel === false)             items.push(de ? "Stufe(n)"            : "Steps present")
  if (d.hasRamp)                       items.push(de ? "Rampe"               : "Ramp")
  if (d.rampSlopePercent !== undefined) items.push(de ? `Neigung: ${d.rampSlopePercent}%` : `Slope: ${d.rampSlopePercent}%`)
  if (d.doorWidthCm      !== undefined) items.push(de ? `Türbreite: ${d.doorWidthCm} cm`  : `Door: ${d.doorWidthCm} cm`)
  if (d.stepCount        !== undefined && d.stepCount > 0)
                                        items.push(de ? `${d.stepCount} Stufe${d.stepCount !== 1 ? "n" : ""}` : `${d.stepCount} step${d.stepCount !== 1 ? "s" : ""}`)
  if (d.stepHeightCm     !== undefined) items.push(de ? `Stufenhöhe: ${d.stepHeightCm} cm` : `Step height: ${d.stepHeightCm} cm`)
  if (d.hasAutomaticDoor)              items.push(de ? "Automatische Tür"    : "Automatic door")
  if (d.hasHoist)                      items.push(de ? "Hebebühne"           : "Hoist/lift")
  if (d.description)                   items.push(d.description)
  return items
}

function toiletDetailItems(d: ToiletDetails, locale: Locale): string[] {
  const de = locale === "de"
  const items: string[] = []
  if (d.isDesignated)                   items.push(de ? "Rollstuhl-WC"           : "Wheelchair toilet")
  if (d.hasGrabBars)                    items.push(de ? "Haltegriffe"            : "Grab bars")
  if (d.grabBarsOnBothSides)            items.push(de ? "Beidseitige Haltegriffe" : "Grab bars both sides")
  if (d.turningRadiusCm !== undefined)  items.push(de ? `Wendekreis: ${d.turningRadiusCm} cm` : `Turning radius: ${d.turningRadiusCm} cm`)
  if (d.doorWidthCm     !== undefined)  items.push(de ? `Türbreite: ${d.doorWidthCm} cm`      : `Door: ${d.doorWidthCm} cm`)
  if (d.isInside === true)              items.push(de ? "WC im Gebäude"          : "Inside venue")
  if (d.hasEmergencyPullstring)         items.push(de ? "Notrufzug"              : "Emergency cord")
  return items
}

function parkingDetailItems(d: ParkingDetails, locale: Locale): string[] {
  const de = locale === "de"
  const items: string[] = []
  if (d.hasWheelchairSpaces)             items.push(de ? "Behindertenparkplätze vorhanden" : "Disabled parking available")
  if (d.spaceCount         !== undefined) items.push(de ? `${d.spaceCount} Plätze`          : `${d.spaceCount} spaces`)
  if (d.distanceToEntranceM !== undefined) items.push(de ? `Abstand zum Eingang: ${d.distanceToEntranceM} m` : `Distance to entrance: ${d.distanceToEntranceM} m`)
  return items
}

function parkingValueLabel(attr: { value: A11yValue; details?: unknown }, locale: Locale): string {
  const d = attr.details as ParkingDetails | undefined
  if (attr.value === "yes" && d?.nearbyOnly) {
    const dist = d.nearbyParkingDistanceM != null ? ` (${d.nearbyParkingDistanceM}m)` : ""
    return locale === "de" ? `Ja, in der Nähe${dist}` : `Yes, nearby${dist}`
  }
  return VALUE_LABEL[attr.value][locale]
}

// ─── Schema.org category types ──────────────────────────────────────────────

const CATEGORY_SCHEMA_TYPE: Record<string, string> = {
  cafe:        "CafeOrCoffeeShop",
  restaurant:  "Restaurant",
  bar:         "BarOrPub",
  pub:         "BarOrPub",
  biergarten:  "FoodEstablishment",
  fast_food:   "FastFoodRestaurant",
  hotel:       "Hotel",
  hostel:      "Hostel",
  apartment:   "LodgingBusiness",
  museum:      "Museum",
  theater:     "PerformingArtsTheater",
  cinema:      "MovieTheater",
  library:     "Library",
  gallery:     "ArtGallery",
  attraction:  "TouristAttraction",
  ice_cream:   "FoodEstablishment",
}

// ─── amenityFeature builder ──────────────────────────────────────────────────

type LdFeature = { "@type": "LocationFeatureSpecification"; name: string; value: boolean | string | number }

function buildAmenityFeatures(place: Place): LdFeature[] {
  const f = (name: string, value: boolean | string | number): LdFeature =>
    ({ "@type": "LocationFeatureSpecification", name, value })

  const features: LdFeature[] = []

  const entrance = place.accessibility.entrance
  if (entrance && entrance.value !== "unknown") {
    features.push(f("Wheelchair-accessible entrance", entrance.value !== "no"))
    const d = entrance.details as EntranceDetails | undefined
    if (d) {
      if (d.isLevel === true)             features.push(f("Level access (no steps)", true))
      if (d.hasRamp)                      features.push(f("Ramp available", true))
      if (d.doorWidthCm !== undefined)    features.push(f("Entrance door width", `${d.doorWidthCm} cm`))
      if (d.hasAutomaticDoor)            features.push(f("Automatic door", true))
    }
  }

  const toilet = place.accessibility.toilet
  if (toilet && toilet.value !== "unknown") {
    features.push(f("Accessible toilet", toilet.value !== "no"))
    const d = toilet.details as ToiletDetails | undefined
    if (d) {
      if (d.isDesignated)                  features.push(f("Designated wheelchair toilet", true))
      if (d.hasGrabBars)                   features.push(f("Grab bars", true))
      if (d.turningRadiusCm !== undefined) features.push(f("Toilet turning radius", `${d.turningRadiusCm} cm`))
      if (d.doorWidthCm !== undefined)     features.push(f("Toilet door width", `${d.doorWidthCm} cm`))
    }
  }

  const parking = place.accessibility.parking
  if (parking.value !== "unknown") {
    const d = parking.details as ParkingDetails | undefined
    if (d?.nearbyOnly) {
      features.push(f("Nearby disabled parking", true))
      if (d.nearbyParkingDistanceM !== undefined)
        features.push(f("Distance to nearest disabled parking", `${d.nearbyParkingDistanceM} m`))
    } else {
      features.push(f("Accessible parking on site", parking.value !== "no"))
      if (d?.spaceCount !== undefined) features.push(f("Disabled parking spaces", d.spaceCount))
    }
  }

  return features
}

// ─── Page stats + mini-FAQ ───────────────────────────────────────────────────

interface PageStats {
  total:        number
  nHighConf:    number  // overallConfidence >= 0.70
  nParking:     number  // parking yes/limited
  nToiletYes:   number  // toilet.value === "yes" (fully accessible, not just limited)
}

function computePageStats(places: Place[]): PageStats {
  return {
    total:      places.length,
    nHighConf:  places.filter(p => p.overallConfidence >= 0.70).length,
    nParking:   places.filter(p => p.accessibility.parking.value === "yes" || p.accessibility.parking.value === "limited").length,
    nToiletYes: places.filter(p => p.accessibility.toilet?.value === "yes").length,
  }
}

interface FaqItem { question: string; answer: string }

function buildFaqItems(
  stats:    PageStats,
  places:   Place[],
  locale:   Locale,
  cityName: string,
  catLabel: string,
): FaqItem[] {
  const de = locale === "de"
  const items: FaqItem[] = []

  // Q1 — count (always)
  items.push({
    question: de
      ? `Wie viele ${catLabel} in ${cityName} sind rollstuhlgerecht?`
      : `How many ${catLabel} in ${cityName} are wheelchair-accessible?`,
    answer: de
      ? `Accessible Places listet aktuell ${stats.total} ${catLabel} in ${cityName} – alle mit rollstuhlgerechtem Eingang und barrierefreiem WC. ${stats.nHighConf} Einträge haben eine Verlässlichkeit von mindestens 70 %.`
      : `Accessible Places currently lists ${stats.total} ${catLabel} in ${cityName} – all with a wheelchair-accessible entrance and toilet. ${stats.nHighConf} entries have a reliability score of at least 70%.`,
  })

  // Q2 — fully accessible toilet (only when data exists)
  if (stats.nToiletYes > 0) {
    const top3Names = places
      .filter(p => p.accessibility.toilet?.value === "yes")
      .sort((a, b) => b.overallConfidence - a.overallConfidence)
      .slice(0, 3)
      .map(p => p.name)
    const nameStr = top3Names.length > 0
      ? (de ? `, darunter ${top3Names.join(", ")}` : `, including ${top3Names.join(", ")}`)
      : ""
    items.push({
      question: de
        ? `Welche ${catLabel} in ${cityName} haben ein voll zugängliches Rollstuhl-WC?`
        : `Which ${catLabel} in ${cityName} have a fully accessible wheelchair toilet?`,
      answer: de
        ? `${stats.nToiletYes} von ${stats.total} ${catLabel} haben ein voll zugängliches barrierefreies WC${nameStr}.`
        : `${stats.nToiletYes} of ${stats.total} ${catLabel} have a fully accessible wheelchair toilet${nameStr}.`,
    })
  }

  // Q3 — parking (only when data exists)
  if (stats.nParking > 0) {
    items.push({
      question: de
        ? `Gibt es ${catLabel} mit Behindertenparkplatz in ${cityName}?`
        : `Are there ${catLabel} with accessible parking in ${cityName}?`,
      answer: de
        ? `Ja, ${stats.nParking} von ${stats.total} ${catLabel} haben einen Behindertenparkplatz oder rollstuhlgerechten Parkplatz in unmittelbarer Nähe (≤ 300 m).`
        : `Yes, ${stats.nParking} of ${stats.total} ${catLabel} have a disabled parking space or an accessible parking spot nearby (≤ 300 m).`,
    })
  }

  // Q4 — data currency (always)
  items.push({
    question: de
      ? "Wie aktuell sind die Barrierefreiheitsdaten?"
      : "How up-to-date is the accessibility data?",
    answer: de
      ? "Die Daten stammen aus OpenStreetMap (kontinuierlich durch die Community aktualisiert), accessibility.cloud/Wheelmap und Ginto. Einträge mit einem OSM-Verifikationsdatum der letzten 2 Jahre werden als manuell verifiziert markiert."
      : "The data comes from OpenStreetMap (continuously updated by the community), accessibility.cloud/Wheelmap, and Ginto. Entries with an OSM verification date within the last 2 years are marked as manually verified.",
  })

  return items
}

// ─── Confidence badge ────────────────────────────────────────────────────────

const CONFIDENCE_COLORS: Record<"high" | "medium" | "low", string> = {
  high:   "bg-green-100 text-green-800 border border-green-200",
  medium: "bg-yellow-100 text-yellow-800 border border-yellow-200",
  low:    "bg-red-100 text-red-800 border border-red-200",
}

const CONFIDENCE_LABEL: Record<"high" | "medium" | "low", { de: string; en: string }> = {
  high:   { de: "Verlässlich", en: "Reliable" },
  medium: { de: "Mittel",      en: "Moderate" },
  low:    { de: "Unsicher",    en: "Uncertain" },
}

// ─── Single place card ───────────────────────────────────────────────────────

function SeoPlaceCard({ place, locale, searchBaseUrl }: { place: Place; locale: Locale; searchBaseUrl: string }) {
  const addr = [
    [place.address.street, place.address.houseNumber].filter(Boolean).join(" "),
    place.address.city,
  ].filter(Boolean).join(", ")

  const placeUrl = `${searchBaseUrl}&selectLat=${place.coordinates.lat}&selectLon=${place.coordinates.lon}&selectName=${encodeURIComponent(place.name)}`
  const gmapsQuery = encodeURIComponent([place.name, place.address.city].filter(Boolean).join(" "))
  const gPlacesId  = place.sourceRecords.find((r) => r.sourceId === "google_places")?.externalId
  const gmapsUrl   = gPlacesId
    ? `https://www.google.com/maps/search/?api=1&query=${gmapsQuery}&query_place_id=${gPlacesId}`
    : `https://www.google.com/maps/search/?api=1&query=${gmapsQuery}`

  const wheelmapUrl = (() => {
    if (place.wheelmapUrl) return place.wheelmapUrl
    const osm = place.sourceRecords.find((r) => r.sourceId === "osm")
    if (osm) {
      const [type, id] = osm.externalId.split("/")
      if (type === "node" && id) return `https://wheelmap.org/nodes/${id}`
    }
    return `https://wheelmap.org/?lat=${place.coordinates.lat}&lon=${place.coordinates.lon}&zoom=19`
  })()

  const openInAppLabel = locale === "de" ? "Mehr Details in Accessible-Places" : "More details in Accessible-Places"

  const entrance    = place.accessibility.entrance
  const toilet      = place.accessibility.toilet
  const parking     = place.accessibility.parking.value !== "unknown" ? place.accessibility.parking : null
  const entrItems   = entrance?.details ? entranceDetailItems(entrance.details as EntranceDetails, locale) : []
  const toiletItems = toilet?.details   ? toiletDetailItems(toilet.details     as ToiletDetails,  locale) : []
  const parkItems   = parking?.details  ? parkingDetailItems(parking.details   as ParkingDetails, locale) : []

  const criteriaLabel = locale === "de"
    ? { entrance: "Eingang", toilet: "Toilette", parking: "Rollst.-Parkplatz" }
    : { entrance: "Entrance", toilet: "Toilet",  parking: "Parking"           }

  return (
    <article className="rounded-lg border border-gray-200 bg-white shadow-sm flex flex-col overflow-hidden">
      {/* Clickable body — opens the main app with this place pre-selected */}
      <Link
        href={placeUrl}
        className="block p-4 hover:bg-blue-50 transition-colors flex flex-col gap-2 flex-1"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-gray-900 text-sm leading-snug">{place.name}</h3>
          {(() => {
            const level = confidenceLabel(place.overallConfidence)
            return (
              <span className={`shrink-0 text-xs font-semibold px-2.5 py-0.5 rounded-full ${CONFIDENCE_COLORS[level]}`}>
                {locale === "de" ? "Daten: " : "Data: "}{Math.round(place.overallConfidence * 100)}% · {CONFIDENCE_LABEL[level][locale]}
              </span>
            )
          })()}
        </div>

        {addr && <p className="text-xs text-gray-500">{addr}</p>}

        <div className="flex flex-col gap-1.5">
          {([
            { key: "entrance" as const, attr: entrance, items: entrItems,   valueLabel: entrance ? a11yLabel(entrance.value, locale) : "" },
            { key: "toilet"   as const, attr: toilet,   items: toiletItems, valueLabel: toilet   ? a11yLabel(toilet.value,   locale) : "" },
            { key: "parking"  as const, attr: parking,  items: parkItems,   valueLabel: parking  ? parkingValueLabel(parking, locale) : "" },
          ]).map(({ key, attr, items, valueLabel }) => {
            if (!attr) return null
            return (
              <div key={key}>
                <div className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${VALUE_CLASSES[attr.value]}`}>
                  <span className="font-medium">{criteriaLabel[key]}:</span>
                  <span>{valueLabel}</span>
                </div>
                {items.length > 0 && (
                  <ul className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0">
                    {items.map((item, i) => (
                      <li key={i} className="text-xs text-gray-500">· {item}</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>

      </Link>

      {/* Card footer: external links left, CTA right */}
      <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-100 flex-wrap">
        <a
          href={wheelmapUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={locale === "de" ? "Auf Wheelmap.org prüfen" : "Check on Wheelmap.org"}
          title={locale === "de" ? "Auf Wheelmap.org prüfen" : "Check on Wheelmap.org"}
          className="p-1 -m-1 text-gray-400 hover:text-gray-700 transition-colors"
        >
          <Accessibility className="w-[1.1rem] h-[1.1rem]" />
        </a>
        <a
          href={gmapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={locale === "de" ? "In Google Maps öffnen" : "Open in Google Maps"}
          title={locale === "de" ? "In Google Maps öffnen" : "Open in Google Maps"}
          className="p-1 -m-1 text-gray-400 hover:text-gray-700 transition-colors"
        >
          <Map className="w-[1.1rem] h-[1.1rem]" />
        </a>
        {place.website && /^https?:\/\//i.test(place.website) && (
          <a
            href={place.website}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={locale === "de" ? "Website besuchen" : "Visit website"}
            title={locale === "de" ? "Website besuchen" : "Visit website"}
            className="p-1 -m-1 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <Globe className="w-[1.1rem] h-[1.1rem]" />
          </a>
        )}
        <Link
          href={placeUrl}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <Accessibility className="h-3.5 w-3.5 shrink-0" />
          {openInAppLabel}
        </Link>
      </div>
    </article>
  )
}

// ─── Full page content ───────────────────────────────────────────────────────

export default function SeoPageContent({ locale, city, categorySlug, places }: Props) {
  const label      = SEO_CATEGORY_LABEL[categorySlug]
  const cityName   = locale === "de" ? city.nameDe : city.nameEn
  const catLabel   = label[locale]
  const prefix     = locale === "en" ? "/en" : ""
  const homeUrl    = locale === "en" ? "/en" : "/"
  const otherCities = CITIES.filter((c) => c.slug !== city.slug && hasData(c.slug, categorySlug))

  const searchUrl = `${homeUrl}?q=${encodeURIComponent(cityName)}&cat=${encodeURIComponent(categorySlug)}`

  const heading = locale === "de"
    ? `Rollstuhlgerechte ${catLabel} in ${cityName}`
    : `Wheelchair-accessible ${catLabel} in ${cityName}`

  const intro = locale === "de"
    ? `Hier findest du rollstuhlgerechte ${catLabel} in ${cityName} – mit verifizierten Barrierefreiheits-Daten von OpenStreetMap, accessibility.cloud und weiteren Quellen. Alle Einträge zeigen Eingang- und Toiletten-Informationen.`
    : `Find wheelchair-accessible ${catLabel} in ${cityName} – with verified accessibility data from OpenStreetMap, accessibility.cloud and more. Every entry shows entrance and toilet information.`

  const relatedCategoriesLabel = locale === "de" ? `Weitere Kategorien in ${cityName}` : `More categories in ${cityName}`
  const relatedCitiesLabel     = locale === "de" ? `${catLabel} in anderen Städten`     : `${catLabel} in other cities`
  const ctaLabel               = locale === "de" ? `Weitere ${catLabel} in ${cityName} anzeigen` : `View more ${catLabel} in ${cityName}`
  const placesHeading          = locale === "de"
    ? `${places.length} rollstuhlgerechte ${catLabel} in ${cityName}`
    : `${places.length} wheelchair-accessible ${catLabel} in ${cityName}`
  const noResultsLabel         = locale === "de" ? "Aktuell sind keine Einträge verfügbar." : "No entries available at this time."
  const sourceLabel            = locale === "de" ? "Datenquelle:" : "Source:"
  const backLabel              = locale === "de" ? "← Zur Suche" : "← Back to search"

  const relatedCategories = Object.entries(SEO_CATEGORY_LABEL)
    .filter(([slug]) => slug !== categorySlug && slug in SEO_CATEGORY_TO_CHIP_IDX && hasData(city.slug, slug))

  const breadcrumbItems = [
    { label: "Accessible Places", href: homeUrl },
    { label: cityName,            href: `${homeUrl}?q=${encodeURIComponent(cityName)}` },
    { label: catLabel,            href: null },
  ]

  const canonicalUrl = `${BASE}${prefix}/${city.slug}/${categorySlug}`

  const showSummary = places.length > 3
  const stats       = showSummary ? computePageStats(places) : null
  const faqItems    = stats ? buildFaqItems(stats, places, locale, cityName, catLabel) : []

  const structuredData = [
    {
      "@context":        "https://schema.org",
      "@type":           "ItemList",
      "name":            heading,
      "url":             canonicalUrl,
      "numberOfItems":   places.length,
      "itemListElement": places.map((p, i) => {
        const amenityFeature = buildAmenityFeatures(p)
        return {
          "@type":    "ListItem",
          "position": i + 1,
          "name":     p.name,
          "item": {
            "@type": CATEGORY_SCHEMA_TYPE[categorySlug] ?? "LocalBusiness",
            "name":  p.name,
            "url":   `${BASE}${searchUrl}&selectLat=${p.coordinates.lat}&selectLon=${p.coordinates.lon}&selectName=${encodeURIComponent(p.name)}`,
            "address": {
              "@type":           "PostalAddress",
              "streetAddress":   [p.address.street, p.address.houseNumber].filter(Boolean).join(" "),
              "addressLocality": p.address.city,
              "postalCode":      p.address.postalCode,
              "addressCountry":  p.address.country,
            },
            "geo": {
              "@type":     "GeoCoordinates",
              "latitude":  p.coordinates.lat,
              "longitude": p.coordinates.lon,
            },
            ...(amenityFeature.length > 0 && { "amenityFeature": amenityFeature }),
          },
        }
      }),
    },
    {
      "@context": "https://schema.org",
      "@type":    "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Accessible Places", "item": `${BASE}${homeUrl}` },
        { "@type": "ListItem", "position": 2, "name": cityName,            "item": `${BASE}${homeUrl}?q=${encodeURIComponent(cityName)}` },
        { "@type": "ListItem", "position": 3, "name": catLabel,            "item": canonicalUrl },
      ],
    },
    ...(faqItems.length > 0 ? [{
      "@context": "https://schema.org",
      "@type":    "FAQPage",
      "mainEntity": faqItems.map(item => ({
        "@type": "Question",
        "name":  item.question,
        "acceptedAnswer": { "@type": "Answer", "text": item.answer },
      })),
    }] : []),
  ]

  return (
    <>
      <NavigationProgress />
      {structuredData.map((block, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(block).replace(/</g, "\\u003c") }}
        />
      ))}

      <div className="min-h-screen flex flex-col bg-gray-50">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <Link href={homeUrl} className="text-blue-600 text-sm font-medium hover:underline">
            ♿ Accessible Places
          </Link>
          <Link
            href={locale === "de" ? `/en/${city.slug}/${categorySlug}` : `/${city.slug}/${categorySlug}`}
            className="text-xs text-gray-500 hover:underline"
          >
            {locale === "de" ? "English" : "Deutsch"}
          </Link>
        </header>

        <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8">
          {/* Breadcrumb */}
          <nav aria-label={locale === "de" ? "Breadcrumb" : "Breadcrumb"} className="mb-6">
            <ol className="flex flex-wrap items-center gap-1 text-sm text-gray-500">
              {breadcrumbItems.map((item, i) => (
                <li key={i} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden>›</span>}
                  {item.href ? (
                    <Link href={item.href} className="hover:underline text-blue-600">{item.label}</Link>
                  ) : (
                    <span className="text-gray-800 font-medium">{item.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>

          {/* Heading + intro */}
          <h1 className="text-2xl font-bold text-gray-900 mb-3">{heading}</h1>
          <p className="text-gray-600 mb-6 max-w-2xl">{intro}</p>

          {/* Stats summary + mini-FAQ */}
          {showSummary && stats && (
            <>
              <div className="mb-8 rounded-lg border border-gray-200 bg-white p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">
                  {locale === "de"
                    ? `Kurzübersicht · ${catLabel} in ${cityName}`
                    : `Summary · ${catLabel} in ${cityName}`}
                </h2>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {([
                    { value: stats.total,             label: locale === "de" ? "Einträge"            : "Entries"            },
                    { value: stats.nHighConf,          label: locale === "de" ? "Verlässlichkeit ≥ 70 %" : "Reliability ≥ 70%" },
                    { value: stats.nParking,           label: locale === "de" ? "Mit Parkplatz in der Nähe" : "With nearby parking" },
                    { value: stats.nToiletYes,         label: locale === "de" ? "WC voll zugänglich"  : "Toilet fully accessible" },
                  ] as { value: number; label: string }[]).map(({ value, label }) => (
                    <div key={label} className="flex flex-col">
                      <dt className="text-xs text-gray-500">{label}</dt>
                      <dd className="text-2xl font-bold text-blue-600 mt-0.5">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <section aria-labelledby="faq-heading" className="mb-8">
                <h2 id="faq-heading" className="text-base font-semibold text-gray-700 mb-3">
                  {locale === "de"
                    ? `Häufige Fragen zu barrierefreien ${catLabel} in ${cityName}`
                    : `Frequently asked questions about wheelchair-accessible ${catLabel} in ${cityName}`}
                </h2>
                <dl className="flex flex-col divide-y divide-gray-100">
                  {faqItems.map((item, i) => (
                    <div key={i} className="py-3 first:pt-0">
                      <dt className="text-sm font-semibold text-gray-800">{item.question}</dt>
                      <dd className="mt-1 text-sm text-gray-600 leading-relaxed">{item.answer}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </>
          )}

          {/* Place grid */}
          {places.length === 0 ? (
            <p className="text-gray-500 py-8">{noResultsLabel}</p>
          ) : (
            <section aria-labelledby="places-heading">
              <h2 id="places-heading" className="text-base font-semibold text-gray-700 mb-4">
                {placesHeading}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {places.map((place) => (
                  <SeoPlaceCard key={place.id} place={place} locale={locale} searchBaseUrl={searchUrl} />
                ))}
              </div>
            </section>
          )}

          {/* Source note */}
          <p className="text-xs text-gray-400 mt-6">
            {sourceLabel} OpenStreetMap, accessibility.cloud, Ginto (CH)
          </p>

          {/* CTA */}
          <Link
            href={searchUrl}
            className="inline-flex items-center gap-2 bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors mt-6 mb-2"
          >
            {ctaLabel}
          </Link>

          {/* Related categories */}
          {relatedCategories.length > 0 && (
            <section className="mt-12">
              <h2 className="text-base font-semibold text-gray-700 mb-3">{relatedCategoriesLabel}</h2>
              <div className="flex flex-wrap gap-2">
                {relatedCategories.map(([slug, labels]) => (
                  <Link
                    key={slug}
                    href={`${prefix}/${city.slug}/${slug}`}
                    className="text-sm px-3 py-1.5 rounded-full border border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:text-blue-700 transition-colors"
                  >
                    {labels[locale]}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Related cities */}
          {otherCities.length > 0 && (
            <section className="mt-8 mb-12">
              <h2 className="text-base font-semibold text-gray-700 mb-3">{relatedCitiesLabel}</h2>
              <div className="flex flex-wrap gap-2">
                {otherCities.map((c) => (
                  <Link
                    key={c.slug}
                    href={`${prefix}/${c.slug}/${categorySlug}`}
                    className="text-sm px-3 py-1.5 rounded-full border border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:text-blue-700 transition-colors"
                  >
                    {locale === "de" ? c.nameDe : c.nameEn}
                  </Link>
                ))}
              </div>
            </section>
          )}

          <Link href={homeUrl} className="text-sm text-blue-600 hover:underline">{backLabel}</Link>
        </main>
      </div>
    </>
  )
}
