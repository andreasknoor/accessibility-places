// @vitest-environment node
//
// Regression cover for the three v11.19 Euro-key bugs. All three were the same
// shape: a decision that exists in more than one place (map markers vs. list
// cards, venue domain vs. amenity domain) implemented inline in a large
// component, so the copies drifted. These tests pin the semantics themselves;
// the components now call these helpers rather than re-deriving them.

import { describe, it, expect } from "vitest"
import {
  passesParkingSubFilters,
  passesToiletSubFilters,
  activeAmenityFilterCount,
} from "@/lib/search-ui"

const standalone = { host: { kind: "standalone" as const } }
const venue      = { host: { kind: "venue" as const } }

describe("passesToiletSubFilters", () => {
  it("passes everything when no sub-filter is active", () => {
    const off = { publicToiletsOnly: false, euroKeyOnly: false }
    expect(passesToiletSubFilters({ ...venue }, off)).toBe(true)
    expect(passesToiletSubFilters({ ...standalone, euroKey: true }, off)).toBe(true)
    expect(passesToiletSubFilters({}, off)).toBe(true)
  })

  it("euroKeyOnly keeps only spots explicitly tagged euroKey", () => {
    const opts = { publicToiletsOnly: false, euroKeyOnly: true }
    expect(passesToiletSubFilters({ ...standalone, euroKey: true }, opts)).toBe(true)
    expect(passesToiletSubFilters({ ...standalone, euroKey: false }, opts)).toBe(false)
    // The overwhelmingly common case: OSM simply has no centralkey tag at all.
    // Must be excluded, not treated as unknown-and-therefore-passing.
    expect(passesToiletSubFilters({ ...standalone }, opts)).toBe(false)
  })

  it("publicToiletsOnly keeps only standalone toilets", () => {
    const opts = { publicToiletsOnly: true, euroKeyOnly: false }
    expect(passesToiletSubFilters({ ...standalone }, opts)).toBe(true)
    expect(passesToiletSubFilters({ ...venue }, opts)).toBe(false)
    expect(passesToiletSubFilters({}, opts)).toBe(false)
  })

  it("AND-combines the two filters rather than replacing one with the other", () => {
    const both = { publicToiletsOnly: true, euroKeyOnly: true }
    expect(passesToiletSubFilters({ ...standalone, euroKey: true }, both)).toBe(true)
    expect(passesToiletSubFilters({ ...venue,      euroKey: true }, both)).toBe(false)
    expect(passesToiletSubFilters({ ...standalone, euroKey: false }, both)).toBe(false)
  })
})

describe("passesParkingSubFilters", () => {
  it("hides only the weak tier, and only when showWeakParking is off", () => {
    expect(passesParkingSubFilters({ tier: "weak" },   { showWeakParking: true  })).toBe(true)
    expect(passesParkingSubFilters({ tier: "weak" },   { showWeakParking: false })).toBe(false)
    expect(passesParkingSubFilters({ tier: "strong" }, { showWeakParking: false })).toBe(true)
    expect(passesParkingSubFilters({},                 { showWeakParking: false })).toBe(true)
  })
})

describe("activeAmenityFilterCount", () => {
  const none = { showWeakParking: true, publicToiletsOnly: false, euroKeyOnly: false }

  it("reports 0 for the default settings in both domains", () => {
    expect(activeAmenityFilterCount("parking", none)).toBe(0)
    expect(activeAmenityFilterCount("toilet",  none)).toBe(0)
  })

  it("counts each active WC filter, so the badge can reach 2", () => {
    expect(activeAmenityFilterCount("toilet", { ...none, euroKeyOnly: true })).toBe(1)
    expect(activeAmenityFilterCount("toilet", { ...none, publicToiletsOnly: true })).toBe(1)
    expect(activeAmenityFilterCount("toilet", { ...none, publicToiletsOnly: true, euroKeyOnly: true })).toBe(2)
  })

  it("inverts showWeakParking: the permissive default is not an active filter", () => {
    expect(activeAmenityFilterCount("parking", { ...none, showWeakParking: false })).toBe(1)
  })

  it("ignores the other domain's toggles", () => {
    // A WC filter left on must not inflate the parking badge, and vice versa —
    // this cross-domain leak is what the mobile badge originally got wrong.
    expect(activeAmenityFilterCount("parking", { ...none, publicToiletsOnly: true, euroKeyOnly: true })).toBe(0)
    expect(activeAmenityFilterCount("toilet",  { ...none, showWeakParking: false })).toBe(0)
  })
})
