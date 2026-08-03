import { describe, it, expect } from "vitest"
import {
  evaluatePlaceJudgment,
  criterionTier,
  attrVerifiedAt,
  sourceLabelsFor,
  type JudgmentFilters,
} from "@/lib/reliability"
import { buildAttribute, emptyAttribute } from "@/lib/matching/merge"
import type { Place } from "@/lib/types"

// docs/plans/reliability-tiers.md (v13) — the two axes this module keeps
// separate: evaluatePlaceJudgment (does the place satisfy the ACTIVE
// filters?) and criterionTier (how well-corroborated is a KNOWN value?).

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "Test Place",
    category: "restaurant",
    address: { street: "", houseNumber: "", postalCode: "", city: "Berlin", country: "DE" },
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

const ALL_ACTIVE: JudgmentFilters = { entrance: true, toilet: true, parking: true, seating: true, acceptUnknown: false }
// Same three, without seating — most fixtures below omit the (optional)
// seating attribute entirely, which correctly counts as unknown; these
// constants keep that irrelevant to the assertions they're used in.
const NO_SEATING_FILTER: JudgmentFilters = { entrance: true, toilet: true, parking: true, seating: false, acceptUnknown: false }
const ENTRANCE_ONLY: JudgmentFilters = { entrance: true, toilet: false, parking: false, seating: false, acceptUnknown: false }
const NONE_ACTIVE: JudgmentFilters = { entrance: false, toilet: false, parking: false, seating: false, acceptUnknown: false }

describe("evaluatePlaceJudgment", () => {
  it("returns 'none' when no filter criteria are active", () => {
    const p = makePlace()
    expect(evaluatePlaceJudgment(p, NONE_ACTIVE).status).toBe("none")
  })

  it("returns 'pass' when every active criterion is 'yes'", () => {
    const p = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   buildAttribute("osm", "yes", "yes", {}),
        parking:  buildAttribute("osm", "yes", "yes", {}),
      },
    })
    const j = evaluatePlaceJudgment(p, NO_SEATING_FILTER)
    expect(j.status).toBe("pass")
    expect(j.limited).toEqual([])
    expect(j.unknown).toEqual([])
    expect(j.failed).toEqual([])
  })

  it("returns 'pass_limited' and names the limited criterion", () => {
    const p = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   buildAttribute("osm", "limited", "limited", {}),
        parking:  buildAttribute("osm", "yes", "yes", {}),
      },
    })
    const j = evaluatePlaceJudgment(p, NO_SEATING_FILTER)
    expect(j.status).toBe("pass_limited")
    expect(j.limited).toEqual(["toilet"])
  })

  it("returns 'unverified' when acceptUnknown lets an unknown value through", () => {
    const p = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   emptyAttribute(),
        parking:  buildAttribute("osm", "yes", "yes", {}),
      },
    })
    const j = evaluatePlaceJudgment(p, { ...NO_SEATING_FILTER, acceptUnknown: true })
    expect(j.status).toBe("unverified")
    expect(j.unknown).toEqual(["toilet"])
  })

  it("returns 'fail' when an active criterion is 'no'", () => {
    const p = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "no", "no", {}),
        toilet:   buildAttribute("osm", "yes", "yes", {}),
        parking:  buildAttribute("osm", "yes", "yes", {}),
      },
    })
    const j = evaluatePlaceJudgment(p, NO_SEATING_FILTER)
    expect(j.status).toBe("fail")
    expect(j.failed).toEqual(["entrance"])
  })

  it("returns 'fail' (not 'unverified') when an unknown value is NOT accepted", () => {
    const p = makePlace({
      accessibility: {
        entrance: emptyAttribute(),
        toilet:   buildAttribute("osm", "yes", "yes", {}),
        parking:  buildAttribute("osm", "yes", "yes", {}),
      },
    })
    const j = evaluatePlaceJudgment(p, ENTRANCE_ONLY)
    expect(j.status).toBe("fail")
    expect(j.failed).toEqual(["entrance"])
  })

  it("ignores inactive criteria entirely, even when they are 'no'", () => {
    const p = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   buildAttribute("osm", "no", "no", {}),
        parking:  buildAttribute("osm", "no", "no", {}),
      },
    })
    expect(evaluatePlaceJudgment(p, ENTRANCE_ONLY).status).toBe("pass")
  })

  it("treats a missing seating attribute the same as unknown", () => {
    const p = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   buildAttribute("osm", "yes", "yes", {}),
        parking:  buildAttribute("osm", "yes", "yes", {}),
        // seating omitted entirely
      },
    })
    const j = evaluatePlaceJudgment(p, ALL_ACTIVE)
    expect(j.status).toBe("fail")
    expect(j.failed).toEqual(["seating"])
  })

  it("fail takes priority over unverified and limited when several criteria differ", () => {
    const p = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "no", "no", {}),
        toilet:   emptyAttribute(),
        parking:  buildAttribute("osm", "limited", "limited", {}),
      },
    })
    const j = evaluatePlaceJudgment(p, { ...ALL_ACTIVE, acceptUnknown: true })
    expect(j.status).toBe("fail")
  })

  // Mirrors passesFilters' own parkingNearby sub-filter (lib/matching/merge.ts)
  // exactly — a judgement must never disagree with whether the place is
  // actually shown, including for this narrow sub-case (relevant mainly to
  // deep-linked places, which can bypass passesFilters entirely).
  describe("parkingNearby sub-filter parity with passesFilters", () => {
    const parkingFilter: JudgmentFilters = { entrance: false, toilet: false, parking: true, seating: false, acceptUnknown: false }

    it("accepts nearby-only parking when parkingNearby is not explicitly false", () => {
      const p = makePlace({
        accessibility: {
          entrance: emptyAttribute(),
          toilet:   emptyAttribute(),
          parking:  buildAttribute("osm", "yes", "yes", { nearbyOnly: true }),
        },
      })
      expect(evaluatePlaceJudgment(p, parkingFilter).status).toBe("pass")
    })

    it("fails nearby-only parking when parkingNearby is explicitly false, even though the value is 'yes'", () => {
      const p = makePlace({
        accessibility: {
          entrance: emptyAttribute(),
          toilet:   emptyAttribute(),
          parking:  buildAttribute("osm", "yes", "yes", { nearbyOnly: true }),
        },
      })
      const j = evaluatePlaceJudgment(p, { ...parkingFilter, parkingNearby: false })
      expect(j.status).toBe("fail")
      expect(j.failed).toEqual(["parking"])
    })

    it("still accepts on-site parking when parkingNearby is explicitly false", () => {
      const p = makePlace({
        accessibility: {
          entrance: emptyAttribute(),
          toilet:   emptyAttribute(),
          parking:  buildAttribute("osm", "yes", "yes", {}),
        },
      })
      expect(evaluatePlaceJudgment(p, { ...parkingFilter, parkingNearby: false }).status).toBe("pass")
    })
  })
})

describe("criterionTier", () => {
  it("returns keine for an unknown attribute", () => {
    expect(criterionTier(emptyAttribute())).toBe("keine")
  })

  it("returns keine for undefined (e.g. missing seating)", () => {
    expect(criterionTier(undefined)).toBe("keine")
  })

  it("returns gering for a single weak source", () => {
    expect(criterionTier(buildAttribute("google_places", "yes", "true", {}))).toBe("gering")
  })

  it("returns gut for a single strong source", () => {
    expect(criterionTier(buildAttribute("osm", "yes", "yes", {}))).toBe("gut")
  })

  it("returns sehr_hoch for Reisen für Alle alone", () => {
    expect(criterionTier(buildAttribute("reisen_fuer_alle", "yes", "yes", {}))).toBe("sehr_hoch")
  })
})

describe("attrVerifiedAt / sourceLabelsFor", () => {
  it("returns undefined when no source is verifiedRecently", () => {
    const attr = buildAttribute("osm", "yes", "yes", {})
    expect(attrVerifiedAt(attr)).toBeUndefined()
  })

  it("returns the verified date when a source carries it", () => {
    const attr = buildAttribute("osm", "yes", "yes", {}, 1.0, "2026-03-01", true)
    expect(attrVerifiedAt(attr)).toBe("2026-03-01")
  })

  it("returns deduplicated, ordered source labels", () => {
    const attr = buildAttribute("osm", "yes", "yes", {})
    expect(sourceLabelsFor(attr)).toEqual(["OpenStreetMap"])
  })

  it("returns an empty array for an attribute with no sources", () => {
    expect(sourceLabelsFor(emptyAttribute())).toEqual([])
    expect(sourceLabelsFor(undefined)).toEqual([])
  })
})
