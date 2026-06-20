// WCAG accessibility baseline — Phase 0 (see docs/wcag-accessibility-plan.md).
//
// Runs axe-core against rendered components to catch the STRUCTURAL subset of
// WCAG issues (accessible names, roles, ARIA validity, labels). This is a
// regression net, NOT a conformance guarantee:
//   • jsdom has no layout/paint → contrast (1.4.3), reflow (1.4.10) and focus
//     visibility (2.4.7) are NOT checked here. Those need a real browser + human
//     / assistive-technology testing.
//   • axe covers only ~30–40% of success criteria even in a real browser.
//
// As more components are made accessible (Phase 1+), add them here so violations
// can never silently regress.
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { axe } from "vitest-axe"
import { TooltipProvider } from "@/components/ui/tooltip"
import ConfidenceBadge from "@/components/results/ConfidenceBadge"
import PlaceCard from "@/components/results/PlaceCard"
import { buildAttribute } from "@/lib/matching/merge"
import type { Place } from "@/lib/types"

function renderWithProviders(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "Café Barrierefrei",
    category: "restaurant",
    address: { street: "Hauptstraße", houseNumber: "5", postalCode: "10115", city: "Berlin", country: "DE" },
    coordinates: { lat: 52.52, lon: 13.405 },
    website: "https://example.com",
    phone: "+49301234567",
    accessibility: {
      entrance: buildAttribute("osm", "yes",     "yes",     {}),
      toilet:   buildAttribute("osm", "limited", "limited", {}),
      parking:  buildAttribute("osm", "no",      "no",      {}),
    },
    overallConfidence: 0.72,
    primarySource: "osm",
    sourceRecords: [{ sourceId: "osm", externalId: "1", fetchedAt: "", raw: {} }],
    ...overrides,
  }
}

describe("a11y baseline — ConfidenceBadge", () => {
  it("has no structural axe violations", async () => {
    const { container } = renderWithProviders(<ConfidenceBadge confidence={0.85} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe("a11y baseline — PlaceCard", () => {
  it("has no structural axe violations", async () => {
    const { container } = renderWithProviders(<PlaceCard place={makePlace()} onClick={() => {}} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
