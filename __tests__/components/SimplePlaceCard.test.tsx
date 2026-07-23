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

describe("SimplePlaceCard", () => {
  it("renders the place name and distance", () => {
    renderWithProvider(<SimplePlaceCard place={makePlace()} distanceM={240} onOpen={vi.fn()} />)
    expect(screen.getByText("Café Sonnenschein")).toBeInTheDocument()
    expect(screen.getByText("240 m")).toBeInTheDocument()
  })

  it("shows a plain-language entrance sentence, not a raw value/badge", () => {
    renderWithProvider(<SimplePlaceCard place={makePlace()} onOpen={vi.fn()} />)
    expect(screen.getByText("Eingang stufenlos erreichbar")).toBeInTheDocument()
    expect(screen.queryByText("Ja")).not.toBeInTheDocument()
  })

  it("reflects a non-yes entrance value with its own sentence", () => {
    const place = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "no", "no", {}),
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
    })
    renderWithProvider(<SimplePlaceCard place={place} onOpen={vi.fn()} />)
    expect(screen.getByText("Eingang nicht barrierefrei")).toBeInTheDocument()
  })

  it("calls onOpen when the header box is clicked", () => {
    const onOpen = vi.fn()
    renderWithProvider(<SimplePlaceCard place={makePlace()} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole("button", { name: /Café Sonnenschein/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("calls onOpen on Enter/Space when the header box is focused", () => {
    const onOpen = vi.fn()
    renderWithProvider(<SimplePlaceCard place={makePlace()} onOpen={onOpen} />)
    const box = screen.getByRole("button", { name: /Café Sonnenschein/ })
    fireEvent.keyDown(box, { key: "Enter" })
    fireEvent.keyDown(box, { key: " " })
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  // Regression: NavigateButton used to be nested INSIDE the role="button" tap
  // target (an interactive-in-interactive anti-pattern); clicking it must
  // never also fire the card's own onOpen.
  it("does not call onOpen when the navigate button is clicked", () => {
    const onOpen = vi.fn()
    renderWithProvider(<SimplePlaceCard place={makePlace()} onOpen={onOpen} />)
    const navigateButtons = screen.getAllByRole("button").filter((b) => b !== screen.getByRole("button", { name: /Café Sonnenschein/ }))
    expect(navigateButtons.length).toBeGreaterThan(0)
    fireEvent.click(navigateButtons[0])
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("only one clickable region is labelled to open details (no nested interactive duplicate)", () => {
    renderWithProvider(<SimplePlaceCard place={makePlace()} onOpen={vi.fn()} />)
    // The outer card wrapper is a plain div; only the inner header box carries
    // the "open details" accessible name.
    const openDetailBoxes = screen.getAllByRole("button", { name: /Café Sonnenschein/ })
    expect(openDetailBoxes).toHaveLength(1)
  })

  describe("onShowOnMap (highlight on map without opening detail)", () => {
    it("is not rendered when the prop is omitted", () => {
      renderWithProvider(<SimplePlaceCard place={makePlace()} onOpen={vi.fn()} />)
      expect(screen.queryByRole("button", { name: "Zur Karte" })).not.toBeInTheDocument()
    })

    it("calls onShowOnMap, not onOpen, when clicked", () => {
      const onOpen = vi.fn()
      const onShowOnMap = vi.fn()
      renderWithProvider(<SimplePlaceCard place={makePlace()} onOpen={onOpen} onShowOnMap={onShowOnMap} />)
      fireEvent.click(screen.getByRole("button", { name: "Zur Karte" }))
      expect(onShowOnMap).toHaveBeenCalledTimes(1)
      expect(onOpen).not.toHaveBeenCalled()
    })
  })
})
