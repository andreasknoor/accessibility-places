import { NextRequest } from "next/server"
import { fetchOsmDisabledParking } from "@/lib/adapters/osm"

const RADIUS_MIN_KM = 0.05
const RADIUS_MAX_KM = 1.0

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const lat    = parseFloat(searchParams.get("lat")    ?? "")
  const lon    = parseFloat(searchParams.get("lon")    ?? "")
  const radius = parseFloat(searchParams.get("radius") ?? "0.3")

  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return Response.json({ error: "Invalid coordinates" }, { status: 400 })
  }

  const radiusKm  = Math.min(Math.max(radius, RADIUS_MIN_KM), RADIUS_MAX_KM)
  const features  = await fetchOsmDisabledParking({ lat, lon }, radiusKm).catch(() => [])

  return Response.json(features, {
    headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
  })
}
