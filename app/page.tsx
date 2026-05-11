import type { Metadata } from "next"
import HomeClient from "./HomeClient"

const BASE = "https://accessible-places.org"

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
  return (
    <HomeClient
      initialCity={q}
      initialCategory={cat}
      initialSelectLat={selectLat  ? parseFloat(selectLat)  : undefined}
      initialSelectLon={selectLon  ? parseFloat(selectLon)  : undefined}
      initialSelectName={selectName}
    />
  )
}
