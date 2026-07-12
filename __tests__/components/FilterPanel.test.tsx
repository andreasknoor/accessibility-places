import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import FilterPanel from "@/components/filters/FilterPanel"
import type { SearchFilters, ActiveSources } from "@/lib/types"

// Radix's real Slider fires onValueChange continuously during a pointer drag
// (one event per pointer-move) and relies on getBoundingClientRect for its
// percentage math, which jsdom can't reproduce reliably. To test FilterPanel's
// OWN commit-vs-preview wiring (finding F3) without depending on Radix's pointer
// physics, replace it with a plain range input: onChange mirrors onValueChange
// (fired per "tick"), onMouseUp mirrors onValueCommit (fired once on release).
vi.mock("@/components/ui/slider", () => ({
  Slider: ({ value, onValueChange, onValueCommit, min, max, step, thumbAriaLabel }: {
    value: number[]
    onValueChange?: (v: number[]) => void
    onValueCommit?: (v: number[]) => void
    min?: number; max?: number; step?: number; thumbAriaLabel?: string
  }) => (
    <input
      type="range"
      aria-label={thumbAriaLabel}
      min={min}
      max={max}
      step={step}
      value={value[0]}
      onChange={(e) => onValueChange?.([Number(e.target.value)])}
      onMouseUp={() => onValueCommit?.(value)}
      data-testid="radius-slider"
    />
  ),
}))

const DEFAULT_FILTERS: SearchFilters = {
  entrance: true, toilet: true, parking: true, parkingNearby: true, seating: false,
  onlyVerified: false, acceptUnknown: false, alwaysShowParking: false, alwaysShowToilets: false,
}
const DEFAULT_SOURCES: ActiveSources = {
  accessibility_cloud: true, osm: true, reisen_fuer_alle: true, ginto: true, acceslibre: true, google_places: true,
}

function renderPanel(
  filters = DEFAULT_FILTERS,
  sources = DEFAULT_SOURCES,
  radius = 5,
  onFilters = vi.fn(),
  onSources = vi.fn(),
  onRadius  = vi.fn(),
) {
  return render(
    <FilterPanel
      filters={filters}
      sources={sources}
      radiusKm={radius}
      onFilters={onFilters}
      onSources={onSources}
      onRadius={onRadius}
    />,
  )
}

describe("FilterPanel", () => {
  it("renders the 4 visible data source checkboxes", () => {
    // reisen_fuer_alle is active but intentionally hidden from the UI (not in SOURCE_ORDER)
    renderPanel()
    expect(screen.getByLabelText(/accessibility\.cloud/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/OpenStreetMap/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Ginto/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Google Places/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Reisen für Alle/i)).not.toBeInTheDocument()
  })

  it("renders 4 criteria checkboxes", () => {
    renderPanel()
    expect(screen.getByLabelText(/Eingang|entrance/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Toilette|toilet/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Rollstuhlgerechter Parkplatz|Wheelchair-accessible parking/i)).toBeInTheDocument()
  })

  it("calls onSources when a source checkbox is toggled", () => {
    const onSources = vi.fn()
    renderPanel(DEFAULT_FILTERS, DEFAULT_SOURCES, 5, vi.fn(), onSources)
    fireEvent.click(screen.getByLabelText(/OpenStreetMap/i))
    expect(onSources).toHaveBeenCalledWith(
      expect.objectContaining({ osm: false }),
    )
  })

  it("calls onFilters when a criteria checkbox is toggled", () => {
    const onFilters = vi.fn()
    renderPanel(DEFAULT_FILTERS, DEFAULT_SOURCES, 5, onFilters)
    fireEvent.click(screen.getByLabelText(/Toilette|toilet/i))
    expect(onFilters).toHaveBeenCalledWith(
      expect.objectContaining({ toilet: false }),
    )
  })

  it("seating checkbox is unchecked by default", () => {
    renderPanel()
    const seating = screen.getByLabelText(/Sitzpl|seating/i)
    expect(seating).not.toBeChecked()
  })

  it("acceptUnknown checkbox is unchecked by default", () => {
    renderPanel()
    const cb = screen.getByLabelText(/unklar|unclear/i)
    expect(cb).not.toBeChecked()
  })
})

// Venue-search radius no longer has its own slider in FilterPanel — it's
// redundant with the dedicated control in ResultsList's header (desktop) /
// MobileLayout's header pill (mobile), both driving the same radiusKm. See
// docs/plans and the "Kann der Suchradius aus den Filtern entfernt werden?"
// removal. Only the amenity (parking/WC) radius keeps a slider here, since
// during an amenity search ResultsList's picker is gated off and this is its
// only desktop-reachable control.
describe("FilterPanel — venue-search radius has no slider (redundant with header controls)", () => {
  it("renders no radius section and no slider in venue (non-amenity) mode", () => {
    renderPanel(DEFAULT_FILTERS, DEFAULT_SOURCES, 10)
    expect(screen.queryByTestId("radius-slider")).not.toBeInTheDocument()
    expect(screen.queryByText("10 km")).not.toBeInTheDocument()
  })

  it("never calls onRadius, since there is no venue radius control to trigger it", () => {
    const onRadius = vi.fn()
    renderPanel(DEFAULT_FILTERS, DEFAULT_SOURCES, 5, vi.fn(), vi.fn(), onRadius)
    expect(onRadius).not.toHaveBeenCalled()
    expect(screen.queryByTestId("radius-slider")).not.toBeInTheDocument()
  })
})

describe("FilterPanel — amenity mode radius (finding F4: parkingRadiusKm must actually drive the search)", () => {
  function renderAmenityPanel(amenityType: "parking" | "toilet", amenityRadiusKm: number, onAmenityRadius = vi.fn(), onRadius = vi.fn()) {
    return render(
      <FilterPanel
        filters={DEFAULT_FILTERS}
        sources={DEFAULT_SOURCES}
        radiusKm={5}
        onFilters={vi.fn()}
        onSources={vi.fn()}
        onRadius={onRadius}
        amenityType={amenityType}
        amenityRadiusKm={amenityRadiusKm}
        onAmenityRadius={onAmenityRadius}
      />,
    )
  }

  it("renders a radius section and slider in amenity mode", () => {
    renderAmenityPanel("parking", 2)
    expect(screen.getByTestId("radius-slider")).toBeInTheDocument()
  })

  it("shows the current amenity radius value", () => {
    renderAmenityPanel("parking", 2)
    expect(screen.getByText("2 km")).toBeInTheDocument()
  })

  it("uses the amenity-scale slider range (0.05–25 km, matching the server cap), not the venue range (1–50 km)", () => {
    renderAmenityPanel("parking", 2)
    const slider = screen.getByTestId("radius-slider")
    expect(slider).toHaveAttribute("min", "0.05")
    expect(slider).toHaveAttribute("max", "25")
  })

  it("commits via onAmenityRadius, never onRadius, while an amenity search is active", () => {
    const onAmenityRadius = vi.fn()
    const onRadius = vi.fn()
    renderAmenityPanel("toilet", 1, onAmenityRadius, onRadius)
    const slider = screen.getByTestId("radius-slider")
    fireEvent.change(slider, { target: { value: "3" } })
    fireEvent.mouseUp(slider)
    expect(onAmenityRadius).toHaveBeenCalledWith(3)
    expect(onRadius).not.toHaveBeenCalled()
  })

  it("displays sub-1km values in metres, like the dedicated parking-radius setting used to", () => {
    renderAmenityPanel("parking", 0.3)
    expect(screen.getByText("300 m")).toBeInTheDocument()
  })

  it("does not call onAmenityRadius while dragging — only once, on release", () => {
    const onAmenityRadius = vi.fn()
    renderAmenityPanel("parking", 2, onAmenityRadius)
    const slider = screen.getByTestId("radius-slider")
    fireEvent.change(slider, { target: { value: "3" } })
    fireEvent.change(slider, { target: { value: "5" } })
    fireEvent.change(slider, { target: { value: "8" } })
    expect(onAmenityRadius).not.toHaveBeenCalled()
    fireEvent.mouseUp(slider)
    expect(onAmenityRadius).toHaveBeenCalledTimes(1)
    expect(onAmenityRadius).toHaveBeenCalledWith(8)
  })

  it("updates the displayed value live while dragging, before commit", () => {
    renderAmenityPanel("parking", 2)
    const slider = screen.getByTestId("radius-slider")
    fireEvent.change(slider, { target: { value: "6" } })
    expect(screen.getByText("6 km")).toBeInTheDocument()
  })
})
