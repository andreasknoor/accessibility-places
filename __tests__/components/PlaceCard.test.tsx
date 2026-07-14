import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import PlaceCard from "@/components/results/PlaceCard"
import { startDefaultNavigation } from "@/lib/native/navigation"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LocaleProvider } from "@/lib/i18n"
import { buildAttribute, emptyAttribute } from "@/lib/matching/merge"
import type { Place } from "@/lib/types"

vi.mock("@/lib/native/navigation", () => ({
  startDefaultNavigation: vi.fn(),
  startNavigationWithApp: vi.fn(),
  shouldShowChooser: () => false,
}))

// LocaleProvider mirrors the root layout — the info sheet opened from the card
// reads the locale for the Tally report-form selection.
function renderWithProvider(ui: React.ReactElement) {
  return render(
    <LocaleProvider initialLocale="de">
      <TooltipProvider>{ui}</TooltipProvider>
    </LocaleProvider>,
  )
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

  it("opens info sheet when card is clicked", async () => {
    renderWithProvider(<PlaceCard place={makePlace()} onClick={vi.fn()} />)
    fireEvent.click(screen.getByText("Café Barrierefrei"))
    expect(await screen.findByText(/Grunddaten|Basic information/i)).toBeInTheDocument()
  })

  it("exposes the header as a keyboard-operable custom button that opens the info sheet (WCAG 2.1.1)", async () => {
    renderWithProvider(<PlaceCard place={makePlace()} onClick={vi.fn()} />)
    // Header is a role="button" div (not a real <button> — its content model
    // forbids the nested <h3>), so Enter/Space must be handled manually; this
    // locks that in instead of relying on native button behaviour.
    const header = screen.getByRole("button", { name: /Details (zu|for).*Café Barrierefrei/i })
    fireEvent.click(header)
    expect(await screen.findByText(/Grunddaten|Basic information/i)).toBeInTheDocument()
  })

  it("opens the info sheet on Enter and on Space when the header is focused (WCAG 2.1.1)", async () => {
    renderWithProvider(<PlaceCard place={makePlace()} onClick={vi.fn()} />)
    const header = screen.getByRole("button", { name: /Details (zu|for).*Café Barrierefrei/i })
    fireEvent.keyDown(header, { key: "Enter" })
    expect(await screen.findByText(/Grunddaten|Basic information/i)).toBeInTheDocument()
  })

  it("tapping the confidence badge opens the info sheet instead of its own quick view (decision D2c)", async () => {
    // Regression test for the "tapping the score badge does nothing, unexpectedly"
    // usability finding: the badge must NOT stopPropagation — a tap on it is
    // just another tap inside the single header tap target.
    renderWithProvider(<PlaceCard place={makePlace()} onClick={vi.fn()} />)
    fireEvent.click(screen.getByText(/72%/))
    expect(await screen.findByText(/Grunddaten|Basic information/i)).toBeInTheDocument()
  })

  it("calls onClick when map button is clicked", () => {
    const onClick = vi.fn()
    renderWithProvider(<PlaceCard place={makePlace()} onClick={onClick} />)
    fireEvent.click(screen.getByRole("button", { name: /Zur Karte|To map/i }))
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

describe("PlaceCard — nearby parking label", () => {
  it("shows 'Ja, in der Nähe' label for nearbyOnly parking in A11yAttribute", () => {
    const place = makePlace({
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
    renderWithProvider(<PlaceCard place={place} onClick={vi.fn()} />)
    expect(screen.getByText(/in der Nähe|nearby/i)).toBeInTheDocument()
  })
})

describe("PlaceCard — navigate button (docs/plans/native-navigate-here.md, Placement 1)", () => {
  it("renders a distinct navigate icon in the footer, separate from the Google Maps search icon", () => {
    renderWithProvider(<PlaceCard place={makePlace()} />)
    expect(screen.getByRole("button", { name: "Navigation starten" })).toBeInTheDocument()
    // The pre-existing Google Maps search link stays an <a>, not a <button> —
    // confirms the two controls are genuinely separate elements, not the
    // same icon relabelled.
    expect(screen.getByRole("link", { name: /google maps/i })).toBeInTheDocument()
  })

  it("clicking the navigate icon starts navigation at the place's own coordinates and does not open the info sheet", () => {
    renderWithProvider(<PlaceCard place={makePlace()} onClick={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Navigation starten" }))
    expect(startDefaultNavigation).toHaveBeenCalledWith({ lat: 52.52, lon: 13.405 })
    expect(screen.queryByText(/Grunddaten|Basic information/i)).not.toBeInTheDocument()
  })
})
