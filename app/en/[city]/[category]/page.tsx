import { notFound }       from "next/navigation"
import type { Metadata }  from "next"
import { CITY_MAP, SEO_CATEGORY_SLUGS, SEO_CATEGORY_LABEL } from "@/lib/cities"
import { fetchPlacesForSeoPage }  from "@/lib/seo-search"
import SeoPageContent             from "@/components/seo/SeoPageContent"

export const revalidate = 86400 // ISR: regenerate at most every 24 h

type Params = { city: string; category: string }

function resolve(params: Params) {
  const city     = CITY_MAP.get(params.city as never)
  const category = SEO_CATEGORY_SLUGS[params.category]
  return { city, category }
}

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { city, category } = resolve(await params)
  if (!city || !category) return {}
  const slug        = Object.keys(SEO_CATEGORY_SLUGS).find((k) => SEO_CATEGORY_SLUGS[k] === category)!
  const catLabel    = SEO_CATEGORY_LABEL[slug]?.en ?? slug
  const title       = `Wheelchair-accessible ${catLabel} in ${city.nameEn}`
  const description = `Find wheelchair-accessible ${catLabel} in ${city.nameEn} – entrance, toilet and parking data from OpenStreetMap, accessibility.cloud and more.`
  const canonical   = `https://accessible-places.org/en/${city.slug}/${slug}`

  return {
    title,
    description,
    alternates: {
      canonical,
      languages: { de: `https://accessible-places.org/${city.slug}/${slug}` },
    },
    openGraph: { title, description, url: canonical, locale: "en_GB" },
  }
}

export default async function CityPageEn({ params }: { params: Promise<Params> }) {
  const resolved = resolve(await params)
  if (!resolved.city || !resolved.category) notFound()

  const { city, category } = resolved
  const slug   = Object.keys(SEO_CATEGORY_SLUGS).find((k) => SEO_CATEGORY_SLUGS[k] === category)!

  const places = await fetchPlacesForSeoPage(city.lat, city.lon, category).catch(() => [])

  return (
    <SeoPageContent
      locale="en"
      city={city}
      categorySlug={slug}
      places={places}
    />
  )
}
