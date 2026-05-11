import { cache }        from "react"
import { notFound }    from "next/navigation"
import type { Metadata } from "next"
import { CITY_MAP, SEO_CATEGORY_SLUGS, SEO_CATEGORY_LABEL } from "@/lib/cities"
import { fetchPlacesForSeoPage }  from "@/lib/seo-search"
import SeoPageContent             from "@/components/seo/SeoPageContent"

export const revalidate = 86400 // ISR: regenerate at most every 24 h

type Params = { city: string; category: string }

// cache() deduplicates the fetch within a single request so generateMetadata
// and the page component share the same result without a second network call.
const cachedFetch = cache(fetchPlacesForSeoPage)

function resolve(params: Params) {
  const city     = CITY_MAP.get(params.city as never)
  const category = SEO_CATEGORY_SLUGS[params.category]
  return { city, category }
}

const BASE = "https://accessible-places.org"

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { city, category } = resolve(await params)
  if (!city || !category) return {}
  const slug      = Object.keys(SEO_CATEGORY_SLUGS).find((k) => SEO_CATEGORY_SLUGS[k] === category)!
  const catLabel  = SEO_CATEGORY_LABEL[slug]?.de ?? slug
  const places    = await cachedFetch(city.lat, city.lon, category).catch(() => [])
  const count     = places.length
  const canonical = `${BASE}/${city.slug}/${slug}`

  const title = `Rollstuhlgerechte ${catLabel} in ${city.nameDe}`
  const description = count > 0
    ? `${count} rollstuhlgerechte ${catLabel} in ${city.nameDe} – mit Eingang-, Toiletten- und Parkplatz-Informationen aus OpenStreetMap, accessibility.cloud und mehr.`
    : `Rollstuhlgerechte ${catLabel} in ${city.nameDe} – mit Eingang-, Toiletten- und Parkplatz-Informationen aus OpenStreetMap, accessibility.cloud und mehr.`

  return {
    title,
    description,
    alternates: {
      canonical,
      languages: {
        de:          canonical,
        en:          `${BASE}/en/${city.slug}/${slug}`,
        "x-default": canonical,
      },
    },
    openGraph: {
      title,
      description,
      url:      canonical,
      locale:   "de_DE",
      siteName: "Accessible Places",
    },
    twitter: {
      card:        "summary",
      title,
      description,
    },
  }
}

export default async function CityPage({ params }: { params: Promise<Params> }) {
  const resolved = resolve(await params)
  if (!resolved.city || !resolved.category) notFound()

  const { city, category } = resolved
  const slug   = Object.keys(SEO_CATEGORY_SLUGS).find((k) => SEO_CATEGORY_SLUGS[k] === category)!
  const places = await cachedFetch(city.lat, city.lon, category).catch(() => [])

  return (
    <SeoPageContent
      locale="de"
      city={city}
      categorySlug={slug}
      places={places}
    />
  )
}
