import { describe, it, expect } from "vitest"
import { buildVenuePopupHtml } from "@/lib/map/popup-content"
import { buildAttribute, emptyAttribute } from "@/lib/matching/merge"
import de from "@/lib/i18n/de"
import type { PlaceJudgment } from "@/lib/reliability"
import type { Place } from "@/lib/types"

// v13/docs/plans/reliability-tiers.md decision 5: the popup header bar now
// encodes the JUDGEMENT against active filters, not the reliability tier —
// red is retired from the map vocabulary entirely (a failing place is never
// shown at all, passesFilters already excludes it upstream).
//
// 2026-08-02 (Option 3): the popup also carries the same "why" reasoning
// JudgmentLine shows elsewhere — the separate "Achtung: evtl. nicht
// barrierefrei" box was retired in favour of this single, consistent
// concept everywhere.

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "Café Test",
    category: "cafe",
    address: { street: "", houseNumber: "", postalCode: "", city: "Berlin", country: "DE" },
    coordinates: { lat: 52.52, lon: 13.405 },
    accessibility: {
      entrance: buildAttribute("osm", "yes", "yes", {}),
      toilet:   emptyAttribute(),
      parking:  emptyAttribute(),
    },
    overallConfidence: 0.75,
    primarySource: "osm",
    sourceRecords: [],
    ...overrides,
  }
}

function makeJudgment(overrides: Partial<PlaceJudgment>): PlaceJudgment {
  return { status: "pass", limited: [], unknown: [], failed: [], verifiedFailed: false, ...overrides }
}

describe("buildVenuePopupHtml — judgement colour", () => {
  it("uses green for a passing judgement", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: makeJudgment({ status: "pass" }) })
    expect(html).toContain("#16a34a")
    expect(html).not.toContain("#ff1744")
  })

  it("uses amber for a pass-with-caveat judgement", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: makeJudgment({ status: "pass_limited", limited: ["toilet"] }) })
    expect(html).toContain("#d97706")
  })

  it("uses neutral grey, never red, for unverified/fail/none", () => {
    const cases: PlaceJudgment[] = [
      makeJudgment({ status: "unverified", unknown: ["toilet"] }),
      makeJudgment({ status: "fail", failed: ["entrance"] }),
      makeJudgment({ status: "none" }),
    ]
    for (const judgment of cases) {
      const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment })
      expect(html).toContain("#94a3b8")
      expect(html).not.toContain("#ff1744")
    }
  })

  it("shows the judgement caption, not the old score-percentage pattern, in the subline", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: makeJudgment({ status: "pass" }) })
    expect(html).toContain(de.map.judgmentPass)
    // The old subline was "<pct>% · <tier label>" — that specific pattern
    // must be gone (unrelated CSS percentages like "width:100%" are fine).
    expect(html).not.toMatch(/\d+%\s*·/)
  })
})

describe("buildVenuePopupHtml — judgement reasoning (Option 3, replaces the retired warning box)", () => {
  it("names the limited criterion for a pass-with-caveat judgement", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: makeJudgment({ status: "pass_limited", limited: ["toilet"] }) })
    expect(html).toContain(de.map.judgmentCaveat)
    expect(html).toContain(de.map.criteriaShortToilet)
  })

  it("names the unknown criterion for an unverified judgement", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: makeJudgment({ status: "unverified", unknown: ["toilet"] }) })
    expect(html).toContain(de.map.judgmentUnknown)
    expect(html).toContain(de.map.criteriaShortToilet)
  })

  it("names the failed criterion with its own distinct caption (not the generic 'no data' one)", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: makeJudgment({ status: "fail", failed: ["entrance"] }) })
    expect(html).toContain(de.map.judgmentFail)
    expect(html).toContain(de.criteria.entrance)
  })

  it("shows no caption at all when no filter criteria are active ('none')", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: makeJudgment({ status: "none" }) })
    expect(html).not.toContain(de.map.judgmentPass)
    expect(html).not.toContain(de.map.judgmentCaveat)
    expect(html).not.toContain(de.map.judgmentUnknown)
    expect(html).not.toContain(de.map.judgmentFail)
  })
})
