import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { LocaleProvider } from "@/lib/i18n"
import { ScoreContent } from "@/components/results/ConfidenceBadge"
import { buildAttribute, emptyAttribute } from "@/lib/matching/merge"
import type { Place } from "@/lib/types"

// v13/docs/plans/reliability-tiers.md: the old place-wide percentage badge
// (ConfidenceBadge) and its VerifiedBadge footer icon are gone — the
// verified-on-site date now folds into the per-criterion Nachsatz (see
// A11yAttribute.test / CriterionBox.test), and the judgement axis moved to
// JudgmentLine.test. All that's left in this file is the evidence-sum
// breakdown table, now rendered only inside PlaceDebugSheet's expandable
// section.

function renderWithProvider(ui: React.ReactElement) {
  return render(<LocaleProvider initialLocale="de">{ui}</LocaleProvider>)
}

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "Test",
    category: "restaurant",
    address: { street: "", houseNumber: "", postalCode: "", city: "Berlin", country: "DE" },
    coordinates: { lat: 52.52, lon: 13.405 },
    accessibility: {
      entrance: emptyAttribute(),
      toilet:   emptyAttribute(),
      parking:  emptyAttribute(),
    },
    overallConfidence: 0.7,
    primarySource: "osm",
    sourceRecords: [],
    ...overrides,
  }
}

describe("ScoreContent (evidence-sum breakdown)", () => {
  it("shows the sehr_hoch reliability phrase for a criterion confirmed by a single top-weight source", () => {
    // Reisen für Alle alone (weight 1.0) reaches sehr_hoch on its own —
    // the phrase must not claim plurality ("multiple sources") when there's
    // only one (decision: a certified single survey can be "sehr_hoch" too).
    const place = makePlace({
      accessibility: {
        entrance: buildAttribute("reisen_fuer_alle", "yes", "yes", {}),
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
    })
    renderWithProvider(<ScoreContent place={place} />)
    expect(screen.getByText("Besonders verlässlich belegt")).toBeInTheDocument()
  })

  it("shows the evidence line with source label and weight", () => {
    const place = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
    })
    renderWithProvider(<ScoreContent place={place} />)
    expect(screen.getByText(/OpenStreetMap 0\.75 = 0\.75/)).toBeInTheDocument()
  })

  it("marks an unknown criterion with an em dash, not a tier", () => {
    const place = makePlace() // all unknown
    renderWithProvider(<ScoreContent place={place} />)
    expect(screen.queryByText(/sehr hoch|^gut$|gering/)).not.toBeInTheDocument()
    expect(screen.getAllByText("—").length).toBeGreaterThan(0)
  })

  it("sums two distinct-family sources uncapped (osm + google → sehr_hoch)", () => {
    const acloud = buildAttribute("osm", "yes", "yes", {})
    const merged = {
      ...acloud,
      confidence: 1.10,
      sources: [
        { sourceId: "osm" as const, value: "yes" as const, rawValue: "yes", reliabilityWeight: 0.75, details: {} },
        { sourceId: "google_places" as const, value: "yes" as const, rawValue: "true", reliabilityWeight: 0.35, details: {} },
      ],
    }
    const place = makePlace({
      accessibility: { entrance: merged, toilet: emptyAttribute(), parking: emptyAttribute() },
    })
    renderWithProvider(<ScoreContent place={place} />)
    expect(screen.getByText("Besonders verlässlich belegt")).toBeInTheDocument()
    expect(screen.getByText(/1\.10/)).toBeInTheDocument()
  })
})
