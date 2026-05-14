import { cache }           from "react"
import { notFound }        from "next/navigation"
import type { Metadata }    from "next"
import { CITIES, CITY_MAP, SEO_CATEGORY_SLUGS, SEO_CATEGORY_LABEL } from "@/lib/cities"
import { getPlacesSnapshot }  from "@/lib/seo-blob"
import SeoPageContent         from "@/components/seo/SeoPageContent"

export const dynamicParams = false

export async function generateStaticParams() {
  return CITIES.flatMap((city) =>
    Object.keys(SEO_CATEGORY_SLUGS).map((category) => ({
      city:     city.slug,
      category,
    })),
  )
}

type Params = { city: string; category: string }

const cachedSnapshot = cache(getPlacesSnapshot)

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
  const catLabel  = SEO_CATEGORY_LABEL[slug]?.en ?? slug
  const places    = await cachedSnapshot(city.slug, slug)
  const count     = places.length
  const canonical = `${BASE}/en/${city.slug}/${slug}`

  const title = `Wheelchair-accessible ${catLabel} in ${city.nameEn}`
  const description = count > 0
    ? `${count} wheelchair-accessible ${catLabel} in ${city.nameEn} – entrance, toilet and parking data from OpenStreetMap, accessibility.cloud and more.`
    : `Wheelchair-accessible ${catLabel} in ${city.nameEn} – entrance, toilet and parking data from OpenStreetMap, accessibility.cloud and more.`

  return {
    title,
    description,
    alternates: {
      canonical,
      languages: {
        de:          `${BASE}/${city.slug}/${slug}`,
        en:          canonical,
        "x-default": `${BASE}/${city.slug}/${slug}`,
      },
    },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url:      canonical,
      locale:   "en_GB",
      siteName: "Accessible Places",
    },
    twitter: {
      card:        "summary",
      title,
      description,
    },
  }
}

export default async function CityPageEn({ params }: { params: Promise<Params> }) {
  const resolved = resolve(await params)
  if (!resolved.city || !resolved.category) notFound()

  const { city, category } = resolved
  const slug   = Object.keys(SEO_CATEGORY_SLUGS).find((k) => SEO_CATEGORY_SLUGS[k] === category)!
  const places = await cachedSnapshot(city.slug, slug)

  return (
    <SeoPageContent
      locale="en"
      city={city}
      categorySlug={slug}
      places={places}
    />
  )
}
