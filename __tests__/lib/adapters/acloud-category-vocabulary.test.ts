// @vitest-environment node
//
// Guards the exact-match category table in lib/adapters/accessibility-cloud.ts
// against silent vocabulary drift.
//
// Background: the table replaced a chain of `.includes()` substring tests that
// mis-classified ~4.4% of all records ("public_transport" matched "pub" →
// transit stops became pubs; "barber" matched "bar" → hairdressers became
// bars) and silently dropped a further ~4.4% that had a perfectly good target
// ("bread" → bakery). Exact matching removes the collision class entirely, but
// swaps in a different failure mode: a value the table has never seen is
// dropped without comment. That is the safe direction, but it is invisible —
// which is exactly how "bread" went unnoticed while costing real records.
//
// This test makes it visible. VOCABULARY below is the live category vocabulary
// captured 2026-07-27 from 6000 records across Berlin, Munich, Cologne, Zurich,
// Vienna and Hamburg (place-infos.json, 3 km radius, limit 1000 each). Every
// value must be either mapped to a Category or explicitly listed as known and
// deliberately skipped — never merely absent.
import { describe, it, expect } from "vitest"
import { FROM_ACLOUD, ACLOUD_KNOWN_UNMAPPED } from "@/lib/adapters/accessibility-cloud"

const VOCABULARY: string[] = [
  "2nd_hand", "accommodation", "alcohol", "alternative_medicine", "archaeological_site",
  "art_gallery", "art_shop", "arts_center", "association", "atm", "attraction", "bank", "bar",
  "barber", "beautysalon", "bed_breakfast", "beverages", "bicycle_rental", "bicycle_store",
  "biergarten", "books", "bread", "bus_station", "bus_stop", "butcher", "camping",
  "car_rental", "car_sharing", "caravan_site", "chemist", "cinema", "clothes", "coffee",
  "college", "communitycentre", "company", "computers", "confectionery", "convenience_store",
  "copyshop", "court", "culture", "currencyexchange", "deli", "dentist", "department_store",
  "doctor", "drinkingwater", "driving_school", "electronics", "elevator", "embassy",
  "fastfood", "ferry", "flowers", "food", "fuel", "furniture", "garden_center", "gifts",
  "government_office", "health", "hearing_aids", "hiking", "hospital", "hostel", "hotel",
  "house", "icecream", "instruments", "insurance", "interior_decoration", "jewelry",
  "kindergarten", "kiosk", "laundry", "lawyer", "leisure", "library", "mall", "massage",
  "medical_store", "memorial", "mobile_phones", "museum", "nightclub", "official",
  "ophthalmologist", "organic_food", "other", "park", "parking", "pet_store", "pharmacy",
  "photography", "place_of_worship", "platform", "playground", "police", "post_office", "pub",
  "public_art", "public_transport", "restaurant", "school", "shoes", "shopping",
  "social_facility", "sports_center", "sports_shop", "stationery", "stripclub",
  "subway_station", "supermarket", "swimming", "tea_shop", "textiles", "theater", "toilets",
  "tools", "tourism", "townhall", "toys", "train", "train_station", "tram_stop", "transport",
  "travel_agency", "undefined", "university", "veterinary", "video_store", "viewpoint", "zoo"
]

describe("accessibility.cloud category vocabulary", () => {
  it("accounts for every value seen live — nothing falls through unhandled", () => {
    const unhandled = VOCABULARY.filter(
      (v) => !(v in FROM_ACLOUD) && !ACLOUD_KNOWN_UNMAPPED.has(v),
    )
    expect(unhandled).toEqual([])
  })

  // A value in both tables is contradictory: the classifier checks FROM_ACLOUD
  // first, so the "deliberately skipped" entry would be dead and misleading.
  it("never lists a value as both mapped and deliberately skipped", () => {
    const both = Object.keys(FROM_ACLOUD).filter((k) => ACLOUD_KNOWN_UNMAPPED.has(k))
    expect(both).toEqual([])
  })

  // The three values that were actively mis-classified before the rewrite.
  // Regression guards: each must resolve to a real venue category or to
  // "not a venue" — never to the category its substring happened to collide with.
  it("classifies the values the substring chain used to get wrong", () => {
    expect(FROM_ACLOUD["public_transport"]).toBeUndefined()
    expect(ACLOUD_KNOWN_UNMAPPED.has("public_transport")).toBe(true)

    expect(FROM_ACLOUD["public_art"]).toBeUndefined()
    expect(ACLOUD_KNOWN_UNMAPPED.has("public_art")).toBe(true)

    expect(FROM_ACLOUD["barber"]).toBe("hairdresser")
  })

  // Values that had a valid target all along but were dropped, because the
  // substring chain only checked a differently-spelled variant.
  it("no longer drops values that have a perfectly good target", () => {
    expect(FROM_ACLOUD["bread"]).toBe("bakery")
    expect(FROM_ACLOUD["icecream"]).toBe("cafe")
    expect(FROM_ACLOUD["sports_center"]).toBe("sports_centre")
  })

  // The live sample is large but provably not exhaustive: it contained
  // "coffee" and never "cafe", yet "cafe" is a real value the fixtures use.
  // Both must map, which is why the table is a union of observed values and
  // the keys the previous implementation was written against.
  it("covers spelling variants the live sample happened to miss", () => {
    expect(FROM_ACLOUD["cafe"]).toBe("cafe")
    expect(FROM_ACLOUD["coffee"]).toBe("cafe")
  })
})
