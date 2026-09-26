import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { LocaleProvider } from "@/lib/i18n"
import SimplePlaceCard from "@/components/simple/SimplePlaceCard"
import { buildAttribute, emptyAttribute } from "@/lib/matching/merge"
import type { Place } from "@/lib/types"

vi.mock("@/lib/native/navigation", () => ({
  startDefaultNavigation: vi.fn(),
  startNavigationWithApp: vi.fn(),
  shouldShowChooser: () => false,
}))

function renderWithProvider(ui: React.ReactElement) {
  return render(<LocaleProvider initialLocale="de">{ui}</LocaleProvider>)
}

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "Café Sonnenschein",
    category: "cafe",
    address: { street: "Aachener Str.", houseNumber: "12", postalCode: "50674", city: "Köln", country: "DE" },
    coordinates: { lat: 50.93, lon: 6.93 },
    accessibility: {
      entrance: buildAttribute("osm", "yes", "yes", {}),
      toilet:   emptyAttribute(),
      parking:  emptyAttribute(),
    },
    overallConfidence: 0.8,
    primarySource: "osm",
    sourceRecords: [{ sourceId: "osm", externalId: "1", fetchedAt: "", raw: {} }],
    ...overrides,
  }
}

// Unified place UI result card (see CLAUDE.md).
describe("SimplePlaceCard", () => {
  it("renders the place name, category and distance", () => {
    renderWithProvider(<SimplePlaceCard place={makePlace()} distanceM={250} onOpen={vi.fn()} />)
    expect(screen.getByRole("heading", { name: "Café Sonnenschein" })).toBeInTheDocument()
    expect(screen.getByText(/Café & Eis/)).toBeInTheDocument()
    expect(screen.getByText(/250 m/)).toBeInTheDocument()
  })

  it("shows a plain-language entrance sentence, not a raw value/badge", () => {
    renderWithProvider(<SimplePlaceCard place={makePlace()} onOpen={vi.fn()} />)
    expect(screen.getByText("Eingang stufenlos erreichbar")).toBeInTheDocument()
  })

  it("reflects a non-yes entrance value with its own sentence", () => {
    const place = makePlace({ accessibility: { entrance: buildAttribute("osm", "limited", "limited", {}), toilet: emptyAttribute(), parking: emptyAttribute() } })
    renderWithProvider(<SimplePlaceCard place={place} onOpen={vi.fn()} />)
    expect(screen.getByText("Eingang teilweise barrierefrei")).toBeInTheDocument()
  })

  it("never renders the text glyph 'WC' as a symbol", () => {
    const place = makePlace({ accessibility: { entrance: buildAttribute("osm", "yes", "yes", {}), toilet: buildAttribute("osm", "yes", "yes", {}), parking: emptyAttribute() } })
    renderWithProvider(<SimplePlaceCard place={place} onOpen={vi.fn()} />)
    expect(screen.queryByText("WC", { exact: true })).not.toBeInTheDocument()
  })

  it("calls onOpen from the Details button", () => {
    const onOpen = vi.fn()
    renderWithProvider(<SimplePlaceCard place={makePlace()} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole("button", { name: "Details zu Café Sonnenschein öffnen" }))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it("calls onOpen when the card body (e.g. the name) is tapped", () => {
    const onOpen = vi.fn()
    renderWithProvider(<SimplePlaceCard place={makePlace()} onOpen={onOpen} />)
    fireEvent.click(screen.getByText("Café Sonnenschein"))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it("does not call onOpen when the navigate button is clicked", () => {
    const onOpen = vi.fn()
    renderWithProvider(<SimplePlaceCard place={makePlace()} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole("button", { name: "Route (öffnet eine andere App)" }))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("only one control is labelled to open details (no nested interactive duplicate)", () => {
    renderWithProvider(<SimplePlaceCard place={makePlace()} onOpen={vi.fn()} />)
    expect(screen.getAllByRole("button", { name: /Details zu/ })).toHaveLength(1)
  })

  describe("toilet line (cafe/restaurant/hotel only)", () => {
    it("shows a plain-language toilet sentence for a cafe", () => {
      const place = makePlace({ accessibility: { entrance: buildAttribute("osm", "yes", "yes", {}), toilet: buildAttribute("osm", "yes", "yes", {}), parking: emptyAttribute() } })
      renderWithProvider(<SimplePlaceCard place={place} onOpen={vi.fn()} />)
      expect(screen.getByText("WC rollstuhlgerecht")).toBeInTheDocument()
    })

    it("does not show a toilet line for a category outside the required set (e.g. doctors)", () => {
      const place = makePlace({ category: "doctors", accessibility: { entrance: buildAttribute("osm", "yes", "yes", {}), toilet: buildAttribute("osm", "yes", "yes", {}), parking: emptyAttribute() } })
      renderWithProvider(<SimplePlaceCard place={place} onOpen={vi.fn()} />)
      expect(screen.queryByText("WC rollstuhlgerecht")).not.toBeInTheDocument()
    })
  })

  describe("actions and default emphasis", () => {
    it("omits Zur Karte when no map handler is given", () => {
      renderWithProvider(<SimplePlaceCard place={makePlace()} onOpen={vi.fn()} />)
      expect(screen.queryByRole("button", { name: "Zur Karte" })).not.toBeInTheDocument()
    })

    it("Zur Karte is the primary action; Details and Route are secondary", () => {
      renderWithProvider(<SimplePlaceCard place={makePlace()} onOpen={vi.fn()} onShowOnMap={vi.fn()} />)
      expect(screen.getByRole("button", { name: "Zur Karte" }).className).toMatch(/(^|\s)bg-primary(\s|$)/)
      expect(screen.getByRole("button", { name: /Details zu/ }).className).not.toMatch(/(^|\s)bg-primary(\s|$)/)
      expect(screen.getByRole("button", { name: /^Route/ }).className).not.toMatch(/(^|\s)bg-primary(\s|$)/)
    })

    it("Zur Karte calls onShowOnMap, not onOpen", () => {
      const onOpen = vi.fn()
      const onShowOnMap = vi.fn()
      renderWithProvider(<SimplePlaceCard place={makePlace()} onOpen={onOpen} onShowOnMap={onShowOnMap} />)
      fireEvent.click(screen.getByRole("button", { name: "Zur Karte" }))
      expect(onShowOnMap).toHaveBeenCalledOnce()
      expect(onOpen).not.toHaveBeenCalled()
    })
  })
})
