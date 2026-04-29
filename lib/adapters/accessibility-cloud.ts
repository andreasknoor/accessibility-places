/**
 * accessibility.cloud adapter
 * API key required: set ACCESSIBILITY_CLOUD_API_KEY in .env.local
 * Docs: https://www.accessibility.cloud/
 */
import type { Place, SearchParams, A11yValue, Category, EntranceDetails, ToiletDetails, ParkingDetails } from "../types"
import { buildAttribute } from "../matching/merge"
import { nanoid } from "../utils"

const BASE_URL = "https://accessibility-cloud-v2.freetls.fastly.net"

// ─── LocalizedString helper ────────────────────────────────────────────────
// A11yJSON fields can be plain strings OR { de: "...", en: "..." } objects

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function localStr(v: any): string {
  if (!v) return ""
  if (typeof v === "string") return v
  if (typeof v === "object") return v.de ?? v.en ?? Object.values(v)[0] ?? ""
  return String(v)
}

// ─── A11yJSON helpers ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function a11yValue(props: any): A11yValue {
  const a = props?.accessibility
  if (!a) return "unknown"

  if (a.accessibleWith?.wheelchair === true)        return "yes"
  if (a.partiallyAccessibleWith?.wheelchair === true) return "limited"
  if (a.accessibleWith?.wheelchair === false)       return "no"

  // Infer from entrance data
  const entrance = a.entrances?.[0]
  if (entrance?.isLevel === true)  return "yes"
  if (entrance?.isLevel === false) return "no"

  return "unknown"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function a11yToiletValue(props: any): A11yValue {
  const restroom = props?.accessibility?.restrooms?.[0]
  if (!restroom) return "unknown"
  if (restroom.isAccessibleWithWheelchair === true)  return "yes"
  if (restroom.isAccessibleWithWheelchair === false) return "no"
  return "unknown"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function a11yParkingValue(props: any): A11yValue {
  const parking = props?.accessibility?.parking
  if (!parking) return "unknown"
  if (parking.forWheelchairUsers?.isAvailable === true)  return "yes"
  if (parking.forWheelchairUsers?.isAvailable === false) return "no"
  return "unknown"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function entranceDetails(props: any): EntranceDetails {
  const e = props?.accessibility?.entrances?.[0]
  if (!e) return {}
  return {
    isLevel:          e.isLevel,
    hasRamp:          e.hasFixedRamp ?? e.hasRemovableRamp,
    rampSlopePercent: e.slopeAngle?.value,
    doorWidthCm:      e.door?.width?.value,
    hasAutomaticDoor: e.door?.isAutomaticOrAlwaysOpen,
    hasHoist:         e.hasHoist,
    stepCount:        e.stairs?.stepCount,
    stepHeightCm:     e.stairs?.stepHeight?.value,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toiletDetails(props: any): ToiletDetails {
  const r = props?.accessibility?.restrooms?.[0]
  if (!r) return {}
  const gb = r.grabBars
  // grabBars object present → bars confirmed; absent → unknown (undefined, not false)
  const hasGrabBars = gb != null ? true : undefined
  return {
    hasGrabBars,
    // sub-attributes are meaningful only when grab bars are confirmed present
    grabBarsOnBothSides:    hasGrabBars ? (gb.onUsersLeftSide === true && gb.onUsersRightSide === true) : undefined,
    grabBarsFoldable:       hasGrabBars ? gb.foldable ?? undefined : undefined,
    turningRadiusCm:        r.turningSpaceInside?.width?.value,
    doorWidthCm:            r.entrance?.door?.width?.value ?? r.entrances?.[0]?.door?.width?.value,
    hasEmergencyPullstring: r.hasEmergencyPullstring === true ? true : undefined,
    // A.Cloud restrooms are implicitly inside the building
    isInside:               true,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parkingDetails(props: any): ParkingDetails {
  const p = props?.accessibility?.parking
  if (!p) return {}
  return {
    hasWheelchairSpaces: p.forWheelchairUsers?.isAvailable,
    spaceCount:          p.count,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCategory(props: any): Category {
  const cat = (props?.category ?? "").toLowerCase()
  if (cat.includes("cafe") || cat.includes("coffee") || cat.includes("kaffee")) return "cafe"
  if (cat.includes("restaurant"))                                                 return "restaurant"
  if (cat.includes("bar") || cat.includes("pub") || cat.includes("kneipe"))      return "bar"
  if (cat.includes("fast_food") || cat.includes("fastfood") || cat.includes("food_court")) return "fast_food"
  if (cat.includes("hotel") || cat.includes("hostel") || cat.includes("lodging") || cat.includes("motel")) return "hotel"
  if (cat.includes("museum"))                                                     return "museum"
  if (cat.includes("theatre") || cat.includes("theater") || cat.includes("cinema")) return "theater"
  if (cat.includes("library") || cat.includes("bibliothek"))                      return "library"
  if (cat.includes("gallery") || cat.includes("galerie"))                         return "gallery"
  return "attraction"
}

// ─── Parse one place from API response ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPlace(feature: any): Place | null {
  const props = feature.properties
  if (!props?.name) return null

  const coords = feature.geometry?.coordinates
  if (!coords) return null
  const [lon, lat] = coords

  const name = localStr(props.name)
  if (!name) return null
  const addr = props.address ?? {}

  return {
    id: nanoid(),
    name,
    category: mapCategory(props),
    address: {
      street:      localStr(addr.street),
      houseNumber: localStr(addr.housenumber),
      postalCode:  localStr(addr.postalCode),
      city:        localStr(addr.city ?? addr.locality),
      country:     localStr(addr.country) || "DE",
      raw:         localStr(addr.full) || undefined,
    },
    coordinates: { lat, lon },
    website: props.placeWebsiteUrl ?? undefined,
    phone:   props.phoneNumber     ?? undefined,
    accessibility: {
      entrance: buildAttribute("accessibility_cloud", a11yValue(props),        "a11y-cloud", entranceDetails(props)),
      toilet:   buildAttribute("accessibility_cloud", a11yToiletValue(props),  "a11y-cloud", toiletDetails(props)),
      parking:  buildAttribute("accessibility_cloud", a11yParkingValue(props), "a11y-cloud", parkingDetails(props)),
    },
    overallConfidence: 0,
    primarySource: "accessibility_cloud",
    sourceRecords: [{
      sourceId:   "accessibility_cloud",
      externalId: feature._id ?? feature.id ?? "",
      fetchedAt:  new Date().toISOString(),
      raw:        props,
    }],
  }
}

// ─── Public adapter function ───────────────────────────────────────────────

export async function fetchAccessibilityCloud(params: SearchParams): Promise<Place[]> {
  const apiKey = process.env.ACCESSIBILITY_CLOUD_API_KEY
  if (!apiKey) {
    console.warn("[accessibility.cloud] No API key — skipping")
    return []
  }

  const categoryPreset = "at-least-partially-accessible-by-wheelchair"
  const url = new URL(`${BASE_URL}/place-infos.json`)
  url.searchParams.set("appToken",          apiKey)
  url.searchParams.set("latitude",          String(params.location.lat))
  url.searchParams.set("longitude",         String(params.location.lon))
  url.searchParams.set("radius",            String(params.radiusKm * 1000))
  url.searchParams.set("accessibilityPreset", categoryPreset)
  url.searchParams.set("limit",             "100")

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal:  AbortSignal.timeout(15_000),
  })

  if (!res.ok) throw new Error(`accessibility.cloud error: ${res.status}`)
  const json = await res.json()

  const places: Place[] = []
  for (const feature of json.features ?? []) {
    const place = toPlace(feature)
    if (place) places.push(place)
  }
  return places
}
