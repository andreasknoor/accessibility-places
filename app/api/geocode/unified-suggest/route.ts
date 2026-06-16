import { NextRequest, NextResponse } from "next/server"
import { ipFromRequest, isRateLimited, rateLimitResponse } from "@/lib/rate-limit"
import { DACH_BBOX_STR, DACH_CODES, SUPPORTED_COUNTRY_CODES } from "@/lib/config"

const PHOTON_URL = "https://photon.komoot.io/api/"
const DACH_CODE_SET      = new Set<string>(DACH_CODES)
const SUPPORTED_CODE_SET = new Set<string>(SUPPORTED_COUNTRY_CODES)

// Photon `type` values that describe an administrative area rather than a venue.
const AREA_TYPES = new Set(["city", "district", "locality", "county", "state", "country"])
// OSM keys whose features are areas regardless of the Photon type field.
const AREA_OSM_KEYS = new Set(["place", "boundary"])

const MAX_AREAS  = 3
const MAX_VENUES = 5

export type UnifiedSuggestion = {
  kind:     "area" | "venue"
  display:  string
  name:     string
  lat:      number | null
  lon:      number | null
  osmKey:   string | null
  osmValue: string | null
}

/**
 * Unified location + venue autocomplete: one Photon call without layer
 * restriction, classified into areas (cities/districts) and venues (POIs).
 * Replaces the separate `suggest` (areas only) and `place-suggest` (POIs)
 * routes for the single-search-field UI; both remain live for one release.
 */
export async function GET(req: NextRequest) {
  if (isRateLimited("unified-suggest", ipFromRequest(req), 60)) return rateLimitResponse()

  const q    = req.nextUrl.searchParams.get("q")?.trim()
  const lang = req.nextUrl.searchParams.get("lang") ?? "de"
  const latRaw = req.nextUrl.searchParams.get("lat")
  const lonRaw = req.nextUrl.searchParams.get("lon")
  // International mode (opt-in): widen the area filter from DACH to the full
  // supported-country allowlist. UI sends ?intl=1 only when the setting is on.
  const intl = req.nextUrl.searchParams.get("intl") === "1"
  const codeSet = intl ? SUPPORTED_CODE_SET : DACH_CODE_SET

  if (!q || q.length < 2 || q.length > 200) return NextResponse.json([])

  // Validate coordinates as finite numbers in range — never pass user input verbatim
  // into the upstream URL, which would let callers smuggle additional Photon parameters.
  const lat = latRaw != null ? parseFloat(latRaw) : NaN
  const lon = lonRaw != null ? parseFloat(lonRaw) : NaN
  const biasOk = Number.isFinite(lat) && Number.isFinite(lon) &&
                 Math.abs(lat) <= 90 && Math.abs(lon) <= 180

  // No layer restriction — areas and POIs come back in one response.
  // Ask for more candidates than needed so classification + dedupe still
  // fill both groups.
  // In DACH mode a tight bbox sharpens results. In international mode no single
  // bbox can cover the allowlist (Europe + US), so we drop it and rely on the
  // per-result country-code filter below plus the optional lat/lon bias.
  let url = `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=20&lang=${lang}`
  if (!intl) url += `&bbox=${DACH_BBOX_STR}`
  if (biasOk) {
    url += `&lat=${lat}&lon=${lon}`
    // International mode: widen the proximity-bias radius via a low `zoom`.
    // Photon's default zoom (16) makes lat/lon act as a hard nearby filter — a
    // query like "Paris" from Berlin returns only local "Paris*" features and
    // drops Paris (FR) from the response entirely. zoom=10 keeps a mild local
    // preference (nearby matches still surface) while letting distant major
    // cities rank in. DACH mode keeps the default (tight) bias + bbox.
    if (intl) url += `&zoom=10`
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "AccessiblePlaces/1.0 (contact@accessible-places.org)" },
      signal:  AbortSignal.timeout(3_000),
    })
    if (!res.ok) return NextResponse.json([])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: { features?: any[] } = await res.json()
    const seen   = new Set<string>()
    const areas:  UnifiedSuggestion[] = []
    const venues: UnifiedSuggestion[] = []

    for (const f of data.features ?? []) {
      const p = f?.properties ?? {}

      // countrycode is often absent for POIs — trust the bbox/bias instead.
      // Only hard-exclude results with an explicit out-of-allowlist country code.
      const cc = (p.countrycode ?? "").toUpperCase()
      if (cc && !codeSet.has(cc)) continue

      const name = (p.name ?? "").trim()
      if (!name) continue

      const osmKey   = p.osm_key ?? null
      const osmValue = p.osm_value ?? null

      // Streets are neither a useful search area nor a venue — skip them.
      if (osmKey === "highway") continue

      const isArea =
        AREA_OSM_KEYS.has(osmKey ?? "") || AREA_TYPES.has((p.type ?? "").toLowerCase())

      const city    = (p.city ?? p.county ?? "").trim()
      const base    = city && city !== name ? `${name}, ${city}` : name
      const display = cc ? `${base} (${cc})` : base
      // Dedupe across both groups: node+way duplicates of the same feature can
      // classify identically, and an area/venue display collision is resolved
      // first-come (Photon ranks by relevance).
      if (seen.has(display)) continue
      seen.add(display)

      // GeoJSON coordinates are [lon, lat]
      const coords = f?.geometry?.coordinates
      const pLon   = typeof coords?.[0] === "number" ? coords[0] : null
      const pLat   = typeof coords?.[1] === "number" ? coords[1] : null

      const suggestion: UnifiedSuggestion = {
        kind: isArea ? "area" : "venue",
        display, name, lat: pLat, lon: pLon, osmKey, osmValue,
      }
      if (isArea) {
        if (areas.length < MAX_AREAS) areas.push(suggestion)
      } else {
        if (venues.length < MAX_VENUES) venues.push(suggestion)
      }
      if (areas.length >= MAX_AREAS && venues.length >= MAX_VENUES) break
    }

    // Areas first — they are fewer, higher-precision matches, and the grouped
    // dropdown renders them as the top section.
    return NextResponse.json([...areas, ...venues])
  } catch {
    return NextResponse.json([])
  }
}
