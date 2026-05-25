import { NextRequest } from "next/server"
import { fetchOsmDisabledParking } from "@/lib/adapters/osm"
import { ipFromRequest, isRateLimited, rateLimitResponse } from "@/lib/rate-limit"

const RADIUS_MIN_KM = 0.05
const RADIUS_MAX_KM = 3.0

export async function GET(req: NextRequest) {
  if (isRateLimited("nearby-parking", ipFromRequest(req), 20)) return rateLimitResponse()

  const { searchParams } = req.nextUrl
  const lat       = parseFloat(searchParams.get("lat")    ?? "")
  const lon       = parseFloat(searchParams.get("lon")    ?? "")
  const radiusRaw = parseFloat(searchParams.get("radius") ?? "0.3")

  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return Response.json({ error: "Invalid coordinates" }, { status: 400 })
  }

  const radiusKm = Number.isFinite(radiusRaw)
    ? Math.min(Math.max(radiusRaw, RADIUS_MIN_KM), RADIUS_MAX_KM)
    : 0.3

  let failed = false
  const { features } = await fetchOsmDisabledParking({ lat, lon }, radiusKm, req.signal).catch(() => {
    failed = true
    return { features: [], winnerEndpoint: "", durationMs: 0 }
  })

  // Errors must not be cached — a single Overpass blip would otherwise poison a 5-min window.
  return Response.json(features, {
    headers: failed
      ? { "Cache-Control": "no-store, max-age=0" }
      : { "Cache-Control": "public, max-age=300, s-maxage=300" },
  })
}
