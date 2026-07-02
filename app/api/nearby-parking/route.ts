import { NextRequest } from "next/server"
import { fetchOsmAccessibleAmenities } from "@/lib/adapters/osm"
import { dedupeToiletFeatures } from "@/lib/matching/nearby-parking"
import { ipFromRequest, isRateLimited, rateLimitResponse } from "@/lib/rate-limit"
import { trackUserSearch } from "@/lib/user-stats"
import type { AmenityType } from "@/lib/types"

const RADIUS_MIN_KM = 0.05
// Upper bound matches the OSM helper's NEARBY_PARKING_MAX_RADIUS_KM. Raised from
// 5 km so focus-mode "search this area" can cover a zoomed-out map viewport; the
// helper's timeout + payload caps keep large queries bounded.
const RADIUS_MAX_KM = 25.0

// Generic nearby-amenity endpoint. Despite the legacy path name, it serves both
// parking and toilet features via ?types=parking,toilet (default: parking).
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

  // Anonymous top-users stat (amenity searches count too — decision in
  // docs/plans/top-users-stats.md). The uid in the URL makes responses per-user;
  // identical repeats within the 5-min browser-cache window aren't recounted,
  // which is an accepted undercount.
  trackUserSearch(searchParams.get("uid"), searchParams.get("pf"))

  // International mode (opt-in): outside DACH the region-aware endpoint choice
  // drops the DACH-only private Overpass server, which would otherwise win the
  // race with an empty response (e.g. focus-mode parking/WC in Paris → nothing).
  const international = searchParams.get("intl") === "1"

  // Parse requested types; default to parking for back-compat with old callers.
  const requested = (searchParams.get("types") ?? "parking")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is AmenityType => s === "parking" || s === "toilet")
  const typeSet = new Set<AmenityType>(requested.length > 0 ? requested : ["parking"])


  const types = [...typeSet]
  if (types.length === 0) {
    return Response.json([], { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } })
  }

  // Always include the weak "accessible" tier — the client filters it out again
  // unless the user opted in via the showWeakParking setting.
  let failed = false
  const { features } = await fetchOsmAccessibleAmenities({ lat, lon }, radiusKm, types, {
    signal: req.signal,
    includeWeakTier: true,
    international,
  }).catch(() => {
    failed = true
    return { features: [], winnerEndpoint: "", durationMs: 0 }
  })

  // Collapse duplicate WCs returned by the standalone + venue toilet clauses.
  const deduped = types.includes("toilet") ? dedupeToiletFeatures(features) : features

  // Errors must not be cached — a single Overpass blip would otherwise poison a 5-min window.
  return Response.json(deduped, {
    headers: failed
      ? { "Cache-Control": "no-store, max-age=0" }
      : { "Cache-Control": "public, max-age=300, s-maxage=300" },
  })
}
