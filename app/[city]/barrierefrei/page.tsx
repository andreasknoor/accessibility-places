import { notFound }      from "next/navigation"
import type { Metadata } from "next"
import { CITY_MAP, type CitySlug } from "@/lib/cities"
import { fetchPlacesForCityGuide }  from "@/lib/seo-search"
import CityGuideContent             from "@/components/seo/CityGuideContent"

// ISR: 5-day revalidation, lazy rendering (no pre-renders at build time).
export const revalidate = 432000
export function generateStaticParams() { return [] }

type Params = { city: string }

const BASE = "https://accessible-places.org"

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { city: citySlug } = await params
  const city = CITY_MAP.get(citySlug as CitySlug)
  if (!city) return {}

  const title       = `Barrierefrei in ${city.nameDe} – Restaurants, Hotels, Museen & mehr`
  const description = `Rollstuhlgerechte Orte in ${city.nameDe} – die besten barrierefreien Restaurants, Cafés, Hotels, Museen und Sehenswürdigkeiten mit verifizierten Barrierefreiheits-Daten.`
  const canonical   = `${BASE}/${city.slug}/barrierefrei`

  return {
    title,
    description,
    alternates: {
      canonical,
      languages: { de: canonical, en: `${BASE}/en/${city.slug}/accessible`, "x-default": canonical },
    },
    robots:    { index: true, follow: true },
    openGraph: { title, description, url: canonical, locale: "de_DE", siteName: "Accessible Places" },
    twitter:   { card: "summary", title, description },
  }
}

export default async function CityGuidePage({ params }: { params: Promise<Params> }) {
  const { city: citySlug } = await params
  const city = CITY_MAP.get(citySlug as CitySlug)
  if (!city) notFound()

  const sections = await fetchPlacesForCityGuide(city.lat, city.lon).catch(() => [])
  if (sections.length === 0) notFound()

  return <CityGuideContent locale="de" city={city} sections={sections} />
}
