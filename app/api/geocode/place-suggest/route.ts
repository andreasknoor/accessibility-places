import { NextRequest, NextResponse } from "next/server"
import { ipFromRequest, isRateLimited, rateLimitResponse } from "@/lib/rate-limit"

const PHOTON_URL = "https://photon.komoot.io/api/"
const DACH_BBOX  = "5.87,45.82,17.17,55.06"
const DACH_CODES = new Set(["DE", "AT", "CH"])

export async function GET(req: NextRequest) {
  if (isRateLimited("place-suggest", ipFromRequest(req), 60)) return rateLimitResponse()

  const q    = req.nextUrl.searchParams.get("q")?.trim()
  const lang = req.nextUrl.searchParams.get("lang") ?? "de"
  const latRaw = req.nextUrl.searchParams.get("lat")
  const lonRaw = req.nextUrl.searchParams.get("lon")

  if (!q || q.length < 2 || q.length > 200) return NextResponse.json([])

  // Validate coordinates as finite numbers in range — never pass user input verbatim
  // into the upstream URL, which would let callers smuggle additional Photon parameters.
  const lat = latRaw != null ? parseFloat(latRaw) : NaN
  const lon = lonRaw != null ? parseFloat(lonRaw) : NaN
  const biasOk = Number.isFinite(lat) && Number.isFinite(lon) &&
                 Math.abs(lat) <= 90 && Math.abs(lon) <= 180

  // No layer restriction — include POIs (hotels, restaurants, offices, …).
  // Ask for more candidates than needed so deduplication still yields 5 results.
  let url = `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=20&lang=${lang}&bbox=${DACH_BBOX}`
  if (biasOk) url += `&lat=${lat}&lon=${lon}`

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "AccessiblePlaces/1.0 (contact@accessible-places.org)" },
      signal:  AbortSignal.timeout(3_000),
    })
    if (!res.ok) return NextResponse.json([])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: { features?: any[] } = await res.json()
    const seen = new Set<string>()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const suggestions = (data.features ?? []).flatMap((f: any) => {
      // countrycode is often absent for POIs — trust the bbox filter instead.
      // Only hard-exclude results with an explicit non-DACH country code.
      const cc = (f.properties?.countrycode ?? "").toUpperCase()
      if (cc && !DACH_CODES.has(cc)) return []

      const p    = f.properties ?? {}
      const name = (p.name ?? "").trim()
      if (!name) return []

      const city    = (p.city ?? p.county ?? "").trim()
      const base    = city && city !== name ? `${name}, ${city}` : name
      const display = cc ? `${base} (${cc})` : base
      if (seen.has(display)) return []
      seen.add(display)

      // GeoJSON coordinates are [lon, lat]
      const coords = f.geometry?.coordinates
      const pLon   = typeof coords?.[0] === "number" ? coords[0] : null
      const pLat   = typeof coords?.[1] === "number" ? coords[1] : null

      return [{ display, name, lat: pLat, lon: pLon, osmKey: p.osm_key ?? null, osmValue: p.osm_value ?? null }]
    }).slice(0, 5)

    return NextResponse.json(suggestions)
  } catch {
    return NextResponse.json([])
  }
}
