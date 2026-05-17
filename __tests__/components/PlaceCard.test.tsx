import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import PlaceCard from "@/components/results/PlaceCard"
import { TooltipProvider } from "@/components/ui/tooltip"
import { buildAttribute, emptyAttribute } from "@/lib/matching/merge"
import type { Place } from "@/lib/types"

function renderWithProvider(ui: React.ReactElement) {
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

describe("PlaceCard", () => {
  it("renders the place name", () => {
    renderWithProvider(<PlaceCard place={makePlace()} />)
    expect(screen.getByText("Café Barrierefrei")).toBeInTheDocument()
  })

  it("renders address", () => {
    renderWithProvider(<PlaceCard place={makePlace()} />)
    expect(screen.getByText(/Hauptstraße/)).toBeInTheDocument()
  })

  it("renders confidence badge", () => {
    renderWithProvider(<PlaceCard place={makePlace()} />)
    expect(screen.getByText(/72%/)).toBeInTheDocument()
  })

  it("renders all three accessibility attributes", () => {
    renderWithProvider(<PlaceCard place={makePlace()} />)
    // Uses German labels by default (de SSR default)
    expect(screen.getByText(/Eingang|Entrance/i)).toBeInTheDocument()
    expect(screen.getByText(/Toilette|Toilet/i)).toBeInTheDocument()
    expect(screen.getByText(/Parkplatz|Parking/i)).toBeInTheDocument()
  })

  it("renders website link", () => {
    renderWithProvider(<PlaceCard place={makePlace()} />)
    const link = screen.getByRole("link", { name: /website/i })
    expect(link).toHaveAttribute("href", "https://example.com")
  })

  it("calls onClick when card is clicked", () => {
    const onClick = vi.fn()
    renderWithProvider(<PlaceCard place={makePlace()} onClick={onClick} />)
    fireEvent.click(screen.getByText("Café Barrierefrei"))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("applies selected styling when isSelected", () => {
    const { container } = renderWithProvider(<PlaceCard place={makePlace()} isSelected />)
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
    renderWithProvider(<PlaceCard place={place} />)
    // Conflict source values should appear
    expect(screen.getByText(/Google Places/i)).toBeInTheDocument()
  })

  it("expanding details shows hasGrabBars + isDesignated for OSM designated toilet", () => {
    // Mirror lib/adapters/osm.ts:osmToiletDetails for toilets:wheelchair=designated
    const toilet = buildAttribute("osm", "yes", "designated", {
      isDesignated: true,
      hasGrabBars:  true,
      isInside:     true,
    })
    const place = makePlace({ accessibility: { entrance: emptyAttribute(), toilet, parking: emptyAttribute() } })

    renderWithProvider(<PlaceCard place={place} />)
    fireEvent.click(screen.getByText(/Details/))

    expect(screen.getByText(/Haltegriffe|Grab bars/i)).toBeInTheDocument()
    expect(screen.getByText(/Ausgewiesene Rollstuhl-Toilette|Designated wheelchair toilet/i)).toBeInTheDocument()
  })

  it("hides isInside (`WC im Betrieb vorhanden`) from the toilet detail list", () => {
    // isInside is the sole reason for expanding details — but we hide it.
    // Adding another field so the details panel renders at all.
    const toilet = buildAttribute("osm", "yes", "designated", {
      isDesignated: true,
      isInside:     true,
    })
    const place = makePlace({ accessibility: { entrance: emptyAttribute(), toilet, parking: emptyAttribute() } })

    renderWithProvider(<PlaceCard place={place} />)
    fireEvent.click(screen.getByText(/Details/))

    expect(screen.queryByText(/WC im Betrieb vorhanden|On-site accessible toilet/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Ausgewiesene Rollstuhl-Toilette|Designated wheelchair toilet/i)).toBeInTheDocument()
  })

  it("expanding details shows hasGrabBars when A.Cloud reports grabBars present", () => {
    // Mirror lib/adapters/accessibility-cloud.ts:toiletDetails when restrooms[0].grabBars exists
    const toilet = buildAttribute("accessibility_cloud", "yes", "a11y-cloud", {
      hasGrabBars:         true,
      grabBarsOnBothSides: true,
      grabBarsFoldable:    false,
      isInside:            true,
    })
    const place = makePlace({ accessibility: { entrance: emptyAttribute(), toilet, parking: emptyAttribute() } })

    renderWithProvider(<PlaceCard place={place} />)
    fireEvent.click(screen.getByText(/Details/))

    expect(screen.getByText(/^Haltegriffe$|^Grab bars$/i)).toBeInTheDocument()
    expect(screen.getByText(/Beidseitige Haltegriffe|Grab bars on both sides/i)).toBeInTheDocument()
  })

  it("renders Wheelmap deep-link to the OSM node when sourceRecord is OSM", () => {
    const place = makePlace({
      sourceRecords: [{ sourceId: "osm", externalId: "node/12345", fetchedAt: "", raw: {} }],
    })
    renderWithProvider(<PlaceCard place={place} />)
    const link = screen.getByRole("link", { name: /Wheelmap/i })
    expect(link).toHaveAttribute("href", "https://wheelmap.org/nodes/12345")
  })

  it("prefers place.wheelmapUrl over OSM-id constructed URL when present", () => {
    const place = makePlace({
      wheelmapUrl: "https://wheelmap.org/nodes/777?from=acloud",
      sourceRecords: [{ sourceId: "osm", externalId: "node/12345", fetchedAt: "", raw: {} }],
    })
    renderWithProvider(<PlaceCard place={place} />)
    const link = screen.getByRole("link", { name: /Wheelmap/i })
    expect(link).toHaveAttribute("href", "https://wheelmap.org/nodes/777?from=acloud")
  })

  it("falls back to coordinate-based Wheelmap link when no OSM node id", () => {
    const place = makePlace({
      sourceRecords: [{ sourceId: "google_places", externalId: "ChIJ123", fetchedAt: "", raw: {} }],
      coordinates:   { lat: 52.52, lon: 13.405 },
    })
    renderWithProvider(<PlaceCard place={place} />)
    const link = screen.getByRole("link", { name: /Wheelmap/i })
    expect(link.getAttribute("href")).toMatch(/lat=52\.52/)
    expect(link.getAttribute("href")).toMatch(/lon=13\.405/)
  })

  it("shows dog-friendly badge when allowsDogs is true", () => {
    renderWithProvider(<PlaceCard place={makePlace({ allowsDogs: true })} />)
    expect(screen.getByLabelText(/Hunde willkommen|Dogs welcome/i)).toBeInTheDocument()
  })

  it("shows no-dogs indicator when allowsDogs is false", () => {
    renderWithProvider(<PlaceCard place={makePlace({ allowsDogs: false })} />)
    expect(screen.getByLabelText(/Keine Hunde|No dogs/i)).toBeInTheDocument()
  })

  it("renders nothing dog-related when allowsDogs is undefined", () => {
    renderWithProvider(<PlaceCard place={makePlace()} />)
    expect(screen.queryByLabelText(/Hunde|Dogs/i)).not.toBeInTheDocument()
  })

  it("shows vegetarian badge when isVegetarianFriendly=true", () => {
    renderWithProvider(<PlaceCard place={makePlace({ isVegetarianFriendly: true })} />)
    expect(screen.getByLabelText(/Vegetarisch|Vegetarian/i)).toBeInTheDocument()
  })

  it("shows vegan badge when isVeganFriendly=true", () => {
    renderWithProvider(<PlaceCard place={makePlace({ isVeganFriendly: true, isVegetarianFriendly: true })} />)
    expect(screen.getByLabelText(/Vegan/i)).toBeInTheDocument()
  })

  it("renders no diet badges when both flags are undefined", () => {
    renderWithProvider(<PlaceCard place={makePlace()} />)
    expect(screen.queryByLabelText(/Vegetarisch|Vegetarian/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Vegan$/i)).not.toBeInTheDocument()
  })

  it("shows source count badge when multiple sources", () => {
    const place = makePlace({
      sourceRecords: [
        { sourceId: "osm",                externalId: "1", fetchedAt: "", raw: {} },
        { sourceId: "accessibility_cloud", externalId: "2", fetchedAt: "", raw: {} },
      ],
    })
    renderWithProvider(<PlaceCard place={place} />)
    expect(screen.getByText("+1")).toBeInTheDocument()
  })
})

describe("PlaceCard — nearby parking eye icon", () => {
  function makeNearbyParkingPlace(): Place {
    return makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   buildAttribute("osm", "yes", "yes", {}),
        parking:  {
          value:      "yes",
          confidence: 0.5,
          conflict:   false,
          sources:    [],
          details:    { nearbyOnly: true, nearbyParkingDistanceM: 80 } as Record<string, unknown>,
        },
      },
    })
  }

  it("shows eye icon when parking is auto-enriched via nearbyOnly", () => {
    const onClick = vi.fn()
    renderWithProvider(<PlaceCard place={makeNearbyParkingPlace()} onClick={onClick} />)
    expect(screen.getByRole("button", { name: /Karte|map/i })).toBeInTheDocument()
  })

  it("clicking the eye icon calls onClick", () => {
    const onClick = vi.fn()
    renderWithProvider(<PlaceCard place={makeNearbyParkingPlace()} onClick={onClick} />)
    const eyeBtn = screen.getByRole("button", { name: /Karte|map/i })
    fireEvent.click(eyeBtn)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("does NOT show eye icon for on-site yes parking (no nearbyOnly flag)", () => {
    const place = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   buildAttribute("osm", "yes", "yes", {}),
        parking:  buildAttribute("osm", "yes", "yes", {}),
      },
    })
    renderWithProvider(<PlaceCard place={place} onClick={vi.fn()} />)
    // eye button should not be present; "Auf Karte zeigen" text hint is separate
    expect(screen.queryByRole("button", { name: /Karte|map/i })).not.toBeInTheDocument()
  })

  it("does NOT show eye icon for unknown parking", () => {
    const place = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes",     "yes",     {}),
        toilet:   buildAttribute("osm", "yes",     "yes",     {}),
        parking:  buildAttribute("osm", "unknown", "unknown", {}),
      },
    })
    renderWithProvider(<PlaceCard place={place} onClick={vi.fn()} />)
    expect(screen.queryByRole("button", { name: /Karte|map/i })).not.toBeInTheDocument()
  })

  it("does NOT show eye icon when onClick is not provided (no map navigation possible)", () => {
    renderWithProvider(<PlaceCard place={makeNearbyParkingPlace()} />)
    expect(screen.queryByRole("button", { name: /Karte|map/i })).not.toBeInTheDocument()
  })

  it("shows 'Ja, in der Nähe' label for nearbyOnly parking in A11yAttribute", () => {
    renderWithProvider(<PlaceCard place={makeNearbyParkingPlace()} onClick={vi.fn()} />)
    expect(screen.getByText(/in der Nähe|nearby/i)).toBeInTheDocument()
  })
})
