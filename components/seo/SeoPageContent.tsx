import Link from "next/link"
import type { Place, A11yValue, EntranceDetails, ToiletDetails } from "@/lib/types"
import { CITIES, SEO_CATEGORY_LABEL, SEO_CATEGORY_TO_CHIP_IDX, SEO_CATEGORY_TO_SLUG, type City } from "@/lib/cities"
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
  const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${place.coordinates.lat},${place.coordinates.lon}`

  const openInAppLabel = locale === "de" ? "In App öffnen →" : "Open in app →"

  const entrance    = place.accessibility.entrance
  const toilet      = place.accessibility.toilet
  const entrItems   = entrance?.details ? entranceDetailItems(entrance.details as EntranceDetails, locale) : []
  const toiletItems = toilet?.details   ? toiletDetailItems(toilet.details     as ToiletDetails,  locale) : []

  const criteriaLabel = locale === "de"
    ? { entrance: "Eingang", toilet: "Toilette" }
    : { entrance: "Entrance", toilet: "Toilet"  }

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
                {Math.round(place.overallConfidence * 100)}% · {CONFIDENCE_LABEL[level][locale]}
              </span>
            )
          })()}
        </div>

        {addr && <p className="text-xs text-gray-500">{addr}</p>}

        <div className="flex flex-col gap-1.5">
          {([
            { key: "entrance" as const, attr: entrance, items: entrItems   },
            { key: "toilet"   as const, attr: toilet,   items: toiletItems },
          ]).map(({ key, attr, items }) => {
            if (!attr) return null
            return (
              <div key={key}>
                <div className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${VALUE_CLASSES[attr.value]}`}>
                  <span className="font-medium">{criteriaLabel[key]}:</span>
                  <span>{a11yLabel(attr.value, locale)}</span>
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

        <span className="text-xs text-blue-600 mt-1">{openInAppLabel}</span>
      </Link>

      {/* External links — separate element, no nested <a> */}
      <div className="flex gap-3 px-4 py-2 border-t border-gray-100 flex-wrap">
        {place.wheelmapUrl && (
          <a href={place.wheelmapUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:underline">
            Wheelmap
          </a>
        )}
        <a href={gmapsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:underline">
          Google Maps
        </a>
        {place.website && /^https?:\/\//i.test(place.website) && (
          <a href={place.website} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:underline">
            Website
          </a>
        )}
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
    ? `Hier findest du rollstuhlgerechte ${catLabel} in ${cityName} – mit verifizierten Barrierefreiheits-Daten von OpenStreetMap, accessibility.cloud und weiteren Quellen. Alle Einträge zeigen Eingang, Toilette und Parkplatz-Informationen.`
    : `Find wheelchair-accessible ${catLabel} in ${cityName} – with verified accessibility data from OpenStreetMap, accessibility.cloud and more. Every entry shows entrance, toilet and parking information.`

  const relatedCategoriesLabel = locale === "de" ? `Weitere Kategorien in ${cityName}` : `More categories in ${cityName}`
  const relatedCitiesLabel     = locale === "de" ? `${catLabel} in anderen Städten`     : `${catLabel} in other cities`
  const ctaLabel               = locale === "de" ? `Suche öffnen für ${cityName}` : `Open search for ${cityName}`
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

  const structuredData = [
    {
      "@context":        "https://schema.org",
      "@type":           "ItemList",
      "name":            heading,
      "url":             canonicalUrl,
      "numberOfItems":   places.length,
      "itemListElement": places.map((p, i) => ({
        "@type":    "ListItem",
        "position": i + 1,
        "name":     p.name,
        "item": {
          "@type":       "LocalBusiness",
          "name":        p.name,
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
        },
      })),
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

          {/* CTA */}
          <Link
            href={searchUrl}
            className="inline-flex items-center gap-2 bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors mb-8"
          >
            {ctaLabel}
          </Link>

          {/* Place grid */}
          {places.length === 0 ? (
            <p className="text-gray-500 py-8">{noResultsLabel}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {places.map((place) => (
                <SeoPlaceCard key={place.id} place={place} locale={locale} searchBaseUrl={searchUrl} />
              ))}
            </div>
          )}

          {/* Source note */}
          <p className="text-xs text-gray-400 mt-6">
            {sourceLabel} OpenStreetMap, accessibility.cloud, Ginto (CH)
          </p>

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
