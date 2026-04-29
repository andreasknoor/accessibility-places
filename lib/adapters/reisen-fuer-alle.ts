/**
 * Reisen für Alle adapter
 * API access via DSFT/Natko — request at: https://www.reisen-fuer-alle.de
 * Set REISEN_FUER_ALLE_API_KEY and REISEN_FUER_ALLE_API_BASE in .env.local
 *
 * The API returns certified tourism businesses with structured criteria results.
 * Certification is based on physical on-site inspection → highest reliability.
 */
import type {
  Place,
  SearchParams,
  A11yValue,
  Category,
  EntranceDetails,
  ToiletDetails,
  ParkingDetails,
} from "../types"
import { buildAttribute } from "../matching/merge"
import { nanoid } from "../utils"

// ─── Certification criteria codes used by Reisen für Alle ─────────────────
// These are illustrative — exact codes depend on the API contract.
// Update when you receive the API documentation.
const CRITERIA = {
  entrance: ["E01", "E02", "E03"],    // step-free, door width, ramp
  toilet:   ["T01", "T02", "T03"],    // grab bars, turning radius, door width
  parking:  ["P01"],                   // wheelchair parking spaces
} as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function criteriaValue(data: any, codes: readonly string[]): A11yValue {
  if (!data?.criteria) return "unknown"
  const relevant = data.criteria.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) => codes.includes(c.code),
  )
  if (relevant.length === 0) return "unknown"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const met    = relevant.filter((c: any) => c.fulfilled === true).length
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notMet = relevant.filter((c: any) => c.fulfilled === false).length
  if (met === relevant.length)           return "yes"
  if (met > 0 && notMet < relevant.length) return "limited"
  if (notMet === relevant.length)        return "no"
  return "unknown"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildEntranceDetails(data: any): EntranceDetails {
  if (!data?.criteria) return {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = (code: string) => data.criteria.find((c: any) => c.code === code)
  return {
    isLevel:          get("E01")?.fulfilled,
    doorWidthCm:      get("E02")?.value,
    hasRamp:          get("E03")?.fulfilled,
    hasAutomaticDoor: get("E04")?.fulfilled,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildToiletDetails(data: any): ToiletDetails {
  if (!data?.criteria) return {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = (code: string) => data.criteria.find((c: any) => c.code === code)
  return {
    hasGrabBars:           get("T01")?.fulfilled,
    grabBarsOnBothSides:   get("T01")?.value === "both",
    turningRadiusCm:       get("T02")?.value,
    doorWidthCm:           get("T03")?.value,
    hasEmergencyPullstring: get("T04")?.fulfilled,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildParkingDetails(data: any): ParkingDetails {
  if (!data?.criteria) return {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = (code: string) => data.criteria.find((c: any) => c.code === code)
  return {
    hasWheelchairSpaces: get("P01")?.fulfilled,
    spaceCount:          get("P01")?.value,
    distanceToEntranceM: get("P02")?.value,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCategory(item: any): Category {
  const type = (item.type ?? item.category ?? "").toLowerCase()
  if (type.includes("cafe") || type.includes("kaffee") || type.includes("bistro"))            return "cafe"
  if (type.includes("gastronomie") || type.includes("restaurant"))                             return "restaurant"
  if (type.includes("bar") || type.includes("kneipe") || type.includes("biergarten"))         return "bar"
  if (type.includes("imbiss") || type.includes("fast"))                                        return "fast_food"
  if (type.includes("hotel") || type.includes("beherbergung") || type.includes("unterkunft")) return "hotel"
  if (type.includes("museum"))                                                                  return "museum"
  if (type.includes("theater") || type.includes("kino") || type.includes("oper"))             return "theater"
  if (type.includes("bibliothek") || type.includes("bücherei"))                                return "library"
  if (type.includes("galerie") || type.includes("gallery"))                                    return "gallery"
  return "attraction"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPlace(item: any): Place | null {
  if (!item?.name) return null
  const lat = parseFloat(item.lat ?? item.latitude ?? "0")
  const lon = parseFloat(item.lon ?? item.longitude ?? "0")
  if (!lat || !lon) return null

  const entranceVal = criteriaValue(item, CRITERIA.entrance)
  const toiletVal   = criteriaValue(item, CRITERIA.toilet)
  const parkingVal  = criteriaValue(item, CRITERIA.parking)

  return {
    id: nanoid(),
    name:     item.name,
    category: mapCategory(item),
    address: {
      street:      item.street      ?? item.address?.street      ?? "",
      houseNumber: item.houseNumber ?? item.address?.houseNumber ?? "",
      postalCode:  String(item.zip ?? item.address?.zip ?? ""),
      city:        item.city        ?? item.address?.city        ?? "",
      country:     item.country     ?? "DE",
    },
    coordinates: { lat, lon },
    website: item.website ?? undefined,
    phone:   item.phone   ?? undefined,
    accessibility: {
      entrance: buildAttribute("reisen_fuer_alle", entranceVal, "rfa-certified", buildEntranceDetails(item)),
      toilet:   buildAttribute("reisen_fuer_alle", toiletVal,   "rfa-certified", buildToiletDetails(item)),
      parking:  buildAttribute("reisen_fuer_alle", parkingVal,  "rfa-certified", buildParkingDetails(item)),
    },
    overallConfidence: 0,
    primarySource: "reisen_fuer_alle",
    sourceRecords: [{
      sourceId:   "reisen_fuer_alle",
      externalId: String(item.id ?? item.businessId ?? ""),
      fetchedAt:  new Date().toISOString(),
      raw:        item,
    }],
  }
}

// ─── Public adapter function ───────────────────────────────────────────────

export async function fetchReisenFuerAlle(params: SearchParams): Promise<Place[]> {
  const apiKey  = process.env.REISEN_FUER_ALLE_API_KEY
  const apiBase = process.env.REISEN_FUER_ALLE_API_BASE

  // Skip silently when either value is missing or still a `your_…` placeholder.
  // Without this guard the live fetch produces a noisy ENOTFOUND stack on every
  // search since the public RfA API endpoint is not generally reachable.
  const isPlaceholder = (v?: string) => !v || v.startsWith("your_")
  if (isPlaceholder(apiKey) || isPlaceholder(apiBase)) return []

  const url = new URL(`${apiBase}/businesses`)
  url.searchParams.set("lat",    String(params.location.lat))
  url.searchParams.set("lon",    String(params.location.lon))
  url.searchParams.set("radius", String(params.radiusKm * 1000))
  url.searchParams.set("limit",  "100")

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept:        "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) throw new Error(`Reisen für Alle API error: ${res.status}`)
  const json = await res.json()

  const places: Place[] = []
  for (const item of json.data ?? json.results ?? json ?? []) {
    const place = toPlace(item)
    if (place) places.push(place)
  }
  return places
}
