/**
 * Google Places API (New) adapter
 * API key required: set GOOGLE_PLACES_API_KEY in .env.local
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 *
 * Uses Text Search (not Nearby Search) for the category path: Nearby ranks by
 * POPULARITY within a hard 20-result cap, which systematically buries small
 * venues in dense categories — verified live: a doctor's practice with full
 * wheelchair data was absent even from the top 20 within 1 km of its own
 * address. Text Search ranks by relevance to a localized query term and
 * surfaced the same practice at position 1. Trade-offs handled below:
 * `locationBias` is soft (results are distance-clipped to the search radius)
 * and Text Search takes no type *list* (results are post-filtered against
 * CATEGORY_TYPES).
 */
import type {
  Place,
  SearchParams,
  A11yValue,
  Category,
  SeatingDetails,
} from "../types"
import { buildAttribute } from "../matching/merge"
import { haversineMeters } from "../matching/nearby-parking"
import { nanoid } from "../utils"

const BASE_URL = "https://places.googleapis.com/v1/places:searchText"

// Localized query terms for Text Search — the term steers the relevance
// ranking, so it should name the category the way a local user would.
const CATEGORY_QUERY: Record<Category, { de: string; en: string }> = {
  cafe:        { de: "Café Eisdiele",   en: "cafe ice cream" },
  restaurant:  { de: "Restaurant",      en: "restaurant" },
  bar:         { de: "Bar",             en: "bar" },
  pub:         { de: "Kneipe",          en: "pub" },
  biergarten:  { de: "Biergarten",      en: "beer garden" },
  fast_food:   { de: "Imbiss",          en: "fast food" },
  hotel:       { de: "Hotel",           en: "hotel" },
  hostel:      { de: "Hostel",          en: "hostel" },
  apartment:   { de: "Ferienwohnung",   en: "holiday apartment" },
  museum:      { de: "Museum",          en: "museum" },
  theater:     { de: "Theater",         en: "theater" },
  cinema:      { de: "Kino",            en: "cinema" },
  library:     { de: "Bibliothek",      en: "library" },
  gallery:     { de: "Galerie",         en: "art gallery" },
  attraction:  { de: "Sehenswürdigkeit", en: "tourist attraction" },
  pharmacy:    { de: "Apotheke",        en: "pharmacy" },
  doctors:     { de: "Arzt",            en: "doctor" },
  dentist:     { de: "Zahnarzt",        en: "dentist" },
  veterinary:  { de: "Tierarzt",        en: "veterinarian" },
  hospital:    { de: "Krankenhaus",     en: "hospital" },
  chemist:     { de: "Drogerie",        en: "drugstore" },
  supermarket: { de: "Supermarkt",      en: "supermarket" },
  bakery:      { de: "Bäckerei",        en: "bakery" },
  hairdresser: { de: "Friseur",         en: "hairdresser" },
  bank:        { de: "Bank",            en: "bank" },
  post_office: { de: "Post",            en: "post office" },
  zoo:         { de: "Zoo",             en: "zoo" },
}

const CATEGORY_TYPES: Record<Category, string[]> = {
  // Merged category: ice cream parlours (no dedicated ice_cream type — ice_cream_shop
  // is the closest) live under cafe now, so a cafe search fans out to them too.
  cafe:        ["cafe", "coffee_shop", "ice_cream_shop"],
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
  pharmacy:    ["pharmacy"],
  doctors:     ["doctor", "medical_clinic"],
  dentist:     ["dentist"],
  veterinary:  ["veterinarian"],
  hospital:    ["hospital"],
  chemist:     ["drugstore"],
  supermarket: ["supermarket", "grocery_store"],
  bakery:      ["bakery"],
  hairdresser: ["hair_salon", "barber_shop"],
  bank:        ["bank"],
  post_office: ["post_office"],
  zoo:         ["zoo", "aquarium"],
}

// ─── Boolean option → A11yValue ────────────────────────────────────────────

function boolToValue(v: boolean | null | undefined): A11yValue {
  if (v === true)  return "yes"
  if (v === false) return "no"
  return "unknown"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchesCategoryTypes(item: any, category: Category): boolean {
  const types: string[] = [
    ...(Array.isArray(item?.types) ? item.types : []),
    item?.primaryType ?? "",
  ].filter(Boolean)
  if (types.length === 0) return true
  const allowed = CATEGORY_TYPES[category]
  return types.some((t) => allowed.includes(t))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPlace(item: any, category: Category): Place | null {
  if (!item?.displayName?.text) return null
  const loc = item.location
  if (!Number.isFinite(loc?.latitude) || !Number.isFinite(loc?.longitude)) return null

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

  const externalId = item.id ?? item.name ?? ""

  return {
    id: externalId ? `google_places:${externalId}` : nanoid(),
    name:     item.displayName.text,
    category,
    address: {
      street:      getComp("route"),
      houseNumber: getComp("street_number"),
      postalCode:  String(getComp("postal_code")),
      city:        getComp("locality") || getComp("administrative_area_level_2"),
      country:     getComp("country") || undefined,
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
      externalId,
      fetchedAt:  new Date().toISOString(),
      raw:        item,
      metadata:   item,
    }],
  }
}

// ─── Public adapter function ───────────────────────────────────────────────

// Google fires one POST per category. An all-categories search (16) would
// burn quota and the 3/min Google rate budget in a single request — cap the
// fan-out; categories beyond the cap are silently dropped (Google is the
// lowest-weight supplementary source, never the only one).
const GOOGLE_MAX_CATEGORIES = 3

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
    "places.photos",
  ].join(",")

  const results = await Promise.all(
    params.categories.slice(0, GOOGLE_MAX_CATEGORIES).map(async (category) => {
      // Text Search accepts only a single includedType (Nearby took a list),
      // so type scoping happens via the post-filter below instead.
      const body = {
        textQuery:    CATEGORY_QUERY[category][params.locale === "en" ? "en" : "de"],
        pageSize:     20,
        // locationBias is a soft preference, not a hard boundary (Text Search
        // only supports rectangles for locationRestriction) — out-of-radius
        // results are distance-clipped after the fetch.
        locationBias: {
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
          if (!place) return []
          // Type post-filter: the relevance query may surface adjacent trades
          // (e.g. "Arzt" → physiotherapists). Keep only results whose Google
          // types intersect the category's type set; results without any type
          // info pass (defensive — real responses always carry types).
          if (!matchesCategoryTypes(item, category)) return []
          // Distance clip: locationBias is soft, so trim results beyond the
          // actual search radius.
          const distM = haversineMeters(params.location, place.coordinates)
          if (distM > params.radiusKm * 1000) return []
          return [place]
        }) as Place[]
      } catch {
        return [] as Place[]
      }
    }),
  )

  return results.flat()
}
