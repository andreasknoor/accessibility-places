import { NextRequest, NextResponse } from "next/server"
import { NOMINATIM_ENDPOINT } from "@/lib/config"

export async function GET(req: NextRequest) {
  const lat = req.nextUrl.searchParams.get("lat")
  const lon = req.nextUrl.searchParams.get("lon")

  const latN = parseFloat(lat ?? "")
  const lonN = parseFloat(lon ?? "")
  if (isNaN(latN) || isNaN(lonN) || latN < -90 || latN > 90 || lonN < -180 || lonN > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 })
  }

  const url = `${NOMINATIM_ENDPOINT}/reverse?lat=${latN}&lon=${lonN}&format=json&zoom=14`
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "AccessibleSpaces/1.0 (contact@accessible-spaces.app)" },
      signal:  AbortSignal.timeout(8_000),
    })
    if (!res.ok) return NextResponse.json({ error: "Reverse geocoding failed" }, { status: 502 })
    const data = await res.json()
    const a = data.address ?? {}
    const district = a.suburb ?? a.city_district ?? a.city ?? a.town ?? a.village ?? ""
    return NextResponse.json({ district })
  } catch {
    return NextResponse.json({ error: "Reverse geocoding failed" }, { status: 502 })
  }
}
