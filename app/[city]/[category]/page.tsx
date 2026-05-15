import { notFound }      from "next/navigation"
import type { Metadata } from "next"
import { CITY_MAP, SEO_CATEGORY_SLUGS, SEO_CATEGORY_LABEL, type CitySlug } from "@/lib/cities"
import { fetchPlacesForSeoPage } from "@/lib/seo-search"
import { hasData }               from "@/lib/seo-validity"
import SeoPageContent            from "@/components/seo/SeoPageContent"

// ISR: 5-day revalidation. generateStaticParams returns [] so no pages are
// pre-rendered at build time — all 320 routes render lazily on first request.
// dynamicParams = true (default) allows any valid city/category slug.
export const revalidate = 432000

export function generateStaticParams() { return [] }

type Params = { city: string; category: string }

function resolve(params: Params) {
  const city     = CITY_MAP.get(params.city as CitySlug)
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
  let places
  try {
    places = await fetchPlacesForSeoPage(city.lat, city.lon, category)
  } catch (err) {
    console.error(`[seo] fetch failed for ${city.slug}/${slug}:`, err)
    throw err  // let Next.js serve the stale ISR cache instead of caching an empty page
  }

  if (places.length === 0 && !hasData(city.slug, slug)) notFound()

  return <SeoPageContent locale="de" city={city} categorySlug={slug} places={places} />
}
