import { NextRequest, NextResponse } from "next/server"
import { NOMINATIM_ENDPOINT } from "@/lib/config"

export async function GET(req: NextRequest) {
  const q   = req.nextUrl.searchParams.get("q")
  const lat = req.nextUrl.searchParams.get("lat")
  const lon = req.nextUrl.searchParams.get("lon")
  if (!q) return NextResponse.json({ error: "Missing q" }, { status: 400 })

  const latN = lat ? parseFloat(lat) : NaN
  const lonN = lon ? parseFloat(lon) : NaN
  const viewbox = !isNaN(latN) && !isNaN(lonN)
    ? `&viewbox=${lonN - 0.2},${latN + 0.2},${lonN + 0.2},${latN - 0.2}&bounded=0`
    : ""

  const url = `${NOMINATIM_ENDPOINT}/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=de,at,ch${viewbox}`

  const res = await fetch(url, {
    headers: { "User-Agent": "AccessiblePlaces/1.0 (contact@accessible-places.org)" },
    signal:  AbortSignal.timeout(8_000),
  })

  if (!res.ok) return NextResponse.json({ error: "Geocoding failed" }, { status: 502 })

  const data = await res.json()
  if (!data[0]) return NextResponse.json({ error: "Location not found" }, { status: 404 })

  return NextResponse.json({
    lat:         parseFloat(data[0].lat),
    lon:         parseFloat(data[0].lon),
    displayName: data[0].display_name,
  })
}
