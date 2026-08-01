import { describe, it, expect } from "vitest"
import { buildVenuePopupHtml } from "@/lib/map/popup-content"
import { buildAttribute, emptyAttribute } from "@/lib/matching/merge"
import de from "@/lib/i18n/de"
import type { Place } from "@/lib/types"

// v13/docs/plans/reliability-tiers.md decision 5: the popup header bar now
// encodes the JUDGEMENT against active filters, not the reliability tier —
// red is retired from the map vocabulary entirely (a failing place is never
// shown at all, passesFilters already excludes it upstream).

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

describe("buildVenuePopupHtml — judgement colour", () => {
  it("uses green for a passing judgement", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: "pass" })
    expect(html).toContain("#16a34a")
    expect(html).not.toContain("#ff1744")
  })

  it("uses amber for a pass-with-caveat judgement", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: "pass_limited" })
    expect(html).toContain("#d97706")
  })

  it("uses neutral grey, never red, for unverified/fail/none", () => {
    for (const judgment of ["unverified", "fail", "none"] as const) {
      const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment })
      expect(html).toContain("#94a3b8")
      expect(html).not.toContain("#ff1744")
    }
  })

  it("shows the judgement caption, not the old score-percentage pattern, in the subline", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: "pass" })
    expect(html).toContain(de.map.judgmentPass)
    // The old subline was "<pct>% · <tier label>" — that specific pattern
    // must be gone (unrelated CSS percentages like "width:100%" are fine).
    expect(html).not.toMatch(/\d+%\s*·/)
  })
})
