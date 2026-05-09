import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import FilterPanel from "@/components/filters/FilterPanel"
import type { SearchFilters, ActiveSources } from "@/lib/types"

const DEFAULT_FILTERS: SearchFilters = {
  entrance: true, toilet: true, parking: true, seating: false, onlyVerified: false, acceptUnknown: false,
}
const DEFAULT_SOURCES: ActiveSources = {
  accessibility_cloud: true, osm: true, reisen_fuer_alle: true, ginto: true, google_places: true,
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
    expect(screen.getByLabelText(/Parkplatz|parking/i)).toBeInTheDocument()
  })

  it("shows the current radius value", () => {
    renderPanel(DEFAULT_FILTERS, DEFAULT_SOURCES, 10)
    expect(screen.getByText("10 km")).toBeInTheDocument()
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
