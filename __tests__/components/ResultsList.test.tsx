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
