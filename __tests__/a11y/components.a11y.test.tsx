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
import { render, fireEvent, screen } from "@testing-library/react"
import { axe } from "vitest-axe"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LocaleProvider } from "@/lib/i18n"
import ConfidenceBadge from "@/components/results/ConfidenceBadge"
import PlaceCard from "@/components/results/PlaceCard"
import FilterPanel from "@/components/filters/FilterPanel"
import ResultsList from "@/components/results/ResultsList"
import SettingsSheet from "@/components/settings/SettingsSheet"
import { DEFAULT_APP_SETTINGS } from "@/lib/settings"
import { buildAttribute } from "@/lib/matching/merge"
import type { Place, SearchFilters, ActiveSources } from "@/lib/types"

const FILTERS: SearchFilters = {
  entrance: true, toilet: true, parking: true, parkingNearby: true, seating: false,
  onlyVerified: false, acceptUnknown: false, alwaysShowParking: false, alwaysShowToilets: false,
}
const SOURCES: ActiveSources = {
  accessibility_cloud: true, osm: true, reisen_fuer_alle: true, ginto: true, acceslibre: true, google_places: true,
}

function renderWithProviders(ui: React.ReactElement) {
  return render(<LocaleProvider><TooltipProvider>{ui}</TooltipProvider></LocaleProvider>)
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

describe("a11y baseline — FilterPanel", () => {
  it("has no structural axe violations", async () => {
    const { container } = renderWithProviders(
      <FilterPanel filters={FILTERS} sources={SOURCES} radiusKm={5}
        onFilters={() => {}} onSources={() => {}} onRadius={() => {}} />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe("a11y baseline — ResultsList", () => {
  it("has no structural axe violations (with results)", async () => {
    const { container } = renderWithProviders(
      <ResultsList places={[makePlace()]} filters={FILTERS} onSelect={() => {}}
        isLoading={false} hasSearched radiusKm={5} />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe("a11y baseline — SettingsSheet (open)", () => {
  it("has no structural axe violations", async () => {
    renderWithProviders(<SettingsSheet settings={DEFAULT_APP_SETTINGS} onUpdate={() => {}} />)
    fireEvent.click(screen.getByRole("button"))
    // Panel is portaled to document.body — scan the whole document.
    expect(await axe(document.body)).toHaveNoViolations()
  })
})
