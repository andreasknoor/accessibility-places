import { notFound }      from "next/navigation"
import type { Metadata } from "next"
import { CITY_MAP, type CitySlug } from "@/lib/cities"
import { fetchPlacesForCityGuide }  from "@/lib/seo-search"
import CityGuideContent             from "@/components/seo/CityGuideContent"

// ISR: 5.5-day revalidation, offset from DE (5 days).
export const revalidate = 475200
export function generateStaticParams() { return [] }

type Params = { city: string }

const BASE = "https://accessible-places.org"

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { city: citySlug } = await params
  const city = CITY_MAP.get(citySlug as CitySlug)
  if (!city) return {}

  const title       = `Accessible ${city.nameEn} – Restaurants, Hotels, Museums & more`
  const description = `Wheelchair-accessible places in ${city.nameEn} – the best accessible restaurants, cafés, hotels, museums and attractions with verified accessibility data.`
  const canonical   = `${BASE}/en/${city.slug}/accessible`

  return {
    title,
    description,
    alternates: {
      canonical,
      languages: { en: canonical, de: `${BASE}/${city.slug}/barrierefrei`, "x-default": `${BASE}/${city.slug}/barrierefrei` },
    },
    robots:    { index: true, follow: true },
    openGraph: { title, description, url: canonical, locale: "en_GB", siteName: "Accessible Places" },
    twitter:   { card: "summary", title, description },
  }
}

export default async function CityGuidePageEn({ params }: { params: Promise<Params> }) {
  const { city: citySlug } = await params
  const city = CITY_MAP.get(citySlug as CitySlug)
  if (!city) notFound()

  const sections = await fetchPlacesForCityGuide(city.lat, city.lon).catch(() => [])
  if (sections.length === 0) notFound()

  return <CityGuideContent locale="en" city={city} sections={sections} />
}
