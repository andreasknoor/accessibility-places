import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import ResultsList from "@/components/results/ResultsList"
import { TooltipProvider } from "@/components/ui/tooltip"
import { buildAttribute } from "@/lib/matching/merge"
import type { Place } from "@/lib/types"

vi.mock("@/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n")>()
  const de = (await import("@/lib/i18n/de")).default
  return {
    ...actual,
    useTranslations: () => de,
    useLocale: () => ({ locale: "de", setLocale: vi.fn() }),
  }
})

function makePlace(id: string, lat: number, lon: number): Place {
  return {
    id,
    name: `Place ${id}`,
    category: "cafe",
    address: { street: "Str.", houseNumber: "1", postalCode: "10115", city: "Berlin", country: "DE" },
    coordinates: { lat, lon },
    accessibility: {
      entrance: buildAttribute("osm", "yes", "yes", {}),
      toilet:   buildAttribute("osm", "yes", "yes", {}),
      parking:  buildAttribute("osm", "yes", "yes", {}),
    },
    overallConfidence: 0.8,
    primarySource: "osm",
    sourceRecords: [],
  }
}

function renderList(props: React.ComponentProps<typeof ResultsList>) {
  return render(
    <TooltipProvider>
      <ResultsList {...props} />
    </TooltipProvider>,
  )
}

// placeClose is ~200 m north, placeFar is ~2 km north
const center     = { lat: 52.52,  lon: 13.405 }
const placeFar   = makePlace("far",   52.538, 13.405)
const placeClose = makePlace("close", 52.522, 13.405)

describe("ResultsList – sort behaviour", () => {
  it("renders places in the provided order by default (confidence)", () => {
    renderList({
      places: [placeFar, placeClose],
      onSelect: vi.fn(),
      isLoading: false,
      hasSearched: true,
      searchCenter: center,
    })
    const names = screen.getAllByText(/Place /).map((el) => el.textContent)
    expect(names[0]).toContain("far")
    expect(names[1]).toContain("close")
  })

  it("reorders by distance when sortBy=distance", () => {
    renderList({
      places: [placeFar, placeClose],
      onSelect: vi.fn(),
      isLoading: false,
      hasSearched: true,
      searchCenter: center,
      sortBy: "distance",
    })
    const names = screen.getAllByText(/Place /).map((el) => el.textContent)
    expect(names[0]).toContain("close")
    expect(names[1]).toContain("far")
  })

  it("calls onSortChange with 'distance' when distance button is clicked", () => {
    const onSortChange = vi.fn()
    renderList({
      places: [placeClose, placeFar],
      onSelect: vi.fn(),
      isLoading: false,
      hasSearched: true,
      searchCenter: center,
      sortBy: "confidence",
      onSortChange,
    })
    fireEvent.click(screen.getByRole("button", { name: /Entfernung|Distance/i }))
    expect(onSortChange).toHaveBeenCalledWith("distance")
  })

  it("calls onSortChange with 'confidence' when confidence button is clicked while in distance mode", () => {
    const onSortChange = vi.fn()
    renderList({
      places: [placeClose, placeFar],
      onSelect: vi.fn(),
      isLoading: false,
      hasSearched: true,
      searchCenter: center,
      sortBy: "distance",
      onSortChange,
    })
    fireEvent.click(screen.getByRole("button", { name: /Verlässlichkeit|Confidence/i }))
    expect(onSortChange).toHaveBeenCalledWith("confidence")
  })

  it("uses uncontrolled local sort when sortBy prop is omitted", () => {
    renderList({
      places: [placeFar, placeClose],
      onSelect: vi.fn(),
      isLoading: false,
      hasSearched: true,
      searchCenter: center,
    })
    fireEvent.click(screen.getByRole("button", { name: /Entfernung|Distance/i }))
    const names = screen.getAllByText(/Place /).map((el) => el.textContent)
    expect(names[0]).toContain("close")
  })

  it("hides sort bar when searchCenter is not provided", () => {
    renderList({
      places: [placeClose],
      onSelect: vi.fn(),
      isLoading: false,
      hasSearched: true,
    })
    expect(screen.queryByRole("button", { name: /Entfernung|Distance/i })).toBeNull()
  })
})

describe("ResultsList — amenity empty state uses its own expand-radius action (finding F6a)", () => {
  it("calls onAmenityExpandRadius, never the stale venue onExpandRadius, when clicked", () => {
    const onExpandRadius = vi.fn()
    const onAmenityExpandRadius = vi.fn()
    renderList({
      places: [],
      onSelect: vi.fn(),
      isLoading: false,
      hasSearched: true,
      amenityType: "parking",
      amenityResults: [],
      onExpandRadius,
      onAmenityExpandRadius,
    })
    fireEvent.click(screen.getByText("Suchradius vergrößern?"))
    expect(onAmenityExpandRadius).toHaveBeenCalledTimes(1)
    expect(onExpandRadius).not.toHaveBeenCalled()
  })

  it("shows the expand-radius action for a first-ever amenity search with no prior venue query at all", () => {
    // Finding F6a: previously this button only appeared when a stale `lastQuery`
    // from an earlier VENUE search happened to be set — a first-time amenity
    // search with zero results had no way to expand the radius at all.
    renderList({
      places: [],
      onSelect: vi.fn(),
      isLoading: false,
      hasSearched: true,
      amenityType: "toilet",
      amenityResults: [],
      onExpandRadius: undefined,
      onAmenityExpandRadius: vi.fn(),
    })
    expect(screen.getByText("Suchradius vergrößern?")).toBeInTheDocument()
  })
})

describe("ResultsList — selectedAmenityKey highlights the matching card (map→list reverse direction)", () => {
  const spots = [
    { osmId: "node/1", lat: 52.521, lon: 13.405, amenityType: "parking" as const, tier: "strong" as const, capacity: 2 },
    { osmId: "node/2", lat: 52.522, lon: 13.405, amenityType: "parking" as const, tier: "strong" as const, capacity: 5 },
  ]

  it("marks exactly the card whose amenitySpotKey matches (and none when unset)", () => {
    const { container, rerender } = render(
      <TooltipProvider>
        <ResultsList
          places={[]}
          onSelect={vi.fn()}
          isLoading={false}
          hasSearched
          amenityType="parking"
          amenityResults={spots}
          searchCenter={center}
        />
      </TooltipProvider>,
    )
    // Nothing selected → no card carries the selection ring.
    expect(container.querySelectorAll(".ring-primary")).toHaveLength(0)

    // Selecting node/2 (as a map-marker click would) highlights exactly one card.
    rerender(
      <TooltipProvider>
        <ResultsList
          places={[]}
          onSelect={vi.fn()}
          isLoading={false}
          hasSearched
          amenityType="parking"
          amenityResults={spots}
          searchCenter={center}
          selectedAmenityKey="node/2"
        />
      </TooltipProvider>,
    )
    expect(container.querySelectorAll(".ring-primary")).toHaveLength(1)
  })
})
