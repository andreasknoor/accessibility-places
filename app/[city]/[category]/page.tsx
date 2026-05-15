import { notFound }      from "next/navigation"
import type { Metadata } from "next"
import { CITIES, CITY_MAP, SEO_CATEGORY_SLUGS, SEO_CATEGORY_LABEL } from "@/lib/cities"
import { fetchPlacesForSeoPage } from "@/lib/seo-search"
import SeoPageContent    from "@/components/seo/SeoPageContent"

// ISR: rendered on first request, then cached for 5 days (stale-while-revalidate).
// No generateStaticParams — avoids a 320-page build-time fetch burst that
// causes Overpass to return empty results silently.
export const revalidate = 5 * 24 * 3600 // 432 000 s

type Params = { city: string; category: string }

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
  const canonical = `${BASE}/${city.slug}/${slug}`

  const title       = `Rollstuhlgerechte ${catLabel} in ${city.nameDe}`
  const description = `Rollstuhlgerechte ${catLabel} in ${city.nameDe} – mit Eingang-, Toiletten- und Parkplatz-Informationen aus OpenStreetMap, accessibility.cloud und mehr.`

  return {
    title,
    description,
    alternates: {
      canonical,
      languages: { de: canonical, en: `${BASE}/en/${city.slug}/${slug}`, "x-default": canonical },
    },
    robots: { index: true, follow: true },
    openGraph: { title, description, url: canonical, locale: "de_DE", siteName: "Accessible Places" },
    twitter:   { card: "summary", title, description },
  }
}

export default async function CityPage({ params }: { params: Promise<Params> }) {
  const resolved = resolve(await params)
  if (!resolved.city || !resolved.category) notFound()

  const { city, category } = resolved
  const slug   = Object.keys(SEO_CATEGORY_SLUGS).find((k) => SEO_CATEGORY_SLUGS[k] === category)!
  const places = await fetchPlacesForSeoPage(city.lat, city.lon, category).catch(() => [])

  return <SeoPageContent locale="de" city={city} categorySlug={slug} places={places} />
}
