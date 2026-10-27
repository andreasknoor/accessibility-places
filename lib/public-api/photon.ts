import { DACH_BBOX_STR, DACH_CODES } from "../config"
import { UPSTREAM_TIMEOUT_MS } from "./constants"

// Photon (the same komoot instance /api/geocode/unified-suggest uses) turns
// "<name> <address> <city>" into candidate venue coordinates for /places/lookup.

const PHOTON_URL = "https://photon.komoot.io/api/"
const DACH_CODE_SET = new Set<string>(DACH_CODES)
const AREA_TYPES = new Set(["city", "district", "locality", "county", "state", "country"])

export interface PhotonHit {
  kind:  "area" | "venue"
  name:  string
  city:  string
  lat:   number
  lon:   number
  osmRef?: string   // "way/123"
}

const OSM_TYPE: Record<string, string> = { N: "node", W: "way", R: "relation" }

export async function photonSearch(
  q: string,
  opts: { bias?: { lat: number; lon: number }; limit?: number; areasOnly?: boolean } = {},
): Promise<PhotonHit[]> {
  let url = `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=${opts.limit ?? 15}&lang=de&bbox=${DACH_BBOX_STR}`
  if (opts.bias) url += `&lat=${opts.bias.lat}&lon=${opts.bias.lon}`
  if (opts.areasOnly) url += ["city", "district", "county"].map((l) => `&layer=${l}`).join("")

  const res = await fetch(url, {
    headers: { "User-Agent": "AccessiblePlaces/1.0 (contact@accessible-places.org)" },
    signal:  AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Photon returned ${res.status}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: { features?: any[] } = await res.json()

  const hits: PhotonHit[] = []
  for (const f of data.features ?? []) {
    const p = f?.properties ?? {}
    const cc = String(p.countrycode ?? "").toUpperCase()
    if (cc && !DACH_CODE_SET.has(cc)) continue
    if (p.osm_key === "highway") continue
    const [lon, lat] = f?.geometry?.coordinates ?? []
    if (typeof lat !== "number" || typeof lon !== "number") continue
    const isArea = p.osm_key === "place" || p.osm_key === "boundary" || AREA_TYPES.has(String(p.type ?? "").toLowerCase())
    const type = OSM_TYPE[p.osm_type as string]
    hits.push({
      kind: isArea ? "area" : "venue",
      name: String(p.name ?? ""),
      city: String(p.city ?? p.county ?? ""),
      lat, lon,
      ...(type && p.osm_id ? { osmRef: `${type}/${p.osm_id}` } : {}),
    })
  }
  return hits
}
