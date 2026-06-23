import type { Metadata } from "next"
import { headers } from "next/headers"
import HomeClient from "./HomeClient"

const BASE = "https://accessible-places.org"

function parseCoord(raw: string | undefined, maxAbs: number): number | undefined {
  if (!raw) return undefined
  const n = parseFloat(raw)
  return Number.isFinite(n) && Math.abs(n) <= maxAbs ? n : undefined
}

export const metadata: Metadata = {
  alternates: {
    canonical: `${BASE}/`,
    languages: {
      de:          `${BASE}/`,
      en:          `${BASE}/en`,
      "x-default": `${BASE}/`,
    },
  },
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string; selectLat?: string; selectLon?: string; selectName?: string }>
}) {
  const { q, cat, selectLat, selectLon, selectName } = await searchParams
  // Access-location country from Vercel's edge geo header (absent locally → null).
  // Drives the international-search hint (see HomeClient). Page is already dynamic.
  const country = (await headers()).get("x-vercel-ip-country")
  return (
    <HomeClient
      initialCity={q}
      initialCategory={cat}
      initialSelectLat={parseCoord(selectLat, 90)}
      initialSelectLon={parseCoord(selectLon, 180)}
      initialSelectName={selectName}
      initialCountry={country}
    />
  )
}
