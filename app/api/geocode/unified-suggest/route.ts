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
// Layers requested on the dedicated area query. Deliberately excludes Photon's
// "locality" layer: verified live that it surfaces noisy landuse/commercial
// features (industrial estates, shopping centres) rather than city/district
// entities, which would defeat the point of a precision-focused second call.
const AREA_LAYERS = ["city", "district", "county", "state", "country"]

const MAX_AREAS  = 3
const MAX_VENUES = 5
// Fetch a few more than MAX_AREAS on the dedicated call so dedupe/cc-filtering
// still leaves enough candidates.
const AREA_QUERY_LIMIT = 8

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
 * Unified location + venue autocomplete. Two parallel Photon calls:
 * - a general, unrestricted query (limit=20) for venues
 * - a dedicated query with `layer=city,district,county,state,country` for areas
 *
 * The dedicated area call exists because Photon's relevance ranking on a short,
 * partially-typed query (e.g. "Berlin Char") routinely buries the actual
 * district/city entity beneath dozens of venues whose name or address field
 * happens to contain the same text — verified live: "Berlin Char" returns zero
 * district-type results in the general call's top 20, while a `layer`-scoped
 * call finds "Charlottenburg" immediately, without needing extra characters.
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

  // Shared params for both calls. In DACH mode a tight bbox sharpens results.
  // In international mode no single bbox can cover the allowlist (Europe + US),
  // so we drop it and rely on the per-result country-code filter below plus the
  // optional lat/lon bias.
  let sharedParams = `lang=${lang}`
  if (!intl) sharedParams += `&bbox=${DACH_BBOX_STR}`
  if (biasOk) {
    sharedParams += `&lat=${lat}&lon=${lon}`
    // International mode: widen the proximity-bias radius via a low `zoom`.
    // Photon's default zoom (16) makes lat/lon act as a hard nearby filter — a
    // query like "Paris" from Berlin returns only local "Paris*" features and
    // drops Paris (FR) from the response entirely. zoom=10 keeps a mild local
    // preference (nearby matches still surface) while letting distant major
    // cities rank in. DACH mode keeps the default (tight) bias + bbox.
    if (intl) sharedParams += `&zoom=10`
  }

  // General, unrestricted query — ask for more candidates than needed so
  // classification + dedupe still fill the venues group.
  const venueUrl = `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=20&${sharedParams}`
  // Dedicated area query — layer-restricted so short/ambiguous prefixes still
  // surface the actual district/city entity instead of losing it to venues.
  const areaUrl =
    `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=${AREA_QUERY_LIMIT}&${sharedParams}` +
    AREA_LAYERS.map((l) => `&layer=${l}`).join("")

  const fetchPhoton = async (url: string) => {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "AccessiblePlaces/1.0 (contact@accessible-places.org)" },
        signal:  AbortSignal.timeout(3_000),
      })
      if (!res.ok) return []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: { features?: any[] } = await res.json()
      return data.features ?? []
    } catch {
      return []
    }
  }

  const [venueFeatures, areaFeatures] = await Promise.all([
    fetchPhoton(venueUrl),
    fetchPhoton(areaUrl),
  ])

  const seen  = new Set<string>()
  const areas:  UnifiedSuggestion[] = []
  const venues: UnifiedSuggestion[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toSuggestion = (f: any): UnifiedSuggestion | null => {
    const p = f?.properties ?? {}

    // countrycode is often absent for POIs — trust the bbox/bias instead.
    // Only hard-exclude results with an explicit out-of-allowlist country code.
    const cc = (p.countrycode ?? "").toUpperCase()
    if (cc && !codeSet.has(cc)) return null

    const name = (p.name ?? "").trim()
    if (!name) return null

    const osmKey   = p.osm_key ?? null
    const osmValue = p.osm_value ?? null

    // Streets are neither a useful search area nor a venue — skip them.
    if (osmKey === "highway") return null

    const isArea =
      AREA_OSM_KEYS.has(osmKey ?? "") || AREA_TYPES.has((p.type ?? "").toLowerCase())

    const city    = (p.city ?? p.county ?? "").trim()
    const base    = city && city !== name ? `${name}, ${city}` : name
    const display = cc ? `${base} (${cc})` : base

    // GeoJSON coordinates are [lon, lat]
    const coords = f?.geometry?.coordinates
    const pLon   = typeof coords?.[0] === "number" ? coords[0] : null
    const pLat   = typeof coords?.[1] === "number" ? coords[1] : null

    return { kind: isArea ? "area" : "venue", display, name, lat: pLat, lon: pLon, osmKey, osmValue }
  }

  // Areas first, sourced from the dedicated layer-restricted call — this is
  // what fixes short-prefix queries losing the district/city entity to venues.
  for (const f of areaFeatures) {
    if (areas.length >= MAX_AREAS) break
    const s = toSuggestion(f)
    if (!s || s.kind !== "area") continue
    if (seen.has(s.display)) continue
    seen.add(s.display)
    areas.push(s)
  }

  // Venues from the general call. Also catches any area-classified feature the
  // dedicated call missed (e.g. rate-limited/failed), as a fallback.
  for (const f of venueFeatures) {
    if (areas.length >= MAX_AREAS && venues.length >= MAX_VENUES) break
    const s = toSuggestion(f)
    if (!s) continue
    if (seen.has(s.display)) continue
    if (s.kind === "area" && areas.length >= MAX_AREAS) continue
    seen.add(s.display)
    if (s.kind === "area") areas.push(s)
    else if (venues.length < MAX_VENUES) venues.push(s)
  }

  // Areas first — they are fewer, higher-precision matches, and the grouped
  // dropdown renders them as the top section.
  return NextResponse.json([...areas, ...venues])
}
