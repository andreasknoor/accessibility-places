import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import PlaceCard from "@/components/results/PlaceCard"
import { startDefaultNavigation } from "@/lib/native/navigation"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LocaleProvider } from "@/lib/i18n"
import { buildAttribute, emptyAttribute } from "@/lib/matching/merge"
import type { Place, SearchFilters } from "@/lib/types"

const FILTERS: SearchFilters = {
  entrance: true, toilet: true, parking: false, parkingNearby: true, seating: false,
  onlyVerified: false, acceptUnknown: false, alwaysShowParking: false, alwaysShowToilets: false, openNowOnly: false,
}

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

// Unified place UI result card (see CLAUDE.md).
// The detail sheet is detected by its dialog role — its section titles are
// covered by PlaceDebugSheet's own tests.
describe("PlaceCard — content", () => {
  it("renders the place name and category", () => {
    renderWithProvider(<PlaceCard place={makePlace()} />)
    expect(screen.getByRole("heading", { name: "Café Barrierefrei" })).toBeInTheDocument()
    expect(screen.getByText("Restaurant")).toBeInTheDocument()
  })

  it("shows the distance instead of the address when a distance is known", () => {
    renderWithProvider(<PlaceCard place={makePlace()} distanceM={420} />)
    expect(screen.getByText("420 m")).toBeInTheDocument()
    expect(screen.queryByText(/Hauptstraße/)).not.toBeInTheDocument()
  })

  it("falls back to the address when no distance is known (text/city search)", () => {
    renderWithProvider(<PlaceCard place={makePlace()} />)
    expect(screen.getByText(/Hauptstraße 5 Berlin/)).toBeInTheDocument()
  })

  it("renders the judgement line against the active filters, naming the count", () => {
    renderWithProvider(<PlaceCard place={makePlace()} filters={FILTERS} />)
    expect(screen.getByText("deine 2 Kriterien")).toBeInTheDocument()
    expect(screen.getByText("Mit Einschränkung: Toilette.")).toBeInTheDocument()
  })

  it("drops the judgement note when it would only repeat a clean pass", () => {
    const place = makePlace({ accessibility: { entrance: buildAttribute("osm", "yes", "yes", {}), toilet: buildAttribute("osm", "yes", "yes", {}), parking: emptyAttribute() } })
    renderWithProvider(<PlaceCard place={place} filters={FILTERS} />)
    expect(screen.queryByText("Alle geprüften Kriterien uneingeschränkt.")).not.toBeInTheDocument()
  })

  it("renders the criteria count as plain text, not a link, on the card itself", () => {
    renderWithProvider(<PlaceCard place={makePlace()} filters={FILTERS} />)
    expect(screen.queryByRole("button", { name: "Aktive Kriterien anzeigen" })).not.toBeInTheDocument()
  })

  it("shows a neutral 'no criteria active' line when no filters are passed", () => {
    renderWithProvider(<PlaceCard place={makePlace()} />)
    expect(screen.getByText("Keine Kriterien aktiv")).toBeInTheDocument()
  })

  it("renders each criterion as its name with the value word below it", () => {
    renderWithProvider(<PlaceCard place={makePlace()} />)
    expect(screen.getByText("Eingang")).toBeInTheDocument()
    expect(screen.getByText("Toilette")).toBeInTheDocument()
    expect(screen.getByText("Parkplatz")).toBeInTheDocument()
    expect(screen.getByText("Ja")).toBeInTheDocument()
    expect(screen.getByText("Eingeschränkt")).toBeInTheDocument()
    expect(screen.getByText("Nein")).toBeInTheDocument()
  })

  // Seating only ever comes from Google Places (always "unsicher") — it lives
  // in the detail view, the card always lists entrance, toilet, parking.
  it("never lists seating on the card, even when the place has it", () => {
    const place = makePlace()
    place.accessibility.seating = buildAttribute("google_places", "yes", "yes", {})
    renderWithProvider(<PlaceCard place={place} />)
    expect(screen.queryByText("Rollstuhl-Sitzplatz")).not.toBeInTheDocument()
  })

  it("marks a criterion whose sources disagree", () => {
    const conflicted = buildAttribute("osm", "yes", "yes", {})
    conflicted.conflict = true
    const place = makePlace({ accessibility: { entrance: conflicted, toilet: emptyAttribute(), parking: emptyAttribute() } })
    renderWithProvider(<PlaceCard place={place} />)
    expect(screen.getByRole("img", { name: "Quellen widersprechen sich" })).toBeInTheDocument()
  })

  it("flags a weak ('unsicher') reliability tier as an exception", () => {
    const place = makePlace({ accessibility: { entrance: buildAttribute("osm", "yes", "yes", {}), toilet: buildAttribute("google_places", "yes", "yes", {}), parking: emptyAttribute() } })
    renderWithProvider(<PlaceCard place={place} />)
    expect(screen.getAllByText("Angabe unsicher")).toHaveLength(1)
  })

  it("words nearby-only parking with its distance", () => {
    const place = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   buildAttribute("osm", "yes", "yes", {}),
        parking:  { value: "yes", confidence: 0.5, conflict: false, sources: [], details: { nearbyOnly: true, nearbyParkingDistanceM: 80 } as Record<string, unknown> },
      },
    })
    renderWithProvider(<PlaceCard place={place} />)
    expect(screen.getByText("Ja, in der Nähe (80 m)")).toBeInTheDocument()
  })

  // Moved to the detail sheet by the redesign (functional change 2).
  it("no longer carries the source row, diet/dog badges or external link icons", () => {
    const place = makePlace({ allowsDogs: true, isVeganFriendly: true, gintoUrl: "https://ginto.guide/x" })
    renderWithProvider(<PlaceCard place={place} />)
    expect(screen.queryByText(/Beste Quelle/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Hunde willkommen/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Vegan/)).not.toBeInTheDocument()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })
})

describe("PlaceCard — actions", () => {
  it("offers Zur Karte (primary), Details and Route (secondary)", () => {
    renderWithProvider(<PlaceCard place={makePlace()} onClick={vi.fn()} />)
    const map = screen.getByRole("button", { name: "Zur Karte" })
    const details = screen.getByRole("button", { name: "Details zu Café Barrierefrei öffnen" })
    const route = screen.getByRole("button", { name: "Route (öffnet eine andere App)" })
    expect(map.className).toMatch(/(^|\s)bg-primary(\s|$)/)
    expect(details.className).not.toMatch(/(^|\s)bg-primary(\s|$)/)
    expect(route.className).not.toMatch(/(^|\s)bg-primary(\s|$)/)
  })

  it("omits Zur Karte when no map handler is given", () => {
    renderWithProvider(<PlaceCard place={makePlace()} />)
    expect(screen.queryByRole("button", { name: "Zur Karte" })).not.toBeInTheDocument()
  })

  it("Zur Karte calls onClick without opening the detail sheet", () => {
    const onClick = vi.fn()
    renderWithProvider(<PlaceCard place={makePlace()} onClick={onClick} />)
    fireEvent.click(screen.getByRole("button", { name: "Zur Karte" }))
    expect(onClick).toHaveBeenCalledOnce()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("the Details button opens the detail sheet", async () => {
    renderWithProvider(<PlaceCard place={makePlace()} onClick={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Details zu Café Barrierefrei öffnen" }))
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
  })

  it("a tap anywhere on the card (e.g. its name) opens the detail sheet", async () => {
    renderWithProvider(<PlaceCard place={makePlace()} onClick={vi.fn()} />)
    fireEvent.click(screen.getByText("Café Barrierefrei"))
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
  })

  it("has exactly one control labelled to open the details (no nested duplicate)", () => {
    renderWithProvider(<PlaceCard place={makePlace()} onClick={vi.fn()} />)
    expect(screen.getAllByRole("button", { name: /Details zu/ })).toHaveLength(1)
  })

  it("Route starts navigation at the place's coordinates and does not open the sheet", () => {
    renderWithProvider(<PlaceCard place={makePlace()} onClick={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Route (öffnet eine andere App)" }))
    expect(startDefaultNavigation).toHaveBeenCalledWith({ lat: 52.52, lon: 13.405 })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("applies selected styling when isSelected", () => {
    const { container } = renderWithProvider(<PlaceCard place={makePlace()} isSelected />)
    expect(container.firstChild).toHaveClass("ring-primary")
  })
})

// ─── Opening hours (issue #14) ──────────────────────────────────────────────
//
// The status itself is unit-tested in __tests__/lib/opening-hours.test.ts.
// What matters here is the product rule the user set explicitly: when nothing
// definite can be said, the card must show NO opening-hours element at all —
// no "keine Angabe", no greyed-out placeholder.
describe("PlaceCard — opening hours", () => {
  // Pinned to Monday 2026-08-17, 10:00 Europe/Berlin (08:00 UTC). Only Date is
  // faked, so the real setTimeout below still resolves. Without a fixed clock
  // these assertions flip depending on the wall-clock time the suite runs at —
  // "Mo-Fr 09:00-18:00 unknown" is only ambiguous *inside* its window.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-08-17T08:00:00Z"))
  })
  afterEach(() => { vi.useRealTimers() })

  const withHours = (opening_hours: string) =>
    makePlace({ sourceRecords: [{ sourceId: "osm", externalId: "1", fetchedAt: "", metadata: { opening_hours } }] })

  it("shows nothing when the place has no opening_hours tag", async () => {
    renderWithProvider(<PlaceCard place={makePlace()} />)
    // Wait a tick so a (hypothetical) async status load would have landed.
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(/Geöffnet|Geschlossen|Schließt in/)).not.toBeInTheDocument()
  })

  it("shows nothing when the opening_hours value is unparseable", async () => {
    renderWithProvider(<PlaceCard place={withHours("nach Vereinbarung, bitte anrufen")} />)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/Geöffnet|Geschlossen|Schließt in/)).not.toBeInTheDocument()
  })

  it("shows nothing when the value parses but is ambiguous", async () => {
    renderWithProvider(<PlaceCard place={withHours("Mo-Fr 09:00-18:00 unknown")} />)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/Geöffnet|Geschlossen|Schließt in/)).not.toBeInTheDocument()
  })

  it("renders a status for a place that is open around the clock", async () => {
    renderWithProvider(<PlaceCard place={withHours("24/7")} />)
    expect(await screen.findByText("Geöffnet")).toBeInTheDocument()
  })

  // Regression for the Google-prose misparse: a Google-only place must show
  // nothing rather than a confident (and wrong) "Geschlossen".
  it("shows nothing for a Google-only place whose hours are prose, not syntax", async () => {
    const place = makePlace({
      sourceRecords: [{
        sourceId: "google_places", externalId: "g1", fetchedAt: "",
        metadata: { regularOpeningHours: { weekdayDescriptions: ["Monday: 9:00 AM – 6:00 PM", "Sunday: Closed"] } },
      }],
    })
    renderWithProvider(<PlaceCard place={place} />)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/Geöffnet|Geschlossen|Schließt in/)).not.toBeInTheDocument()
  })
})
