import { describe, it, expect } from "vitest"
import {
  buildAttribute,
  emptyAttribute,
  mergePlaces,
  passesFilters,
  passesFiltersForSource,
  confidenceTier,
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
  entrance: true, toilet: true, parking: true, parkingNearby: true, seating: false, onlyVerified: false, acceptUnknown: false, alwaysShowParking: false, alwaysShowToilets: false, openNowOnly: false,
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

  // v13/decision 4: the old toilet-specific 0.9 confidence cap (and its
  // hasGrabBars → 1.0 special case) was removed — confidence is now always
  // exactly the source's own reliability weight, regardless of toilet detail
  // richness. Detail richness isn't part of the tier model at all.
  it("confidence equals the source weight regardless of toilet detail (hasGrabBars true)", () => {
    const attr = buildAttribute("osm", "yes", "yes", { hasGrabBars: true })
    expect(attr.confidence).toBeCloseTo(RELIABILITY_WEIGHTS.osm)
  })

  it("confidence equals the source weight regardless of toilet detail (hasGrabBars false)", () => {
    const attr = buildAttribute("osm", "yes", "yes", { hasGrabBars: false })
    expect(attr.confidence).toBeCloseTo(RELIABILITY_WEIGHTS.osm)
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
  it("same-source duplicate with unknown must not erase a known value (Google duplicate entries)", () => {
    // Google carries duplicate entries of one venue with different data
    // completeness; the sparse duplicate merging in second must not wipe the
    // richer duplicate's entrance=yes (found via the Frankenthal case, #35).
    const rich = makePlace({
      id: "google_places:full",
      accessibility: {
        entrance: buildAttribute("google_places", "yes", "true", {}),
        toilet:   buildAttribute("google_places", "yes", "true", {}),
        parking:  emptyAttribute(),
      },
      sourceRecords: [{ sourceId: "google_places", externalId: "full", fetchedAt: "", raw: {} }],
    })
    const sparse = makePlace({
      id: "google_places:dupe",
      accessibility: {
        entrance: buildAttribute("google_places", "unknown", "null", {}),
        toilet:   buildAttribute("google_places", "yes", "true", {}),
        parking:  emptyAttribute(),
      },
      sourceRecords: [{ sourceId: "google_places", externalId: "dupe", fetchedAt: "", raw: {} }],
    })

    const merged = mergePlaces(rich, sparse)
    expect(merged.accessibility.entrance.value).toBe("yes")
    expect(merged.accessibility.toilet.value).toBe("yes")
  })

  it("same-source known value still replaces an unknown one (reverse order)", () => {
    const sparse = makePlace({
      id: "google_places:dupe",
      accessibility: {
        entrance: buildAttribute("google_places", "unknown", "null", {}),
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
      sourceRecords: [{ sourceId: "google_places", externalId: "dupe", fetchedAt: "", raw: {} }],
    })
    const rich = makePlace({
      id: "google_places:full",
      accessibility: {
        entrance: buildAttribute("google_places", "yes", "true", {}),
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
      sourceRecords: [{ sourceId: "google_places", externalId: "full", fetchedAt: "", raw: {} }],
    })

    const merged = mergePlaces(sparse, rich)
    expect(merged.accessibility.entrance.value).toBe("yes")
  })

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
    // osm(0.75) vs accessibility_cloud(0.50): ratio = 0.50/0.75 = 0.67 > 0.5 → conflict
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
        entrance: buildAttribute("osm", "no", "no", {}),
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
      sourceRecords: [{ sourceId: "osm", externalId: "2", fetchedAt: "", raw: {} }],
    })

    const merged = mergePlaces(a, b)
    expect(merged.accessibility.entrance.conflict).toBe(true)
    // osm (weight 0.75) wins over accessibility_cloud entrance (weight 0.50)
    expect(merged.accessibility.entrance.value).toBe("no")
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

  it("toilet confidence is NOT capped (v13/decision 4) — OSM + Google add to the full family-evidence sum", () => {
    // Was: Peter Pane Potsdam regression — OSM `toilets:wheelchair=yes` (no
    // `designated`) plus Google's bare wheelchairAccessibleRestroom flag used
    // to be capped at 0.9 pre-v13. That cap existed for a PERCENTAGE display
    // ("thin detail shouldn't claim 100%") and was retired: reliability tiers
    // are about source CORROBORATION, not detail richness, so two distinct
    // families (osm, google) now add uncapped — 0.75 + 0.35 = 1.10, "sehr_hoch".
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
    expect(merged.accessibility.toilet.confidence).toBeCloseTo(RELIABILITY_WEIGHTS.osm + RELIABILITY_WEIGHTS.google_places)
    expect(confidenceTier(merged.accessibility.toilet.confidence, merged.accessibility.toilet.conflict)).toBe("sehr_hoch")
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
    const noFilters = { entrance: false, toilet: false, parking: false, parkingNearby: true, seating: false, onlyVerified: false, acceptUnknown: false, alwaysShowParking: false }
    expect(passesFilters(p, noFilters)).toBe(true)
  })

  describe("parkingNearby sub-filter", () => {
    function placeWithNearbyParking(): Place {
      const attr = buildAttribute("osm", "yes", "yes", { nearbyOnly: true, nearbyParkingDistanceM: 180 })
      return makePlace({ accessibility: { entrance: yesAttr, toilet: yesAttr, parking: attr } })
    }
    function placeWithOnSiteParking(): Place {
      const attr = buildAttribute("osm", "yes", "yes", {})
      return makePlace({ accessibility: { entrance: yesAttr, toilet: yesAttr, parking: attr } })
    }

    it("accepts nearbyOnly parking when parkingNearby=true (default)", () => {
      expect(passesFilters(placeWithNearbyParking(), ALL_FILTERS)).toBe(true)
    })

    it("rejects nearbyOnly parking when parkingNearby=false", () => {
      expect(passesFilters(placeWithNearbyParking(), { ...ALL_FILTERS, parkingNearby: false })).toBe(false)
    })

    it("still accepts on-site parking when parkingNearby=false", () => {
      expect(passesFilters(placeWithOnSiteParking(), { ...ALL_FILTERS, parkingNearby: false })).toBe(true)
    })

    it("parkingNearby is irrelevant when the parking filter itself is off", () => {
      expect(passesFilters(placeWithNearbyParking(), { ...ALL_FILTERS, parking: false, parkingNearby: false })).toBe(true)
    })
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
        entrance: buildAttribute("osm", "yes", "yes", {}, 1.2),  // boosted → verifiedRecently
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

  it("rejects source that has no attribution at all", () => {
    const p = placeWith()
    // google_places contributed nothing → should not claim this place regardless of acceptUnknown
    expect(passesFiltersForSource(p, "google_places", ALL_FILTERS)).toBe(false)
    expect(passesFiltersForSource(p, "google_places", { ...ALL_FILTERS, acceptUnknown: true })).toBe(false)
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
    // entrance + toilet, both accessibility_cloud / 2 known attrs = that weight
    expect(finalised.overallConfidence).toBeCloseTo(RELIABILITY_WEIGHTS.accessibility_cloud)
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
        entrance: buildAttribute("accessibility_cloud", "yes", "yes", {}),
        toilet:   buildAttribute("accessibility_cloud", "yes", "yes", {}),
        parking:  buildAttribute("osm", "no", "no", {}),
      },
    })
    // All three criteria are known → score is the same regardless of filter selection.
    const scorePartial = computeFilteredConfidence(place, filtersEntranceToilet)
    const scoreAll     = computeFilteredConfidence(place, filtersAll)
    expect(scorePartial).toBeCloseTo(scoreAll)
    expect(scorePartial).toBeCloseTo(
      (RELIABILITY_WEIGHTS.accessibility_cloud + RELIABILITY_WEIGHTS.accessibility_cloud + RELIABILITY_WEIGHTS.osm) / 3,
      2,
    )
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

// ─── confidenceTier (v13, docs/plans/reliability-tiers.md) ──────────────────
// Replaces the old 3-tier confidenceLabel. Per-criterion, additive
// family-evidence sum: "sehr_hoch" ≥ 1.00, "gut" ≥ 0.70, else "gering" (or
// "keine" for 0/unknown). A conflicting runner-up caps the tier at "gut" —
// it can never read "sehr_hoch" — but never turns a lower tier into
// something even lower.

describe("confidenceTier", () => {
  it("returns keine for 0 (no known value)", () => {
    expect(confidenceTier(0)).toBe("keine")
  })

  it("returns gering below 0.70", () => {
    expect(confidenceTier(0.35)).toBe("gering")   // Google alone
    expect(confidenceTier(0.50)).toBe("gering")   // accessibility.cloud alone (decision 11: stays weak)
    expect(confidenceTier(0.69)).toBe("gering")
  })

  it("returns gut for 0.70–0.99", () => {
    expect(confidenceTier(0.70)).toBe("gut")
    expect(confidenceTier(0.75)).toBe("gut")      // OSM alone
    expect(confidenceTier(0.90)).toBe("gut")      // AccèsLibre alone
    expect(confidenceTier(0.99)).toBe("gut")
  })

  it("returns sehr_hoch for ≥ 1.00", () => {
    expect(confidenceTier(1.00)).toBe("sehr_hoch")  // Reisen für Alle alone (decision: sufficient on its own)
    expect(confidenceTier(1.10)).toBe("sehr_hoch")  // OSM + Google, uncapped (was capped pre-v13)
  })

  it("a conflict caps the tier at gut — never sehr_hoch — even when the sum alone would qualify", () => {
    expect(confidenceTier(1.65, true)).toBe("gut")
    expect(confidenceTier(1.00, true)).toBe("gut")
  })

  it("a conflict does not push a lower tier down further", () => {
    expect(confidenceTier(0.50, true)).toBe("gering")
    expect(confidenceTier(0, true)).toBe("keine")
  })
})

// ─── Family-aware evidence sum (v13) ────────────────────────────────────────
// accessibility_cloud gets its OWN family, not folded into osm (see
// SOURCE_FAMILY in lib/config.ts) — so two genuinely distinct sources ADD,
// uncapped, across every real adapter sourceId pairing used today.

describe("family-aware reliability tiers via mergePlaces", () => {
  it("Reisen für Alle alone reaches sehr_hoch", () => {
    const p = makePlace({
      accessibility: {
        entrance: buildAttribute("reisen_fuer_alle", "yes", "yes", {}),
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
    })
    expect(confidenceTier(p.accessibility.entrance.confidence, p.accessibility.entrance.conflict)).toBe("sehr_hoch")
  })

  it("accessibility.cloud alone is gering (decision 11: stays a weak source)", () => {
    const p = makePlace({
      accessibility: {
        entrance: buildAttribute("accessibility_cloud", "yes", "yes", {}),
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
    })
    expect(confidenceTier(p.accessibility.entrance.confidence, p.accessibility.entrance.conflict)).toBe("gering")
  })

  it("OSM + accessibility.cloud (distinct families) add uncapped to sehr_hoch", () => {
    const a = makePlace({
      id: "a",
      accessibility: { entrance: buildAttribute("osm", "yes", "yes", {}), toilet: emptyAttribute(), parking: emptyAttribute() },
      sourceRecords: [{ sourceId: "osm", externalId: "1", fetchedAt: "", raw: {} }],
    })
    const b = makePlace({
      id: "b",
      accessibility: { entrance: buildAttribute("accessibility_cloud", "yes", "yes", {}), toilet: emptyAttribute(), parking: emptyAttribute() },
      sourceRecords: [{ sourceId: "accessibility_cloud", externalId: "2", fetchedAt: "", raw: {} }],
    })
    const merged = mergePlaces(a, b)
    expect(merged.accessibility.entrance.confidence).toBeCloseTo(RELIABILITY_WEIGHTS.osm + RELIABILITY_WEIGHTS.accessibility_cloud)
    expect(confidenceTier(merged.accessibility.entrance.confidence, merged.accessibility.entrance.conflict)).toBe("sehr_hoch")
  })

  it("a strong conflicting minority caps an otherwise-sehr_hoch tier at gut", () => {
    // Winner "yes": osm(0.75) + ginto(0.90) = 1.65 (would be sehr_hoch alone).
    // Runner-up "no": google(0.35) + accessibility_cloud(0.50) = 0.85, which
    // is > 50% of 1.65 → conflict=true → tier capped at "gut".
    const osmYes = makePlace({
      id: "a",
      accessibility: { entrance: buildAttribute("osm", "yes", "yes", {}), toilet: emptyAttribute(), parking: emptyAttribute() },
      sourceRecords: [{ sourceId: "osm", externalId: "1", fetchedAt: "", raw: {} }],
    })
    const gintoYes = makePlace({
      id: "b",
      accessibility: { entrance: buildAttribute("ginto", "yes", "yes", {}), toilet: emptyAttribute(), parking: emptyAttribute() },
      sourceRecords: [{ sourceId: "ginto", externalId: "2", fetchedAt: "", raw: {} }],
    })
    const googleNo = makePlace({
      id: "c",
      accessibility: { entrance: buildAttribute("google_places", "no", "false", {}), toilet: emptyAttribute(), parking: emptyAttribute() },
      sourceRecords: [{ sourceId: "google_places", externalId: "3", fetchedAt: "", raw: {} }],
    })
    const acloudNo = makePlace({
      id: "d",
      accessibility: { entrance: buildAttribute("accessibility_cloud", "no", "false", {}), toilet: emptyAttribute(), parking: emptyAttribute() },
      sourceRecords: [{ sourceId: "accessibility_cloud", externalId: "4", fetchedAt: "", raw: {} }],
    })
    const merged = mergePlaces(mergePlaces(mergePlaces(osmYes, gintoYes), googleNo), acloudNo)
    expect(merged.accessibility.entrance.value).toBe("yes")
    expect(merged.accessibility.entrance.conflict).toBe(true)
    expect(merged.accessibility.entrance.confidence).toBeCloseTo(RELIABILITY_WEIGHTS.osm + RELIABILITY_WEIGHTS.ginto)
    expect(confidenceTier(merged.accessibility.entrance.confidence, merged.accessibility.entrance.conflict)).toBe("gut")
  })
})

// placeMayNotBeAccessible was retired 2026-08-02 (Option 3, "Zwei getrennte
// Fragen" concept): the separate red warning box it drove said almost
// exactly what JudgmentLine's headline already says, just a second time in
// a second element. Its "no"-only vs. "no or unknown" behaviour is now
// exercised via evaluatePlaceJudgment (lib/reliability.test.ts) instead,
// which JudgmentLine renders directly — see that file's "fail"/"unverified"
// status tests.
