/**
 * Google Places API (New) adapter
 * API key required: set GOOGLE_PLACES_API_KEY in .env.local
 * Docs: https://developers.google.com/maps/documentation/places/web-service/nearby-search
 */
import type {
  Place,
  SearchParams,
  A11yValue,
  Category,
  SeatingDetails,
} from "../types"
import { buildAttribute } from "../matching/merge"
import { nanoid } from "../utils"

const BASE_URL = "https://places.googleapis.com/v1/places:searchNearby"

const CATEGORY_TYPES: Record<Category, string[]> = {
  cafe:        ["cafe", "coffee_shop"],
  restaurant:  ["restaurant"],
  bar:         ["bar"],
  pub:         ["pub"],
  // Google Places has no `biergarten` type — fall back to bar+pub which is
  // the closest functional match.
  biergarten:  ["bar", "pub"],
  fast_food:   ["fast_food_restaurant", "food_court"],
  hotel:       ["hotel", "motel", "extended_stay_hotel"],
  hostel:      ["hostel"],
  // No specific apartment type — `lodging` is Google's umbrella for stays.
  apartment:   ["lodging"],
  museum:      ["museum"],
  theater:     ["performing_arts_theater"],
  cinema:      ["movie_theater"],
  library:     ["library"],
  gallery:     ["art_gallery"],
  attraction:  ["tourist_attraction", "amusement_park"],
  // Google Places has no dedicated ice_cream type — ice_cream_shop is the closest.
  ice_cream:   ["ice_cream_shop"],
}

// ─── Boolean option → A11yValue ────────────────────────────────────────────

function boolToValue(v: boolean | null | undefined): A11yValue {
  if (v === true)  return "yes"
  if (v === false) return "no"
  return "unknown"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPlace(item: any, category: Category): Place | null {
  if (!item?.displayName?.text) return null
  const loc = item.location
  if (!loc?.latitude || !loc?.longitude) return null

  const a11y  = item.accessibilityOptions ?? {}
  const addr  = item.formattedAddress ?? ""
  const types: string[] = [
    ...(Array.isArray(item.types) ? item.types : []),
    item.primaryType ?? "",
  ].filter(Boolean)
  const isVegan = types.includes("vegan_restaurant") ? true : undefined
  // vegan_restaurant implies vegetarian-friendly even when not separately listed
  const isVegetarian = isVegan === true || types.includes("vegetarian_restaurant") ? true : undefined
  // Parse address components
  const components = item.addressComponents ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getComp = (type: string) => components.find((c: any) => c.types?.includes(type))?.longText ?? ""

  const entranceVal = boolToValue(a11y.wheelchairAccessibleEntrance)
  const toiletVal   = boolToValue(a11y.wheelchairAccessibleRestroom)
  const parkingVal  = boolToValue(a11y.wheelchairAccessibleParking)
  const seatingVal  = boolToValue(a11y.wheelchairAccessibleSeating)

  const seatingDetails: SeatingDetails = { isAccessible: a11y.wheelchairAccessibleSeating ?? undefined }

  return {
    id: nanoid(),
    name:     item.displayName.text,
    category,
    address: {
      street:      getComp("route"),
      houseNumber: getComp("street_number"),
      postalCode:  String(getComp("postal_code")),
      city:        getComp("locality") || getComp("administrative_area_level_2"),
      country:     getComp("country") || "DE",
      raw:         addr,
    },
    coordinates: { lat: loc.latitude, lon: loc.longitude },
    website: item.websiteUri  ?? undefined,
    phone:   item.nationalPhoneNumber ?? undefined,
    accessibility: {
      entrance: buildAttribute("google_places", entranceVal, String(a11y.wheelchairAccessibleEntrance ?? "null"), {}),
      toilet:   buildAttribute("google_places", toiletVal,   String(a11y.wheelchairAccessibleRestroom ?? "null"), {}),
      parking:  buildAttribute("google_places", parkingVal,  String(a11y.wheelchairAccessibleParking  ?? "null"), {}),
      ...(seatingVal !== "unknown"
        ? { seating: buildAttribute("google_places", seatingVal, String(a11y.wheelchairAccessibleSeating), seatingDetails) }
        : {}),
    },
    overallConfidence: 0,
    primarySource: "google_places",
    ...(isVegetarian !== undefined ? { isVegetarianFriendly: isVegetarian } : {}),
    ...(isVegan      !== undefined ? { isVeganFriendly:      isVegan }      : {}),
    sourceRecords: [{
      sourceId:   "google_places",
      externalId: item.id ?? item.name ?? "",
      fetchedAt:  new Date().toISOString(),
      raw:        item,
    }],
  }
}

// ─── Public adapter function ───────────────────────────────────────────────

export async function fetchGooglePlaces(params: SearchParams): Promise<Place[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    console.warn("[google-places] No API key — skipping")
    return []
  }

  const FIELD_MASK = [
    "places.id",
    "places.displayName",
    "places.location",
    "places.formattedAddress",
    "places.addressComponents",
    "places.accessibilityOptions",
    "places.websiteUri",
    "places.nationalPhoneNumber",
    "places.types",
    "places.primaryType",
  ].join(",")

  const results = await Promise.all(
    params.categories.map(async (category) => {
      const body = {
        includedTypes:       CATEGORY_TYPES[category],
        maxResultCount:      20,
        locationRestriction: {
          circle: {
            center: { latitude: params.location.lat, longitude: params.location.lon },
            radius: params.radiusKm * 1000,
          },
        },
      }

      try {
        const res = await fetch(BASE_URL, {
          method:  "POST",
          headers: {
            "Content-Type":     "application/json",
            "X-Goog-Api-Key":   apiKey,
            "X-Goog-FieldMask": FIELD_MASK,
          },
          body:   JSON.stringify(body),
          signal: params.signal
            ? AbortSignal.any([params.signal, AbortSignal.timeout(15_000)])
            : AbortSignal.timeout(15_000),
        })

        if (!res.ok) {
          console.error(`[google-places] Error ${res.status} for category ${category}`)
          return [] as Place[]
        }

        const json = await res.json()
        return (json.places ?? []).flatMap((item: unknown) => {
          const place = toPlace(item, category)
          return place ? [place] : []
        }) as Place[]
      } catch {
        return [] as Place[]
      }
    }),
  )

  return results.flat()
}
