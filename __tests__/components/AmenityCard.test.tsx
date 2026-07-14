import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LocaleProvider } from "@/lib/i18n"
import AmenityCard from "@/components/results/AmenityCard"
import { startDefaultNavigation } from "@/lib/native/navigation"
import type { AmenityFeature } from "@/lib/types"

vi.mock("@/lib/native/navigation", () => ({
  startDefaultNavigation: vi.fn(),
  startNavigationWithApp: vi.fn(),
  shouldShowChooser: () => false,
}))

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <LocaleProvider initialLocale="de">
      <TooltipProvider>{ui}</TooltipProvider>
    </LocaleProvider>,
  )
}

function makeSpot(overrides: Partial<AmenityFeature> = {}): AmenityFeature {
  return {
    amenityType: "parking",
    lat: 52.521,
    lon: 13.406,
    tier: "strong",
    capacity: 2,
    ...overrides,
  }
}

describe("AmenityCard — navigate button (docs/plans/native-navigate-here.md, 'AmenityCard (list) placement')", () => {
  it("renders a labelled 'Navigation starten' button in the footer (no detail sheet exists to host a sticky button instead)", () => {
    renderWithProvider(<AmenityCard spot={makeSpot()} amenityType="parking" />)
    expect(screen.getByRole("button", { name: "Navigation starten" })).toBeInTheDocument()
  })

  it("clicking it starts navigation at the amenity spot's own lat/lon, not any nearby venue's coordinates", () => {
    renderWithProvider(<AmenityCard spot={makeSpot({ lat: 48.137, lon: 11.576 })} amenityType="parking" />)
    fireEvent.click(screen.getByRole("button", { name: "Navigation starten" }))
    expect(startDefaultNavigation).toHaveBeenCalledWith({ lat: 48.137, lon: 11.576 })
  })

  it("targets the toilet's own coordinate for a venue-hosted WC, not a separate venue location", () => {
    const spot = makeSpot({
      amenityType: "toilet",
      lat: 52.5301,
      lon: 13.4102,
      tier: "strong",
      host: { kind: "venue", name: "Café Solidarität" },
    })
    renderWithProvider(<AmenityCard spot={spot} amenityType="toilet" />)
    fireEvent.click(screen.getByRole("button", { name: "Navigation starten" }))
    expect(startDefaultNavigation).toHaveBeenCalledWith({ lat: 52.5301, lon: 13.4102 })
  })

  it("does not trigger the card's onClick ('Zur Karte' selection) when the navigate button is clicked", () => {
    const onClick = vi.fn()
    renderWithProvider(<AmenityCard spot={makeSpot()} amenityType="parking" onClick={onClick} />)
    fireEvent.click(screen.getByRole("button", { name: "Navigation starten" }))
    expect(onClick).not.toHaveBeenCalled()
  })
})
