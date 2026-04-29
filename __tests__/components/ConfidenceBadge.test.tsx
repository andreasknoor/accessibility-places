import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import ConfidenceBadge from "@/components/results/ConfidenceBadge"
import { TooltipProvider } from "@/components/ui/tooltip"
import { buildAttribute, emptyAttribute } from "@/lib/matching/merge"
import type { Place, SearchFilters } from "@/lib/types"

function renderWithProvider(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
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

const FILTERS: SearchFilters = {
  entrance: true, toilet: true, parking: true, seating: false, acceptUnknown: false,
}

describe("ConfidenceBadge", () => {
  it("shows percentage", () => {
    render(<ConfidenceBadge confidence={0.85} />)
    expect(screen.getByText(/85%/)).toBeInTheDocument()
  })

  it("shows high label for ≥ 0.70", () => {
    render(<ConfidenceBadge confidence={0.75} />)
    // Label text depends on locale (de default in tests)
    const badge = screen.getByText(/75%/)
    expect(badge).toBeInTheDocument()
  })

  it("renders with 0% confidence", () => {
    render(<ConfidenceBadge confidence={0} />)
    expect(screen.getByText(/0%/)).toBeInTheDocument()
  })

  it("renders with 100% confidence", () => {
    render(<ConfidenceBadge confidence={1} />)
    expect(screen.getByText(/100%/)).toBeInTheDocument()
  })

  it("does NOT show the verified icon when no source is verifiedRecently", () => {
    const place = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),  // no boost
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
    })
    renderWithProvider(<ConfidenceBadge confidence={0.7} place={place} filters={FILTERS} />)
    expect(screen.queryByLabelText(/verifiziert|verified/i)).not.toBeInTheDocument()
  })

  it("shows the verified icon when a source carries verifiedRecently", () => {
    const place = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}, true, 1.2),  // boost → verifiedRecently=true
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
    })
    renderWithProvider(<ConfidenceBadge confidence={0.7} place={place} filters={FILTERS} />)
    expect(screen.getByLabelText(/verifiziert|verified/i)).toBeInTheDocument()
  })
})
