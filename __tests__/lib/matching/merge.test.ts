import { describe, it, expect } from "vitest"
import {
  buildAttribute,
  emptyAttribute,
  mergePlaces,
  passesFilters,
  passesFiltersForSource,
  confidenceLabel,
  finalisePlaceConfidence,
  computeFilteredConfidence,
  countLimited,
} from "@/lib/matching/merge"
import { RELIABILITY_WEIGHTS } from "@/lib/config"
import type { Place, SearchFilters } from "@/lib/types"

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "Test Place",
    category: "restaurant",
    address: { street: "Hauptstr.", houseNumber: "1", postalCode: "10115", city: "Berlin", country: "DE" },
    coordinates: { lat: 52.52, lon: 13.405 },
    accessibility: {
      entrance: emptyAttribute(),
      toilet:   emptyAttribute(),
      parking:  emptyAttribute(),
    },
    overallConfidence: 0,
    primarySource: "osm",
    sourceRecords: [],
    ...overrides,
  }
}

const ALL_FILTERS: SearchFilters = {
  entrance: true, toilet: true, parking: true, seating: false, onlyVerified: false, acceptUnknown: false, alwaysShowParking: false,
}

// ─── buildAttribute ──────────────────────────────────────────────────────────

describe("buildAttribute", () => {
  it("creates attribute with correct value", () => {
    const attr = buildAttribute("osm", "yes", "yes", {})
    expect(attr.value).toBe("yes")
  })

  it("confidence equals reliability weight for known values", () => {
    const attr = buildAttribute("reisen_fuer_alle", "yes", "yes", {})
    expect(attr.confidence).toBeCloseTo(RELIABILITY_WEIGHTS.reisen_fuer_alle)
  })

  it("confidence is 0 for unknown", () => {
    const attr = buildAttribute("osm", "unknown", "", {})
    expect(attr.confidence).toBe(0)
  })

  it("records one source attribution", () => {
    const attr = buildAttribute("google_places", "no", "false", {})
    expect(attr.sources).toHaveLength(1)
    expect(attr.sources[0].sourceId).toBe("google_places")
    expect(attr.sources[0].value).toBe("no")
  })

  it("sets confidence to 1.0 when toilet hasGrabBars is true", () => {
    const attr = buildAttribute("osm", "yes", "yes", { hasGrabBars: true })
    expect(attr.confidence).toBe(1.0)
  })

  it("does not boost confidence when hasGrabBars is false", () => {
    const attr = buildAttribute("osm", "yes", "yes", { hasGrabBars: false })
    expect(attr.confidence).toBeCloseTo(RELIABILITY_WEIGHTS.osm)
  })

  it("applies OSM overall weight factor for entrance proxy", () => {
    const normal = buildAttribute("osm", "yes", "yes", {}, false)
    const overall = buildAttribute("osm", "yes", "yes", {}, true)
    expect(overall.confidence).toBeLessThan(normal.confidence)
  })

  it("stores details", () => {
    const details = { isLevel: true, hasRamp: false }
    const attr = buildAttribute("accessibility_cloud", "yes", "yes", details)
    expect(attr.details).toEqual(details)
  })
})

// ─── emptyAttribute ──────────────────────────────────────────────────────────

describe("emptyAttribute", () => {
  it("returns unknown value with zero confidence", () => {
    const attr = emptyAttribute()
    expect(attr.value).toBe("unknown")
    expect(attr.confidence).toBe(0)
    expect(attr.conflict).toBe(false)
    expect(attr.sources).toHaveLength(0)
  })
})

// ─── mergePlaces ─────────────────────────────────────────────────────────────

describe("mergePlaces", () => {
  it("merges two agreeing sources → higher confidence, no conflict", () => {
    const a = makePlace({
      id: "a",
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
      sourceRecords: [{ sourceId: "osm", externalId: "1", fetchedAt: "", raw: {} }],
    })
    const b = makePlace({
      id: "b",
      accessibility: {
        entrance: buildAttribute("accessibility_cloud", "yes", "yes", {}),
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
      sourceRecords: [{ sourceId: "accessibility_cloud", externalId: "2", fetchedAt: "", raw: {} }],
    })

    const merged = mergePlaces(a, b)
    expect(merged.accessibility.entrance.value).toBe("yes")
    expect(merged.accessibility.entrance.conflict).toBe(false)
    expect(merged.accessibility.entrance.sources).toHaveLength(2)
    expect(merged.overallConfidence).toBeGreaterThan(0)
  })

  it("detects conflict when sources disagree", () => {
    // osm(0.675) vs accessibility_cloud(0.70): ratio = 0.675/0.70 = 0.96 > 0.5 → conflict
    const a = makePlace({
      id: "a",
      accessibility: {
        entrance: buildAttribute("accessibility_cloud", "yes", "yes", {}),
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
      sourceRecords: [{ sourceId: "accessibility_cloud", externalId: "1", fetchedAt: "", raw: {} }],
    })
    const b = makePlace({
      id: "b",
      accessibility: {
        entrance: buildAttribute("osm", "no", "no", {}, true),  // isOsmOverall → 0.75×0.90=0.675
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
      sourceRecords: [{ sourceId: "osm", externalId: "2", fetchedAt: "", raw: {} }],
    })

    const merged = mergePlaces(a, b)
    expect(merged.accessibility.entrance.conflict).toBe(true)
    // accessibility_cloud (weight 0.70) wins over osm entrance (weight 0.675)
    expect(merged.accessibility.entrance.value).toBe("yes")
  })

  it("primarySource is most reliable source present", () => {
    const a = makePlace({
      sourceRecords: [{ sourceId: "reisen_fuer_alle", externalId: "1", fetchedAt: "", raw: {} }],
    })
    const b = makePlace({
      sourceRecords: [{ sourceId: "google_places", externalId: "2", fetchedAt: "", raw: {} }],
    })
    const merged = mergePlaces(a, b)
    expect(merged.primarySource).toBe("reisen_fuer_alle")
  })

  it("does not duplicate source records from same source", () => {
    const a = makePlace({
      sourceRecords: [{ sourceId: "osm", externalId: "1", fetchedAt: "", raw: {} }],
    })
    const b = makePlace({
      sourceRecords: [{ sourceId: "osm", externalId: "1", fetchedAt: "", raw: {} }],
    })
    // Same sourceId → should not duplicate
    const merged = mergePlaces(a, b)
    const osmRecords = merged.sourceRecords.filter((r) => r.sourceId === "osm")
    expect(osmRecords).toHaveLength(1)
  })

  it("inherits missing metadata (website, phone) from incoming", () => {
    const a = makePlace({ website: undefined, phone: undefined })
    const b = makePlace({ website: "https://example.com", phone: "+49123" })
    const merged = mergePlaces(a, b)
    expect(merged.website).toBe("https://example.com")
    expect(merged.phone).toBe("+49123")
  })

  it("toilet confidence stays capped at 0.9 when OSM (yes-only, no designated) merges with Google's bare wheelchairAccessibleRestroom flag", () => {
    // Regression: Peter Pane Potsdam — OSM `toilets:wheelchair=yes` (no
    // `designated`, no `toilets=yes`) plus Google `wheelchairAccessibleRestroom:
    // true`. Source weights sum to 1.05 → capped baseConf = 1.0. Without
    // looking at source-level details the merged details collapsed to {} and
    // the 0.9 cap was bypassed, yielding a misleading 100 %.
    const osm = makePlace({
      id: "osm",
      accessibility: {
        entrance: emptyAttribute(),
        toilet:   buildAttribute("osm", "yes", "yes", { isDesignated: undefined, hasGrabBars: undefined, isInside: undefined }),
        parking:  emptyAttribute(),
      },
      sourceRecords: [{ sourceId: "osm", externalId: "1", fetchedAt: "", raw: {} }],
    })
    const google = makePlace({
      id: "google",
      accessibility: {
        entrance: emptyAttribute(),
        toilet:   buildAttribute("google_places", "yes", "true", {}),
        parking:  emptyAttribute(),
      },
      sourceRecords: [{ sourceId: "google_places", externalId: "2", fetchedAt: "", raw: {} }],
    })

    const merged = mergePlaces(osm, google)
    expect(merged.accessibility.toilet.value).toBe("yes")
    expect(merged.accessibility.toilet.confidence).toBeLessThanOrEqual(0.9)
    expect(merged.accessibility.toilet.confidence).toBeGreaterThan(0.7)
  })

  it("merge clears dogPolicyOnly when wheelchair-data side joins", () => {
    const dogOnly = makePlace({
      id: "dog",
      allowsDogs: true,
      dogPolicyOnly: true,
      sourceRecords: [{ sourceId: "accessibility_cloud", externalId: "1", fetchedAt: "", raw: {} }],
    })
    const wheelchair = makePlace({
      id: "wm",
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
      sourceRecords: [{ sourceId: "osm", externalId: "node/1", fetchedAt: "", raw: {} }],
    })
    const merged = mergePlaces(dogOnly, wheelchair)
    expect(merged.allowsDogs).toBe(true)
    expect(merged.dogPolicyOnly).toBeUndefined()
  })

  it("diet flags propagate from incoming when existing has none", () => {
    const a = makePlace({ id: "a" })
    const b = makePlace({ id: "b", isVegetarianFriendly: true, isVeganFriendly: true })
    const merged = mergePlaces(a, b)
    expect(merged.isVegetarianFriendly).toBe(true)
    expect(merged.isVeganFriendly).toBe(true)
  })

  it("vegan=true forces vegetarian=true even after merge", () => {
    const a = makePlace({ id: "a", isVegetarianFriendly: false })
    const b = makePlace({ id: "b", isVeganFriendly: true })
    const merged = mergePlaces(a, b)
    // a's `false` was kept (existing wins for already-defined values), but
    // because vegan is now true, vegetarian gets forced back to true.
    expect(merged.isVeganFriendly).toBe(true)
    expect(merged.isVegetarianFriendly).toBe(true)
  })

  it("merge keeps allowsDogs from incoming when existing has none", () => {
    const wheelchair = makePlace({
      id: "wm",
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
      sourceRecords: [{ sourceId: "osm", externalId: "node/1", fetchedAt: "", raw: {} }],
    })
    const dogOnly = makePlace({
      id: "dog",
      allowsDogs: false,
      dogPolicyOnly: true,
      sourceRecords: [{ sourceId: "accessibility_cloud", externalId: "1", fetchedAt: "", raw: {} }],
    })
    const merged = mergePlaces(wheelchair, dogOnly)
    expect(merged.allowsDogs).toBe(false)
    expect(merged.dogPolicyOnly).toBeUndefined()
  })

  it("does not overwrite existing metadata", () => {
    const a = makePlace({ website: "https://original.com" })
    const b = makePlace({ website: "https://new.com" })
    const merged = mergePlaces(a, b)
    expect(merged.website).toBe("https://original.com")
  })
})

// ─── passesFilters ───────────────────────────────────────────────────────────

describe("passesFilters", () => {
  const yesAttr  = buildAttribute("osm", "yes",     "yes",     {})
  const noAttr   = buildAttribute("osm", "no",      "no",      {})
  const limAttr  = buildAttribute("osm", "limited", "limited", {})
  const unknAttr = emptyAttribute()

  function place(entrance = unknAttr, toilet = unknAttr, parking = unknAttr): Place {
    return makePlace({ accessibility: { entrance, toilet, parking } })
  }

  it("passes when all criteria match", () => {
    const p = place(yesAttr, yesAttr, yesAttr)
    expect(passesFilters(p, ALL_FILTERS)).toBe(true)
  })

  it("passes with limited when filter is active", () => {
    const p = place(limAttr, limAttr, limAttr)
    expect(passesFilters(p, ALL_FILTERS)).toBe(true)
  })

  it("fails when entrance is 'no' and entrance filter active", () => {
    const p = place(noAttr, yesAttr, yesAttr)
    expect(passesFilters(p, ALL_FILTERS)).toBe(false)
  })

  it("fails when toilet is 'no' and toilet filter active", () => {
    const p = place(yesAttr, noAttr, yesAttr)
    expect(passesFilters(p, ALL_FILTERS)).toBe(false)
  })

  it("fails for unknown by default (acceptUnknown=false)", () => {
    const p = place(unknAttr, yesAttr, yesAttr)
    expect(passesFilters(p, ALL_FILTERS)).toBe(false)
  })

  it("passes for unknown when acceptUnknown=true", () => {
    const p = place(unknAttr, yesAttr, yesAttr)
    expect(passesFilters(p, { ...ALL_FILTERS, acceptUnknown: true })).toBe(true)
  })

  it("ignores inactive filters", () => {
    const p = place(noAttr, noAttr, noAttr)
    const noFilters = { entrance: false, toilet: false, parking: false, seating: false, onlyVerified: false, acceptUnknown: false, alwaysShowParking: false }
    expect(passesFilters(p, noFilters)).toBe(true)
  })

  it("onlyVerified rejects places without any verifiedRecently source", () => {
    const p = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),  // no boost → no verifiedRecently
        toilet:   yesAttr,
        parking:  yesAttr,
      },
    })
    expect(passesFilters(p, { ...ALL_FILTERS, onlyVerified: true })).toBe(false)
  })

  it("onlyVerified accepts places with at least one verifiedRecently source", () => {
    const p = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}, true, 1.2),  // boosted → verifiedRecently
        toilet:   yesAttr,
        parking:  yesAttr,
      },
    })
    expect(passesFilters(p, { ...ALL_FILTERS, onlyVerified: true })).toBe(true)
  })

  it("onlyVerified=false ignores verification status", () => {
    const p = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   yesAttr,
        parking:  yesAttr,
      },
    })
    expect(passesFilters(p, { ...ALL_FILTERS, onlyVerified: false })).toBe(true)
  })

  it("'no' never passes even with acceptUnknown=true", () => {
    const p = place(noAttr, yesAttr, yesAttr)
    expect(passesFilters(p, { ...ALL_FILTERS, acceptUnknown: true })).toBe(false)
  })

  describe("seating sub-filter (Bug 5: undefined was silently passing)", () => {
    const seatingFilters: SearchFilters = { ...ALL_FILTERS, seating: true }
    const seatYes = buildAttribute("google_places", "yes", "true",  { isAccessible: true })
    const seatNo  = buildAttribute("google_places", "no",  "false", { isAccessible: false })

    it("fails when seating attribute is absent and acceptUnknown=false", () => {
      const p = place(yesAttr, yesAttr, yesAttr)   // no seating attribute
      expect(passesFilters(p, seatingFilters)).toBe(false)
    })

    it("passes when seating attribute is absent and acceptUnknown=true", () => {
      const p = place(yesAttr, yesAttr, yesAttr)
      expect(passesFilters(p, { ...seatingFilters, acceptUnknown: true })).toBe(true)
    })

    it("fails when seating value is 'no'", () => {
      const p = makePlace({
        accessibility: { entrance: yesAttr, toilet: yesAttr, parking: yesAttr, seating: seatNo },
      })
      expect(passesFilters(p, seatingFilters)).toBe(false)
    })

    it("passes when seating value is 'yes'", () => {
      const p = makePlace({
        accessibility: { entrance: yesAttr, toilet: yesAttr, parking: yesAttr, seating: seatYes },
      })
      expect(passesFilters(p, seatingFilters)).toBe(true)
    })
  })
})

// ─── passesFiltersForSource ───────────────────────────────────────────────────

describe("passesFiltersForSource", () => {
  const osmYes = buildAttribute("osm", "yes", "yes", {})
  const osmNo  = buildAttribute("osm", "no",  "no",  {})

  function placeWith(entrance = osmYes, toilet = osmYes, parking = osmYes): Place {
    return makePlace({
      accessibility: { entrance, toilet, parking },
      sourceRecords: [{ sourceId: "osm", externalId: "1", fetchedAt: "", raw: {} }],
    })
  }

  it("passes when source value is yes for active criterion", () => {
    const p = placeWith()
    expect(passesFiltersForSource(p, "osm", ALL_FILTERS)).toBe(true)
  })

  it("fails when source value is no for active criterion", () => {
    const p = placeWith(osmNo, osmYes, osmYes)
    expect(passesFiltersForSource(p, "osm", ALL_FILTERS)).toBe(false)
  })

  it("treats missing source value as unknown", () => {
    const p = placeWith()
    // google_places has no contribution → value resolves to "unknown"
    expect(passesFiltersForSource(p, "google_places", ALL_FILTERS)).toBe(false)
    expect(passesFiltersForSource(p, "google_places", { ...ALL_FILTERS, acceptUnknown: true })).toBe(true)
  })

  describe("seating sub-filter (Bug 5 parity)", () => {
    it("fails when seating attribute is absent and acceptUnknown=false", () => {
      const p = placeWith()   // no seating attribute
      expect(passesFiltersForSource(p, "osm", { ...ALL_FILTERS, seating: true })).toBe(false)
    })

    it("passes when seating attribute is absent and acceptUnknown=true", () => {
      const p = placeWith()
      expect(passesFiltersForSource(p, "osm", { ...ALL_FILTERS, seating: true, acceptUnknown: true })).toBe(true)
    })

    it("fails when source seating value is 'no'", () => {
      const seatNo = buildAttribute("google_places", "no", "false", { isAccessible: false })
      const p = makePlace({
        accessibility: { entrance: osmYes, toilet: osmYes, parking: osmYes, seating: seatNo },
        sourceRecords: [{ sourceId: "google_places", externalId: "gp1", fetchedAt: "", raw: {} }],
      })
      expect(passesFiltersForSource(p, "google_places", { ...ALL_FILTERS, seating: true })).toBe(false)
    })
  })
})

// ─── finalisePlaceConfidence ──────────────────────────────────────────────────

describe("finalisePlaceConfidence", () => {
  it("computes overallConfidence for a single-source place (was always 0 before)", () => {
    const place = makePlace({
      accessibility: {
        entrance: buildAttribute("accessibility_cloud", "yes", "yes", {}),
        toilet:   buildAttribute("accessibility_cloud", "yes", "yes", {}),
        parking:  emptyAttribute(),
      },
    })
    // Adapters emit overallConfidence: 0 — finalisePlaceConfidence must fix it
    expect(place.overallConfidence).toBe(0)
    const finalised = finalisePlaceConfidence(place)
    // entrance(0.70) + toilet(0.70) / 2 known attrs = 0.70
    expect(finalised.overallConfidence).toBeCloseTo(0.70)
  })

  it("ignores unknown attributes in the average", () => {
    const place = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   emptyAttribute(),   // unknown → excluded
        parking:  emptyAttribute(),   // unknown → excluded
      },
    })
    const finalised = finalisePlaceConfidence(place)
    expect(finalised.overallConfidence).toBeCloseTo(RELIABILITY_WEIGHTS.osm)
  })

  it("returns 0 when all criteria are unknown", () => {
    const place = makePlace()
    const finalised = finalisePlaceConfidence(place)
    expect(finalised.overallConfidence).toBe(0)
  })
})

// ─── computeFilteredConfidence ────────────────────────────────────────────────

describe("computeFilteredConfidence", () => {
  const filtersEntranceToilet = { entrance: true, toilet: true, parking: false, seating: false }
  const filtersAll            = { entrance: true, toilet: true, parking: true,  seating: false }
  const filtersNone           = { entrance: false, toilet: false, parking: false, seating: false }

  it("always averages ALL known criteria regardless of active filters", () => {
    const place = makePlace({
      accessibility: {
        entrance: buildAttribute("accessibility_cloud", "yes", "yes", {}), // 0.70
        toilet:   buildAttribute("accessibility_cloud", "yes", "yes", {}), // 0.70
        parking:  buildAttribute("osm", "no", "no", {}),                  // 0.75
      },
    })
    // All three criteria are known → score is the same regardless of filter selection.
    // (0.70 + 0.70 + 0.75) / 3 ≈ 0.717
    const scorePartial = computeFilteredConfidence(place, filtersEntranceToilet)
    const scoreAll     = computeFilteredConfidence(place, filtersAll)
    expect(scorePartial).toBeCloseTo(scoreAll)
    expect(scorePartial).toBeCloseTo((0.70 + 0.70 + 0.75) / 3, 2)
  })

  it("filter selection does not affect the score — confidence reflects data quality", () => {
    // Core invariant: a place's confidence badge communicates how well-documented
    // it is, not which filters the user has toggled. Toggling filters changes
    // pass/fail (passesFilters), not how reliable the data is.
    const place = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),  // 0.75
        toilet:   buildAttribute("osm", "yes", "yes", {}),  // 0.75
        parking:  buildAttribute("google_places", "no", "no", {}), // 0.35
      },
    })
    expect(computeFilteredConfidence(place, filtersNone))
      .toBeCloseTo(computeFilteredConfidence(place, filtersAll))
    expect(computeFilteredConfidence(place, filtersEntranceToilet))
      .toBeCloseTo(computeFilteredConfidence(place, filtersAll))
  })

  it("unknown criteria are excluded from the average", () => {
    const place = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   emptyAttribute(),   // unknown → excluded
        parking:  emptyAttribute(),   // unknown → excluded
      },
    })
    const score = computeFilteredConfidence(place, filtersNone)
    expect(score).toBeCloseTo(RELIABILITY_WEIGHTS.osm)
  })

  it("returns 0 when all criteria are unknown", () => {
    const place = makePlace()
    expect(computeFilteredConfidence(place, filtersAll)).toBe(0)
  })

  it("nearby-parking enrichment raises score above 0 because all known criteria contribute", () => {
    // OSM node with entrance=yes(0.75), toilet=yes(0.75), parking=yes-nearby(0.5).
    // With only the parking filter active the old code returned 0.5 (parking only).
    // Now all three known criteria contribute: (0.75 + 0.75 + 0.5) / 3 ≈ 0.67.
    const place = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),                // 0.75
        toilet:   buildAttribute("osm", "yes", "yes", {}),                // 0.75
        parking:  { value: "yes", confidence: 0.5, conflict: false, sources: [], details: { nearbyOnly: true } },
      },
    })
    const parkingOnlyFilter = { entrance: false, toilet: false, parking: true, seating: false }
    const score = computeFilteredConfidence(place, parkingOnlyFilter)
    expect(score).toBeCloseTo((0.75 + 0.75 + 0.5) / 3, 2)
    expect(score).toBeGreaterThan(0.5)
  })
})

// ─── countLimited ────────────────────────────────────────────────────────────

describe("countLimited", () => {
  const filters = { entrance: true, toilet: true, parking: true, seating: false }

  it("returns 0 when no active criterion is limited", () => {
    const place = makePlace({
      accessibility: {
        entrance: { ...emptyAttribute(), value: "yes" },
        toilet:   { ...emptyAttribute(), value: "yes" },
        parking:  { ...emptyAttribute(), value: "unknown" },
      },
    })
    expect(countLimited(place, filters)).toBe(0)
  })

  it("counts each active criterion that is limited", () => {
    const place = makePlace({
      accessibility: {
        entrance: { ...emptyAttribute(), value: "limited" },
        toilet:   { ...emptyAttribute(), value: "limited" },
        parking:  { ...emptyAttribute(), value: "yes" },
      },
    })
    expect(countLimited(place, filters)).toBe(2)
  })

  it("ignores criteria that are not active in filters", () => {
    const place = makePlace({
      accessibility: {
        entrance: { ...emptyAttribute(), value: "limited" },
        toilet:   { ...emptyAttribute(), value: "yes" },
        parking:  { ...emptyAttribute(), value: "yes" },
      },
    })
    const entranceOnly = { entrance: true, toilet: false, parking: false, seating: false }
    expect(countLimited(place, entranceOnly)).toBe(1)
    const toiletOnly   = { entrance: false, toilet: true, parking: false, seating: false }
    expect(countLimited(place, toiletOnly)).toBe(0)
  })

  it("lower count sorts before higher count", () => {
    const allYes = makePlace({
      overallConfidence: 0.7,
      accessibility: {
        entrance: { ...emptyAttribute(), value: "yes" },
        toilet:   { ...emptyAttribute(), value: "yes" },
        parking:  { ...emptyAttribute(), value: "yes" },
      },
    })
    const oneLimited = makePlace({
      id: "p2",
      overallConfidence: 0.7,
      accessibility: {
        entrance: { ...emptyAttribute(), value: "yes" },
        toilet:   { ...emptyAttribute(), value: "limited" },
        parking:  { ...emptyAttribute(), value: "yes" },
      },
    })
    const places = [oneLimited, allYes]
    places.sort((a, b) => {
      const diff = b.overallConfidence - a.overallConfidence
      if (Math.abs(diff) >= 0.001) return diff
      return countLimited(a, filters) - countLimited(b, filters)
    })
    expect(places[0].id).toBe("p1") // allYes ranks first
  })
})

// ─── confidenceLabel ─────────────────────────────────────────────────────────

describe("confidenceLabel", () => {
  it("returns high for ≥ 0.70", () => {
    expect(confidenceLabel(0.70)).toBe("high")
    expect(confidenceLabel(1.00)).toBe("high")
    expect(confidenceLabel(0.85)).toBe("high")
  })

  it("returns medium for 0.40–0.69", () => {
    expect(confidenceLabel(0.40)).toBe("medium")
    expect(confidenceLabel(0.55)).toBe("medium")
    expect(confidenceLabel(0.69)).toBe("medium")
  })

  it("returns low for < 0.40", () => {
    expect(confidenceLabel(0.00)).toBe("low")
    expect(confidenceLabel(0.39)).toBe("low")
  })
})
