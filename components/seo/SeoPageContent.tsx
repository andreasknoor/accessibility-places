import Link from "next/link"
import type { Place, A11yValue } from "@/lib/types"
import { CITIES, SEO_CATEGORY_LABEL, SEO_CATEGORY_TO_SLUG, type City } from "@/lib/cities"
import { CONFIDENCE_THRESHOLDS } from "@/lib/config"

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

// ─── Confidence badge ────────────────────────────────────────────────────────

function confidenceClass(score: number) {
  if (score >= CONFIDENCE_THRESHOLDS.high)   return "bg-green-100 text-green-800"
  if (score >= CONFIDENCE_THRESHOLDS.medium) return "bg-amber-100 text-amber-800"
  return "bg-gray-100 text-gray-600"
}

// ─── Single place card ───────────────────────────────────────────────────────

function SeoPlaceCard({ place, locale, searchBaseUrl }: { place: Place; locale: Locale; searchBaseUrl: string }) {
  const addr = [
    [place.address.street, place.address.houseNumber].filter(Boolean).join(" "),
    place.address.city,
  ].filter(Boolean).join(", ")

  const placeUrl = `${searchBaseUrl}&selectLat=${place.coordinates.lat}&selectLon=${place.coordinates.lon}&selectName=${encodeURIComponent(place.name)}`
  const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${place.coordinates.lat},${place.coordinates.lon}`

  const criteriaLabel = locale === "de"
    ? { entrance: "Eingang", toilet: "Toilette", parking: "Parkplatz" }
    : { entrance: "Entrance", toilet: "Toilet",  parking: "Parking" }
  const openInAppLabel = locale === "de" ? "In App öffnen →" : "Open in app →"

  return (
    <article className="rounded-lg border border-gray-200 bg-white shadow-sm flex flex-col overflow-hidden">
      {/* Clickable body — opens the main app with this place pre-selected */}
      <Link
        href={placeUrl}
        className="block p-4 hover:bg-blue-50 transition-colors flex flex-col gap-2 flex-1"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-gray-900 text-sm leading-snug">{place.name}</h3>
          <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${confidenceClass(place.overallConfidence)}`}>
            {Math.round(place.overallConfidence * 100)}&thinsp;%
          </span>
        </div>

        {addr && <p className="text-xs text-gray-500">{addr}</p>}

        <dl className="flex flex-wrap gap-1.5">
          {(["entrance", "toilet", "parking"] as const).map((key) => {
            const attr = place.accessibility[key]
            if (!attr) return null
            return (
              <div key={key} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${VALUE_CLASSES[attr.value]}`}>
                <dt className="font-medium">{criteriaLabel[key]}:</dt>
                <dd>{a11yLabel(attr.value, locale)}</dd>
              </div>
            )
          })}
        </dl>

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
        {place.website && (
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
  const otherCities = CITIES.filter((c) => c.slug !== city.slug)

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

  const breadcrumbItems = [
    { label: "Accessible Places", href: homeUrl },
    { label: cityName,            href: `${prefix}/${city.slug}/restaurant` },
    { label: catLabel,            href: null },
  ]

  const structuredData = {
    "@context":        "https://schema.org",
    "@type":           "ItemList",
    "name":            heading,
    "url":             `${BASE}${prefix}/${city.slug}/${categorySlug}`,
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
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

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
            {sourceLabel} OpenStreetMap, accessibility.cloud, Reisen für Alle
          </p>

          {/* Related categories */}
          <section className="mt-12">
            <h2 className="text-base font-semibold text-gray-700 mb-3">{relatedCategoriesLabel}</h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(SEO_CATEGORY_LABEL)
                .filter(([slug]) => slug !== categorySlug)
                .map(([slug, labels]) => (
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

          {/* Related cities */}
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

          <Link href={homeUrl} className="text-sm text-blue-600 hover:underline">{backLabel}</Link>
        </main>
      </div>
    </>
  )
}
