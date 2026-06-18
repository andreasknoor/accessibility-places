import { NextRequest } from "next/server"
import { ipFromRequest, isRateLimited, rateLimitResponse } from "@/lib/rate-limit"
import { ALL_CATEGORIES } from "@/lib/llm"
import { fetchOsm } from "@/lib/adapters/osm"
import { fetchAccessibilityCloud } from "@/lib/adapters/accessibility-cloud"
import { fetchReisenFuerAlle } from "@/lib/adapters/reisen-fuer-alle"
import { fetchGinto } from "@/lib/adapters/ginto"
import { fetchAccesLibre } from "@/lib/adapters/acceslibre"
import { fetchGooglePlaces } from "@/lib/adapters/google-places"
import type { Category, Place, SearchParams, SourceId } from "@/lib/types"

// On-demand full-raw lookup for the debug sheet.
//
// The search response intentionally ships no `raw` (and only a small whitelisted
// `metadata` slice) so that a dense city search of hundreds of places stays a
// lean payload. When the user opens a place's "raw data" block, the client asks
// this route for the *complete* upstream object of one source record. Because we
// re-query a single adapter at the place's own coordinates with a tiny radius,
// the cost is bounded to one place regardless of how big the original result was.

const RADIUS_KM = 0.5

// Per-source single-fetch. OSM returns { places }, the rest return Place[].
const FETCHERS: Partial<Record<SourceId, (p: SearchParams) => Promise<Place[]>>> = {
  osm:                  async (p) => (await fetchOsm(p)).places,
  accessibility_cloud:  fetchAccessibilityCloud,
  reisen_fuer_alle:     fetchReisenFuerAlle,
  ginto:                fetchGinto,
  acceslibre:           fetchAccesLibre,
  google_places:        fetchGooglePlaces,
}

function fetcherFor(id: string): ((p: SearchParams) => Promise<Place[]>) | undefined {
  return FETCHERS[id as SourceId]
}

export async function GET(req: NextRequest) {
  if (isRateLimited("raw", ipFromRequest(req), 30)) return rateLimitResponse()

  const { searchParams } = req.nextUrl
  const sourceId   = searchParams.get("source") ?? ""
  const externalId = searchParams.get("id")     ?? ""
  const lat        = parseFloat(searchParams.get("lat") ?? "")
  const lon        = parseFloat(searchParams.get("lon") ?? "")
  const categoryRaw = searchParams.get("cat") ?? ""

  const fetcher = fetcherFor(sourceId)
  if (!fetcher) {
    return Response.json({ error: "Unknown source" }, { status: 400 })
  }
  if (!externalId) {
    return Response.json({ error: "Missing id" }, { status: 400 })
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return Response.json({ error: "Invalid coordinates" }, { status: 400 })
  }

  // Restrict the re-query to the place's own category when known, so adapters
  // that fan out per category (OSM, Google) issue a single narrow request.
  const category = (ALL_CATEGORIES as string[]).includes(categoryRaw)
    ? (categoryRaw as Category)
    : undefined

  const params: SearchParams = {
    query:    "",
    location: { lat, lon },
    radiusKm: RADIUS_KM,
    categories: category ? [category] : [...ALL_CATEGORIES],
    filters: {
      entrance: false, toilet: false, parking: false, parkingNearby: true,
      seating: false, onlyVerified: false, acceptUnknown: true,
      alwaysShowParking: false, alwaysShowToilets: false,
    },
    // Only the requested source runs; all others stay off.
    sources: {
      accessibility_cloud: sourceId === "accessibility_cloud",
      osm:                 sourceId === "osm",
      reisen_fuer_alle:    sourceId === "reisen_fuer_alle",
      ginto:               sourceId === "ginto",
      acceslibre:          sourceId === "acceslibre",
      google_places:       sourceId === "google_places",
    },
    signal: req.signal,
    // Always treat as international so geo gates (AccèsLibre = France only,
    // Ginto/RfA region skips applied in the search route) never block a
    // legitimate re-fetch of a record that already exists. For DACH coordinates
    // this still keeps the private Overpass server in the OSM race.
    international: true,
  }

  let places: Place[]
  try {
    places = await fetcher(params)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Fetch failed" },
      { status: 502 },
    )
  }

  const match = places
    .flatMap((p) => p.sourceRecords)
    .find((r) => r.sourceId === sourceId && r.externalId === externalId)

  if (!match || match.raw == null) {
    return Response.json({ error: "not_found" }, { status: 404 })
  }

  return Response.json(
    { raw: match.raw },
    // Raw venue data is stable enough to cache briefly at the edge; a single
    // place opened repeatedly should not re-hit the upstream adapter.
    { headers: { "Cache-Control": "private, max-age=300" } },
  )
}
