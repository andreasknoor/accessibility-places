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
  searchParams: Promise<{ q?: string; cat?: string }>
}) {
  const { q, cat } = await searchParams
  return <HomeClient initialCity={q} initialCategory={cat} />
}
