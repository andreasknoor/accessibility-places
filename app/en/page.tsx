import type { Metadata } from "next"
import HomeClient from "@/app/HomeClient"

const BASE = "https://accessible-places.org"

export const metadata: Metadata = {
  title: "Accessible Places — Find Wheelchair-Accessible Venues",
  description: "Find wheelchair-accessible restaurants, hotels, cafés and more in Germany, Austria and Switzerland. Combines OpenStreetMap, Wheelmap and Google Places data with reliability ratings.",
  alternates: {
    canonical: `${BASE}/en`,
    languages: {
      de:        `${BASE}/`,
      en:        `${BASE}/en`,
      "x-default": `${BASE}/`,
    },
  },
  openGraph: {
    type:        "website",
    url:         `${BASE}/en`,
    title:       "Accessible Places — Find Wheelchair-Accessible Venues",
    description: "Find wheelchair-accessible restaurants, hotels, cafés and more in Germany, Austria and Switzerland.",
    locale:      "en_US",
    siteName:    "Accessible Places",
  },
}

export default async function EnPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string }>
}) {
  const { q, cat } = await searchParams
  return <HomeClient initialCity={q} initialCategory={cat} />
}
