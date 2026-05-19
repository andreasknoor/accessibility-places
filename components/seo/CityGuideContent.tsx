import Link from "next/link"
import type { Place, A11yValue } from "@/lib/types"
import { CITIES, SEO_CATEGORY_LABEL, type City } from "@/lib/cities"
import { confidenceLabel } from "@/lib/matching/merge"
import { hasData } from "@/lib/seo-validity"
import NavigationProgress from "@/components/seo/NavigationProgress"
import type { CityGuideSection } from "@/lib/seo-search"

const BASE = "https://accessible-places.org"

type Locale = "de" | "en"

interface Props {
  locale:   Locale
  city:     City
  sections: CityGuideSection[]
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

const VALUE_CLASSES: Record<A11yValue, string> = {
  yes:     "bg-green-100 text-green-800",
  limited: "bg-amber-100 text-amber-800",
  no:      "bg-red-100 text-red-800",
  unknown: "bg-gray-100 text-gray-500",
}

const VALUE_LABEL: Record<A11yValue, { de: string; en: string }> = {
  yes:     { de: "Ja",           en: "Yes" },
  limited: { de: "Eingeschränkt", en: "Limited" },
  no:      { de: "Nein",         en: "No" },
  unknown: { de: "Unbekannt",    en: "Unknown" },
}

const CONFIDENCE_COLORS = {
  high:   "bg-green-100 text-green-800",
  medium: "bg-amber-100 text-amber-800",
  low:    "bg-red-100 text-red-800",
}

const CONFIDENCE_LABEL: Record<string, { de: string; en: string }> = {
  high:   { de: "Verlässlich", en: "Reliable" },
  medium: { de: "Mittel",      en: "Medium"   },
  low:    { de: "Unsicher",    en: "Uncertain" },
}

// ─── Compact place card ───────────────────────────────────────────────────────

function GuideCard({
  place,
  locale,
  searchBaseUrl,
}: {
  place:         Place
  locale:        Locale
  searchBaseUrl: string
}) {
  const placeUrl = `${searchBaseUrl}&selectLat=${place.coordinates.lat}&selectLon=${place.coordinates.lon}&selectName=${encodeURIComponent(place.name)}`
  const entrance = place.accessibility.entrance
  const toilet   = place.accessibility.toilet
  const level    = confidenceLabel(place.overallConfidence)

  const criteriaLabel = locale === "de"
    ? { entrance: "Eingang", toilet: "Toilette" }
    : { entrance: "Entrance", toilet: "Toilet" }

  return (
    <Link
      href={placeUrl}
      className="block rounded-lg border border-gray-200 bg-white shadow-sm p-3 hover:bg-blue-50 transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="font-semibold text-gray-900 text-sm leading-snug">{place.name}</span>
        <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${CONFIDENCE_COLORS[level]}`}>
          {Math.round(place.overallConfidence * 100)}%
        </span>
      </div>
      {place.address.city && (
        <p className="text-xs text-gray-400 mb-1.5">{[place.address.street, place.address.houseNumber].filter(Boolean).join(" ")}</p>
      )}
      <div className="flex flex-wrap gap-1">
        {entrance && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${VALUE_CLASSES[entrance.value]}`}>
            {criteriaLabel.entrance}: {VALUE_LABEL[entrance.value][locale]}
          </span>
        )}
        {toilet && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${VALUE_CLASSES[toilet.value]}`}>
            {criteriaLabel.toilet}: {VALUE_LABEL[toilet.value][locale]}
          </span>
        )}
      </div>
    </Link>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CityGuideContent({ locale, city, sections }: Props) {
  const cityName = locale === "de" ? city.nameDe : city.nameEn
  const prefix   = locale === "en" ? "/en" : ""
  const homeUrl  = locale === "en" ? "/en" : "/"

  const heading = locale === "de"
    ? `Barrierefrei in ${cityName}`
    : `Accessible ${cityName}`

  const intro = locale === "de"
    ? `Die besten rollstuhlgerechten Orte in ${cityName} – Restaurants, Hotels, Museen und mehr, mit verifizierten Barrierefreiheits-Daten aus OpenStreetMap, accessibility.cloud und weiteren Quellen.`
    : `The best wheelchair-accessible places in ${cityName} – restaurants, hotels, museums and more, with verified accessibility data from OpenStreetMap, accessibility.cloud and more.`

  const canonicalUrl = `${BASE}${prefix}/${city.slug}/${locale === "de" ? "barrierefrei" : "accessible"}`

  const otherCities = CITIES.filter((c) =>
    c.slug !== city.slug &&
    Object.keys(SEO_CATEGORY_LABEL).some((cat) => hasData(c.slug, cat)),
  ).slice(0, 20)

  // JSON-LD: one ItemList entry per non-empty section
  const structuredData = [
    {
      "@context":        "https://schema.org",
      "@type":           "ItemList",
      "name":            heading,
      "url":             canonicalUrl,
      "description":     intro,
      "numberOfItems":   sections.length,
      "itemListElement": sections.map(({ categorySlug }, i) => ({
        "@type":    "ListItem",
        "position": i + 1,
        "name":     SEO_CATEGORY_LABEL[categorySlug]?.[locale] ?? categorySlug,
        "url":      `${BASE}${prefix}/${city.slug}/${categorySlug}`,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type":    "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Accessible Places", "item": `${BASE}${homeUrl}` },
        { "@type": "ListItem", "position": 2, "name": cityName,            "item": canonicalUrl },
      ],
    },
  ]

  const searchUrl = `${homeUrl}?q=${encodeURIComponent(cityName)}`

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
            href={locale === "de" ? `/en/${city.slug}/accessible` : `/${city.slug}/barrierefrei`}
            className="text-xs text-gray-500 hover:underline"
          >
            {locale === "de" ? "English" : "Deutsch"}
          </Link>
        </header>

        <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="mb-6">
            <ol className="flex flex-wrap items-center gap-1 text-sm text-gray-500">
              <li className="flex items-center gap-1">
                <Link href={homeUrl} className="hover:underline text-blue-600">Accessible Places</Link>
              </li>
              <li className="flex items-center gap-1">
                <span aria-hidden>›</span>
                <span className="text-gray-800 font-medium">{cityName}</span>
              </li>
            </ol>
          </nav>

          <h1 className="text-2xl font-bold text-gray-900 mb-3">{heading}</h1>
          <p className="text-gray-600 mb-6 max-w-2xl">{intro}</p>

          <Link
            href={searchUrl}
            className="inline-flex items-center gap-2 bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors mb-10"
          >
            {locale === "de" ? `Alle Orte in ${cityName} suchen` : `Search all places in ${cityName}`}
          </Link>

          {/* Category sections */}
          {sections.length === 0 ? (
            <p className="text-gray-500 py-8">
              {locale === "de" ? "Aktuell sind keine Einträge verfügbar." : "No entries available at this time."}
            </p>
          ) : (
            <div className="space-y-10">
              {sections.map(({ categorySlug, places }) => {
                const catLabel  = SEO_CATEGORY_LABEL[categorySlug]?.[locale] ?? categorySlug
                const catPageUrl = `${prefix}/${city.slug}/${categorySlug}`
                const catSearchUrl = `${homeUrl}?q=${encodeURIComponent(cityName)}&cat=${encodeURIComponent(categorySlug)}`

                return (
                  <section key={categorySlug}>
                    <div className="flex items-baseline justify-between mb-3">
                      <h2 className="text-lg font-semibold text-gray-900">{catLabel}</h2>
                      <Link href={catPageUrl} className="text-sm text-blue-600 hover:underline shrink-0 ml-4">
                        {locale === "de" ? `Alle →` : `All →`}
                      </Link>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {places.map((place) => (
                        <GuideCard key={place.id} place={place} locale={locale} searchBaseUrl={catSearchUrl} />
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          )}

          <p className="text-xs text-gray-400 mt-10">
            {locale === "de" ? "Datenquellen:" : "Sources:"} OpenStreetMap, accessibility.cloud, Ginto (CH)
          </p>

          {/* Related cities */}
          {otherCities.length > 0 && (
            <section className="mt-10 mb-12">
              <h2 className="text-base font-semibold text-gray-700 mb-3">
                {locale === "de" ? "Weitere Städte" : "Other cities"}
              </h2>
              <div className="flex flex-wrap gap-2">
                {otherCities.map((c) => (
                  <Link
                    key={c.slug}
                    href={`${prefix}/${c.slug}/${locale === "de" ? "barrierefrei" : "accessible"}`}
                    className="text-sm px-3 py-1.5 rounded-full border border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:text-blue-700 transition-colors"
                  >
                    {locale === "de" ? c.nameDe : c.nameEn}
                  </Link>
                ))}
              </div>
            </section>
          )}

          <Link href={homeUrl} className="text-sm text-blue-600 hover:underline">
            {locale === "de" ? "← Zur Suche" : "← Back to search"}
          </Link>
        </main>
      </div>
    </>
  )
}
