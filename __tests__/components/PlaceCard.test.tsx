import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import PlaceCard from "@/components/results/PlaceCard"
import { buildAttribute, emptyAttribute } from "@/lib/matching/merge"
import type { Place } from "@/lib/types"

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

describe("PlaceCard", () => {
  it("renders the place name", () => {
    render(<PlaceCard place={makePlace()} />)
    expect(screen.getByText("Café Barrierefrei")).toBeInTheDocument()
  })

  it("renders address", () => {
    render(<PlaceCard place={makePlace()} />)
    expect(screen.getByText(/Hauptstraße/)).toBeInTheDocument()
  })

  it("renders confidence badge", () => {
    render(<PlaceCard place={makePlace()} />)
    expect(screen.getByText(/72%/)).toBeInTheDocument()
  })

  it("renders all three accessibility attributes", () => {
    render(<PlaceCard place={makePlace()} />)
    // Uses German labels by default (de SSR default)
    expect(screen.getByText(/Eingang|Entrance/i)).toBeInTheDocument()
    expect(screen.getByText(/Toilette|Toilet/i)).toBeInTheDocument()
    expect(screen.getByText(/Parkplatz|Parking/i)).toBeInTheDocument()
  })

  it("renders website link", () => {
    render(<PlaceCard place={makePlace()} />)
    const link = screen.getByRole("link", { name: /website/i })
    expect(link).toHaveAttribute("href", "https://example.com")
  })

  it("calls onClick when card is clicked", () => {
    const onClick = vi.fn()
    render(<PlaceCard place={makePlace()} onClick={onClick} />)
    fireEvent.click(screen.getByText("Café Barrierefrei"))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("applies selected styling when isSelected", () => {
    const { container } = render(<PlaceCard place={makePlace()} isSelected />)
    expect(container.firstChild).toHaveClass("border-primary")
  })

  it("shows conflict warning icon when sources disagree", () => {
    const conflicted = buildAttribute("osm", "yes", "yes", {})
    conflicted.conflict = true
    conflicted.sources.push({
      sourceId: "google_places",
      value: "no",
      rawValue: "false",
      reliabilityWeight: 0.35,
    })
    const place = makePlace({ accessibility: { entrance: conflicted, toilet: emptyAttribute(), parking: emptyAttribute() } })
    render(<PlaceCard place={place} />)
    // Conflict source values should appear
    expect(screen.getByText(/Google Places/i)).toBeInTheDocument()
  })

  it("shows source count badge when multiple sources", () => {
    const place = makePlace({
      sourceRecords: [
        { sourceId: "osm",                externalId: "1", fetchedAt: "", raw: {} },
        { sourceId: "accessibility_cloud", externalId: "2", fetchedAt: "", raw: {} },
      ],
    })
    render(<PlaceCard place={place} />)
    expect(screen.getByText("+1")).toBeInTheDocument()
  })
})
