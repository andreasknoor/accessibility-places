// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  apiOnlyCategoryFromTags, combineEntrances, descriptionFromTags, elevatorFromTags, isUsableElevatorNode,
  isVenueTags, osmVerifiedDate, stepFreeFromEntranceNode, stepFreeFromTags, surfaceNotesFromTags,
} from "@/lib/public-api/tags"
import { fieldConfidence, resolveConservative, sourceValues } from "@/lib/public-api/conflicts"
import { nearestToiletM, toiletsWithin, osmApiId } from "@/lib/public-api/toilets"
import { parseStructureResponse, buildStructureQuery, buildExtraCategoryQuery } from "@/lib/public-api/osm-extra"
import { parsePlaceId } from "@/lib/public-api/detail"
import { matchScore, nameScore } from "@/lib/public-api/lookup"
import { buildAttribute } from "@/lib/matching/merge"
import type { AccessibilityAttribute, AmenityFeature, Place } from "@/lib/types"

// ─── Tag mapping ──────────────────────────────────────────────────────────

describe("stepFreeFromTags", () => {
  it("step_count=0 → yes", () => expect(stepFreeFromTags({ step_count: "0" })).toBe("yes"))
  it("steps without ramp → no", () => expect(stepFreeFromTags({ step_count: "2" })).toBe("no"))
  it("steps with a wheelchair ramp → yes", () =>
    expect(stepFreeFromTags({ step_count: "3", "ramp:wheelchair": "yes" })).toBe("yes"))
  it("ramp alone → yes", () => expect(stepFreeFromTags({ ramp: "yes" })).toBe("yes"))
  it("never infers from wheelchair=yes on the venue", () =>
    expect(stepFreeFromTags({ wheelchair: "yes" })).toBe("unknown"))
})

describe("entrance nodes", () => {
  it("wheelchair=* on an entrance node describes that door", () => {
    expect(stepFreeFromEntranceNode({ entrance: "main", wheelchair: "yes" })).toBe("yes")
    expect(stepFreeFromEntranceNode({ entrance: "main", wheelchair: "no" })).toBe("no")
    expect(stepFreeFromEntranceNode({ entrance: "main" })).toBe("unknown")
  })
  it("one step-free entrance is enough; no only if every known entrance says no", () => {
    expect(combineEntrances(["no", "yes"])).toBe("yes")
    expect(combineEntrances(["no", "unknown"])).toBe("no")
    expect(combineEntrances([])).toBe("unknown")
  })
  it("parses the per-building structure response", () => {
    const map = parseStructureResponse([
      { type: "way", id: 1 },
      { type: "node", id: 10, tags: { entrance: "main", step_count: "0" } },
      { type: "node", id: 11, tags: { highway: "elevator" } },
      { type: "relation", id: 2 },
      { type: "node", id: 20, tags: { entrance: "yes", wheelchair: "no" } },
      { type: "node", id: 21, tags: { highway: "elevator", wheelchair: "no" } },
    ])
    expect(map.get("way/1")).toEqual({ stepFree: "yes", elevator: true })
    expect(map.get("relation/2")).toEqual({ stepFree: "no", elevator: false })
  })
  it("builds no query for nodes or malformed refs", () => {
    expect(buildStructureQuery(["node/1", "way/x"])).toBe("")
    expect(buildStructureQuery(["way/5"])).toContain("way(id:5);out ids;node(w)[entrance]")
  })
})

describe("elevator / surface / description / check_date", () => {
  it("elevator tags", () => {
    expect(elevatorFromTags({ elevator: "yes" })).toBe("yes")
    expect(elevatorFromTags({ elevator: "no" })).toBe("no")
    expect(elevatorFromTags({})).toBe("unknown")
    expect(isUsableElevatorNode({ highway: "elevator" })).toBe(true)
    expect(isUsableElevatorNode({ highway: "elevator", wheelchair: "no" })).toBe(false)
  })
  it("flags difficult surfaces", () => {
    expect(surfaceNotesFromTags({ surface: "sett" })).toBe("surface=sett (difficult for wheelchairs)")
    expect(surfaceNotesFromTags({ surface: "asphalt", smoothness: "good" })).toBe("surface=asphalt; smoothness=good")
    expect(surfaceNotesFromTags({})).toBeNull()
  })
  it("deduplicates description variants", () => {
    expect(descriptionFromTags({ "wheelchair:description": "Rampe", "wheelchair:description:de": "Rampe" })).toBe("Rampe")
  })
  it("only accepts ISO-ish check dates", () => {
    expect(osmVerifiedDate({ "check_date:wheelchair": "2025-03-01" })).toBe("2025-03-01")
    expect(osmVerifiedDate({ check_date: "last summer" })).toBeNull()
  })
})

describe("categories & venue filter", () => {
  it("recognises API-only categories", () => {
    expect(apiOnlyCategoryFromTags({ amenity: "theatre", "theatre:type": "concert_hall" })).toBe("concert_hall")
    expect(apiOnlyCategoryFromTags({ historic: "yes", castle_type: "stately" })).toBe("castle")
    expect(apiOnlyCategoryFromTags({ leisure: "park", "garden:type": "botanical" })).toBe("garden")
    expect(apiOnlyCategoryFromTags({ amenity: "arts_centre" })).toBe("arts_centre")
    expect(apiOnlyCategoryFromTags({ tourism: "museum" })).toBeUndefined()
  })
  it("drops name-search noise", () => {
    expect(isVenueTags({ tourism: "museum" })).toBe(true)
    expect(isVenueTags({ amenity: "taxi" })).toBe(false)
    expect(isVenueTags({ type: "route", route: "bus" })).toBe(false)
    expect(isVenueTags({ public_transport: "platform" })).toBe(false)
    expect(isVenueTags({ entrance: "main", wheelchair: "yes" })).toBe(false)
    expect(isVenueTags({ tourism: "information" })).toBe(false)
    expect(isVenueTags({ historic: "yes" })).toBe(false)
    expect(isVenueTags({ historic: "yes", castle_type: "stately" })).toBe(true)
  })
  it("builds extra category clauses (arts_centre comes via the gallery category)", () => {
    expect(buildExtraCategoryQuery(["arts_centre"], { lat: 52, lon: 13 }, 1)).toBe("")
    const q = buildExtraCategoryQuery(["castle", "concert_hall"], { lat: 52, lon: 13 }, 1)
    expect(q).toContain(`nwr(around:1000,52,13)["historic"~"^(castle|palace)$"]["name"];`)
    expect(q).toContain(`["theatre:type"="concert_hall"]`)
  })
})

// ─── Conflicts & confidence ───────────────────────────────────────────────

function attr(...vals: [("osm" | "ginto" | "google_places"), "yes" | "limited" | "no" | "unknown", number?][]): AccessibilityAttribute {
  const parts = vals.map(([s, v, m]) => buildAttribute(s, v, v, {}, m ?? 1))
  const sources = parts.flatMap((p) => p.sources)
  const known = sources.filter((s) => s.value !== "unknown")
  const conflict = new Set(known.map((s) => s.value)).size > 1
  // Additive evidence for the (first) known value — mirrors merge.ts closely
  // enough for tier boundaries.
  const winner = known[0]?.value ?? "unknown"
  const confidence = known.filter((s) => s.value === winner).reduce((n, s) => n + s.reliabilityWeight, 0)
  return { value: winner, confidence, conflict, sources, details: {} }
}

describe("resolveConservative", () => {
  it("returns the single known value without a conflict", () => {
    expect(resolveConservative("wheelchair", sourceValues(attr(["osm", "yes"], ["ginto", "yes"])))).toEqual({ value: "yes" })
  })
  it("picks the most conservative value and records the conflict", () => {
    const r = resolveConservative("wheelchair", sourceValues(attr(["osm", "yes"], ["ginto", "limited"])))
    expect(r.value).toBe("limited")
    expect(r.conflict).toEqual({
      field: "wheelchair", resolution: "most_conservative", resolved: "limited",
      values: [{ source: "osm", value: "yes" }, { source: "ginto", value: "limited" }],
    })
    expect(resolveConservative("x", sourceValues(attr(["osm", "limited"], ["ginto", "no"]))).value).toBe("no")
  })
  it("ignores unknown values and non-API sources", () => {
    expect(resolveConservative("x", sourceValues(attr(["osm", "unknown"], ["google_places", "no"])))).toEqual({ value: "unknown" })
  })
})

describe("fieldConfidence", () => {
  it("OSM alone → medium", () => expect(fieldConfidence(attr(["osm", "yes"]), false)).toBe("medium"))
  it("two agreeing sources → high", () => expect(fieldConfidence(attr(["osm", "yes"], ["ginto", "yes"]), false)).toBe("high"))
  it("audited Ginto entry alone → high", () =>
    expect(fieldConfidence(attr(["ginto", "yes", 1 / 0.9]), false)).toBe("high"))
  it("any conflict → low", () => expect(fieldConfidence(attr(["osm", "yes"], ["ginto", "yes"]), true)).toBe("low"))
  it("no data → low", () => expect(fieldConfidence(attr(["osm", "unknown"]), false)).toBe("low"))
})

// ─── Distance & toilets ───────────────────────────────────────────────────

const toilet = (lat: number, lon: number, extra: Partial<AmenityFeature> = {}): AmenityFeature =>
  ({ amenityType: "toilet", lat, lon, tier: "strong", host: { kind: "standalone" }, ...extra })

describe("toilet distance", () => {
  const venue = { lat: 52.5, lon: 13.4 }
  // ~0.0009° latitude ≈ 100 m
  it("returns the nearest toilet within 500 m, rounded", () => {
    const d = nearestToiletM([toilet(52.5009, 13.4), toilet(52.502, 13.4)], venue)
    expect(d).toBeGreaterThanOrEqual(99)
    expect(d).toBeLessThanOrEqual(101)
  })
  it("returns null when nothing is within 500 m", () => {
    expect(nearestToiletM([toilet(52.51, 13.4)], venue)).toBeNull()
  })
  it("excludes the venue's own toilet feature", () => {
    expect(nearestToiletM([toilet(52.5, 13.4, { osmId: "way/1" })], venue, "way/1")).toBeNull()
  })
  it("filters by radius and sorts nearest first", () => {
    const list = toiletsWithin([toilet(52.5008, 13.4, { osmId: "node/2" }), toilet(52.5003, 13.4, { osmId: "node/1", euroKey: true, fee: "no" })], venue, 100)
    expect(list.map((t) => t.id)).toEqual(["osm:node:1", "osm:node:2"])
    expect(list[0]).toMatchObject({ euro_key: true, fee: "no", wheelchair: "designated", kind: "standalone" })
    expect(toiletsWithin([toilet(52.5015, 13.4)], venue, 100)).toEqual([])
  })
})

describe("ids", () => {
  it("formats and parses OSM ids", () => {
    expect(osmApiId("way/123")).toBe("osm:way:123")
    expect(parsePlaceId("osm:way:123")).toEqual({ type: "way", id: 123 })
    expect(parsePlaceId("osm:node/5")).toEqual({ type: "node", id: 5 })
    expect(parsePlaceId("ginto:abc")).toBeNull()
    expect(parsePlaceId("osm:way:1;drop")).toBeNull()
  })
})

describe("lookup scoring", () => {
  const place = (name: string, city: string, lat = 52.5, lon = 13.4) =>
    ({ name, address: { city }, coordinates: { lat, lon } }) as unknown as Place
  it("name similarity has a containment floor", () => {
    expect(nameScore("Philharmonie", "Philharmonie")).toBe(1)
    expect(nameScore("Philharmonie", "Berliner Philharmonie")).toBeGreaterThanOrEqual(0.85)
    expect(nameScore("Philharmonie", "Technikmuseum")).toBeLessThan(0.3)
  })
  it("rewards proximity and the right city", () => {
    const anchors = [{ lat: 52.5, lon: 13.4, wide: false }]
    const q = { name: "Philharmonie", city: "Berlin", limit: 5 }
    expect(matchScore(q, place("Philharmonie", "Berlin"), anchors)).toBeCloseTo(1)
    expect(matchScore(q, place("Philharmonie", "Hamburg"), anchors)).toBeCloseTo(0.85)
    expect(matchScore(q, place("Philharmonie", "Berlin", 52.51, 13.4), anchors)).toBeCloseTo(0.75)
  })
})
