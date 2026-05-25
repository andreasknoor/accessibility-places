import { NextRequest, NextResponse } from "next/server"
import { NOMINATIM_ENDPOINT } from "@/lib/config"
import { ipFromRequest, isRateLimited, rateLimitResponse } from "@/lib/rate-limit"

export async function GET(req: NextRequest) {
  if (isRateLimited("reverse", ipFromRequest(req), 30)) return rateLimitResponse()

  const lat = req.nextUrl.searchParams.get("lat")
  const lon = req.nextUrl.searchParams.get("lon")

  const latN = parseFloat(lat ?? "")
  const lonN = parseFloat(lon ?? "")
  if (isNaN(latN) || isNaN(lonN) || latN < -90 || latN > 90 || lonN < -180 || lonN > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 })
  }

  const detail = req.nextUrl.searchParams.get("detail") === "1"
  const zoom   = detail ? 18 : 14
  const url = `${NOMINATIM_ENDPOINT}/reverse?lat=${latN}&lon=${lonN}&format=json&zoom=${zoom}`
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "AccessiblePlaces/1.0 (contact@accessible-places.org)" },
      signal:  AbortSignal.timeout(8_000),
    })
    if (!res.ok) return NextResponse.json({ error: "Reverse geocoding failed" }, { status: 502 })
    const data = await res.json()
    const a = data.address ?? {}
    const district = a.suburb ?? a.city_district ?? a.city ?? a.town ?? a.village ?? ""
    if (!detail) return NextResponse.json({ district })
    return NextResponse.json({
      district,
      street:      a.road ?? a.pedestrian ?? a.footway ?? a.path ?? "",
      houseNumber: a.house_number ?? "",
      postalCode:  a.postcode ?? "",
      city:        a.city ?? a.town ?? a.village ?? a.municipality ?? "",
    })
  } catch {
    return NextResponse.json({ error: "Reverse geocoding failed" }, { status: 502 })
  }
}
