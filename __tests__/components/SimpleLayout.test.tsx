import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { useState } from "react"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { LocaleProvider } from "@/lib/i18n"
import SimpleLayout from "@/components/simple/SimpleLayout"
import { buildAttribute, emptyAttribute } from "@/lib/matching/merge"
import { DEFAULT_APP_SETTINGS } from "@/lib/settings"
import type { Place, AmenityType, AmenityFeature } from "@/lib/types"
import type { AppSettings } from "@/lib/settings"

vi.mock("@/lib/native/navigation", () => ({
  startDefaultNavigation: vi.fn(),
  startNavigationWithApp: vi.fn(),
  shouldShowChooser: () => false,
}))
vi.mock("@/lib/native/haptics", () => ({ hapticLight: vi.fn(), hapticMedium: vi.fn() }))
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), getPlatform: () => "web" }))
// Requires a Next.js App Router context (useRouter/usePathname) that isn't
// mounted in these unit tests — same mock HomeClient.test.tsx already uses.
vi.mock("@/components/LanguageSwitcher", () => ({ default: () => null }))

const mockGetBestPosition = vi.fn()
vi.mock("@/lib/native/geolocation", () => ({
  getBestPosition: (...args: unknown[]) => mockGetBestPosition(...args),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapViewProps: { current: any } = { current: null }
vi.mock("@/components/map/MapView", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (props: any) => { mapViewProps.current = props; return <div data-testid="map-view-stub" /> },
}))

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

interface Handlers {
  onSelect: ReturnType<typeof vi.fn<(place: Place) => void>>
  onSimpleNearbySearch: ReturnType<typeof vi.fn<(query: string, coords: { lat: number; lon: number }) => void>>
  onPlaceSearch: ReturnType<typeof vi.fn<(nameHint: string, coords?: { lat: number; lon: number }) => void>>
  onAmenitySearch: ReturnType<typeof vi.fn<(type: AmenityType, coords: { lat: number; lon: number }) => void>>
  onSearchHere: ReturnType<typeof vi.fn<(coords: { lat: number; lon: number }, viewportRadiusKm: number) => void>>
  onFocusSearchHere: ReturnType<typeof vi.fn<(coords: { lat: number; lon: number }, viewportRadiusKm: number) => void>>
  onUpdateSettings: ReturnType<typeof vi.fn<(patch: Partial<AppSettings>) => void>>
}

function renderLayout(props: {
  places?: Place[]
  isLoading?: boolean
  error?: string
  searchCenter?: { lat: number; lon: number }
  gpsCoords?: { lat: number; lon: number } | null
  selectedId?: string
  settings?: AppSettings
} = {}, handlers: Partial<Handlers> = {}) {
  const h: Handlers = {
    onSelect: vi.fn<(place: Place) => void>(),
    onSimpleNearbySearch: vi.fn<(query: string, coords: { lat: number; lon: number }) => void>(),
    onPlaceSearch: vi.fn<(nameHint: string, coords?: { lat: number; lon: number }) => void>(),
    onAmenitySearch: vi.fn<(type: AmenityType, coords: { lat: number; lon: number }) => void>(),
    onSearchHere: vi.fn<(coords: { lat: number; lon: number }, viewportRadiusKm: number) => void>(),
    onFocusSearchHere: vi.fn<(coords: { lat: number; lon: number }, viewportRadiusKm: number) => void>(),
    onUpdateSettings: vi.fn<(patch: Partial<AppSettings>) => void>(),
    ...handlers,
  }
  const utils = render(
    <LocaleProvider initialLocale="de">
      <SimpleLayout
        places={props.places ?? []}
        isLoading={props.isLoading ?? false}
        error={props.error}
        searchCenter={props.searchCenter}
        gpsCoords={props.gpsCoords}
        selectedId={props.selectedId}
        onSelect={h.onSelect}
        onSimpleNearbySearch={h.onSimpleNearbySearch}
        onPlaceSearch={h.onPlaceSearch}
        onAmenitySearch={h.onAmenitySearch}
        onSearchHere={h.onSearchHere}
        onFocusSearchHere={h.onFocusSearchHere}
        settings={props.settings ?? DEFAULT_APP_SETTINGS}
        onUpdateSettings={h.onUpdateSettings}
      />
    </LocaleProvider>,
  )
  return { ...utils, handlers: h }
}

// Real HomeClient's handlePlaceSearch sets isLoading=true SYNCHRONOUSLY
// (before any await) — meaning React's automatic batching commits it in the
// SAME render as SimpleLayout's own setVenuePending(true), so its
// venuePending effect never observes a stale isLoading=false. A plain
// no-op vi.fn() for onPlaceSearch can't replicate that timing, which made an
// earlier draft of these tests flake against a false positive. This harness
// holds real React state instead, so onPlaceSearch's setIsLoading(true) is a
// genuine sibling update in the same commit — matching production exactly —
// and exposes a `settle` callback for the test to resolve the "search" once
// it's ready to assert on the outcome.
let venueSettle: ((r: { places?: Place[]; error?: string; searchCenter?: { lat: number; lon: number } }) => void) | null = null
const onPlaceSearchSpy = vi.fn<(name: string, coords?: { lat: number; lon: number }) => void>()

function VenueHarness({ settings = DEFAULT_APP_SETTINGS }: { settings?: AppSettings }) {
  const [places, setPlaces] = useState<Place[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  // Mirrors the real app: handleSearch sets `searchCenter` to the resolved
  // location for EVERY search, including a venue lookup — where it ends up
  // equal to the found place's own coordinates.
  const [searchCenter, setSearchCenter] = useState<{ lat: number; lon: number } | undefined>()

  function onPlaceSearch(name: string, coords?: { lat: number; lon: number }) {
    onPlaceSearchSpy(name, coords)
    setIsLoading(true)
    setError(undefined)
    venueSettle = (r) => {
      setPlaces(r.places ?? [])
      setError(r.error)
      setIsLoading(false)
      if (r.searchCenter) setSearchCenter(r.searchCenter)
    }
  }

  return (
    <SimpleLayout
      places={places}
      isLoading={isLoading}
      error={error}
      searchCenter={searchCenter}
      onSelect={vi.fn<(place: Place) => void>()}
      onSimpleNearbySearch={vi.fn<(query: string, coords: { lat: number; lon: number }) => void>()}
      onPlaceSearch={onPlaceSearch}
      onAmenitySearch={vi.fn<(type: AmenityType, coords: { lat: number; lon: number }) => void>()}
      onSearchHere={vi.fn()}
      onFocusSearchHere={vi.fn()}
      settings={settings}
      onUpdateSettings={vi.fn<(patch: Partial<AppSettings>) => void>()}
    />
  )
}

function renderVenueHarness(settings?: AppSettings) {
  return render(
    <LocaleProvider initialLocale="de">
      <VenueHarness settings={settings} />
    </LocaleProvider>,
  )
}

beforeEach(() => {
  mockGetBestPosition.mockReset()
  mapViewProps.current = null
  venueSettle = null
  onPlaceSearchSpy.mockReset()
  vi.stubGlobal("fetch", vi.fn())
})

describe("SimpleLayout — start screen", () => {
  it("shows both core-job choices", () => {
    renderLayout()
    expect(screen.getByText("In meiner Nähe suchen")).toBeInTheDocument()
    expect(screen.getByText("Einen konkreten Ort prüfen")).toBeInTheDocument()
  })

  it("the return-to-full-UI link is present", () => {
    renderLayout()
    expect(screen.getByText("Alle Funktionen anzeigen")).toBeInTheDocument()
  })

  it("opens the settings panel (with the Simple View toggle) from the start screen", () => {
    renderLayout()
    fireEvent.click(screen.getByText("Alle Funktionen anzeigen"))
    expect(screen.getByText("Einfache Ansicht")).toBeInTheDocument()
  })
})

describe("SimpleLayout — nearby flow", () => {
  it("navigates to the category tiles screen", () => {
    renderLayout()
    fireEvent.click(screen.getByText("In meiner Nähe suchen"))
    expect(screen.getByText("Welche Art von Ort?")).toBeInTheDocument()
    // All 6 fixed favourites + "show everything"
    expect(screen.getByText("Cafés & Eis")).toBeInTheDocument()
    expect(screen.getByText("Alles anzeigen")).toBeInTheDocument()
  })

  it("locates then fires onSimpleNearbySearch with the category label and coords, landing on results", async () => {
    mockGetBestPosition.mockResolvedValue({ lat: 50.9, lon: 6.9 })
    const { handlers } = renderLayout()
    fireEvent.click(screen.getByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Cafés & Eis"))

    expect(screen.getByText("Ihr Standort wird ermittelt …")).toBeInTheDocument()

    await waitFor(() => {
      expect(handlers.onSimpleNearbySearch).toHaveBeenCalledWith("Cafés & Eis", { lat: 50.9, lon: 6.9 })
    })
    expect(screen.getByText("Cafés & Eis in Ihrer Nähe")).toBeInTheDocument()
  })

  it("'show everything' sends the neutral non-category query word, not a real category label", async () => {
    mockGetBestPosition.mockResolvedValue({ lat: 50.9, lon: 6.9 })
    const { handlers } = renderLayout()
    fireEvent.click(screen.getByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Alles anzeigen"))
    await waitFor(() => expect(handlers.onSimpleNearbySearch).toHaveBeenCalled())
    expect(handlers.onSimpleNearbySearch).toHaveBeenCalledWith("Orte", { lat: 50.9, lon: 6.9 })
  })

  it("shows a locate error and returns to tiles when geolocation fails", async () => {
    mockGetBestPosition.mockRejectedValue(new Error("no-geolocation"))
    const { handlers } = renderLayout()
    fireEvent.click(screen.getByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Cafés & Eis"))
    await waitFor(() => expect(screen.getByText("Standort konnte nicht ermittelt werden.")).toBeInTheDocument())
    expect(screen.getByText("Welche Art von Ort?")).toBeInTheDocument() // back on tiles
    expect(handlers.onSimpleNearbySearch).not.toHaveBeenCalled()
  })

  // Regression: getBestPosition has no abort signal, so cancelling must be a
  // local flag that suppresses the resolved promise's side effects.
  it("cancelling out of the locating screen prevents the eventual search from firing", async () => {
    let resolveLocate: (v: { lat: number; lon: number }) => void = () => {}
    mockGetBestPosition.mockReturnValue(new Promise((res) => { resolveLocate = res }))
    const { handlers } = renderLayout()
    fireEvent.click(screen.getByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Cafés & Eis"))
    expect(screen.getByText("Ihr Standort wird ermittelt …")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Zurück"))
    expect(screen.getByText("Welche Art von Ort?")).toBeInTheDocument()

    await act(async () => { resolveLocate({ lat: 50.9, lon: 6.9 }); await Promise.resolve() })

    expect(handlers.onSimpleNearbySearch).not.toHaveBeenCalled()
    expect(screen.getByText("Welche Art von Ort?")).toBeInTheDocument()
  })
})

describe("SimpleLayout — results screen", () => {
  async function goToResults(handlers?: Partial<Handlers>) {
    mockGetBestPosition.mockResolvedValue({ lat: 50.9, lon: 6.9 })
    const utils = renderLayout({}, handlers)
    fireEvent.click(screen.getByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Cafés & Eis"))
    await waitFor(() => expect(screen.getByText("Cafés & Eis in Ihrer Nähe")).toBeInTheDocument())
    return utils
  }

  // "Hier suchen" — MapView renders its own built-in pill for whichever of
  // these two is passed (see MapView's own searchHereCenter/focusMode logic);
  // SimpleLayout only needs to forward the right prop and set focusMode
  // correctly so the venue pill and the amenity "search this area" pill can
  // never both be eligible at once.
  it("passes onSearchHere through to MapView, with focusMode false during a venue search", async () => {
    const { handlers } = await goToResults()
    expect(mapViewProps.current.onSearchHere).toBe(handlers.onSearchHere)
    expect(mapViewProps.current.focusMode).toBe(false)
  })

  it("shows a loading spinner and the search-in-progress bar while isLoading is true", async () => {
    const { rerender, handlers } = await goToResults()
    // isLoading defaults to false in goToResults's own render — simulate the
    // parent flipping it to true right after the search starts by re-rendering.
    rerender(
      <LocaleProvider initialLocale="de">
        <SimpleLayout
          places={[]}
          isLoading={true}
          searchCenter={{ lat: 50.9, lon: 6.9 }}
          onSelect={handlers.onSelect}
          onSimpleNearbySearch={handlers.onSimpleNearbySearch}
          onPlaceSearch={handlers.onPlaceSearch}
          onAmenitySearch={handlers.onAmenitySearch}
          onSearchHere={vi.fn()}
          onFocusSearchHere={vi.fn()}
          settings={DEFAULT_APP_SETTINGS}
          onUpdateSettings={handlers.onUpdateSettings}
        />
      </LocaleProvider>,
    )
    // The bar directly above the map — same indicator/copy as the full UI's
    // ChatPanel search-in-progress bar, so it reads identically either way.
    expect(screen.getByRole("status", { name: "Suche läuft …" })).toBeInTheDocument()
  })

  it("hides the search-in-progress bar once loading finishes", async () => {
    const { rerender, handlers } = await goToResults()
    rerender(
      <LocaleProvider initialLocale="de">
        <SimpleLayout
          places={[makePlace()]}
          isLoading={false}
          searchCenter={{ lat: 50.9, lon: 6.9 }}
          onSelect={handlers.onSelect}
          onSimpleNearbySearch={handlers.onSimpleNearbySearch}
          onPlaceSearch={handlers.onPlaceSearch}
          onAmenitySearch={handlers.onAmenitySearch}
          onSearchHere={vi.fn()}
          onFocusSearchHere={vi.fn()}
          settings={DEFAULT_APP_SETTINGS}
          onUpdateSettings={handlers.onUpdateSettings}
        />
      </LocaleProvider>,
    )
    expect(screen.queryByRole("status", { name: "Suche läuft …" })).not.toBeInTheDocument()
  })

  it("shows the place list once results arrive", async () => {
    const { rerender } = await goToResults()
    rerender(
      <LocaleProvider initialLocale="de">
        <SimpleLayout
          places={[makePlace()]}
          isLoading={false}
          searchCenter={{ lat: 50.9, lon: 6.9 }}
          onSelect={vi.fn<(place: Place) => void>()}
          onSimpleNearbySearch={vi.fn<(query: string, coords: { lat: number; lon: number }) => void>()}
          onPlaceSearch={vi.fn()}
          onAmenitySearch={vi.fn()}
          onSearchHere={vi.fn()}
          onFocusSearchHere={vi.fn()}
          settings={DEFAULT_APP_SETTINGS}
          onUpdateSettings={vi.fn<(patch: Partial<AppSettings>) => void>()}
        />
      </LocaleProvider>,
    )
    expect(screen.getByText("Café Sonnenschein")).toBeInTheDocument()
    expect(screen.getByText("1 Ort gefunden")).toBeInTheDocument()
  })

  it("shows the empty state only once a search has actually run and returned nothing", async () => {
    const { rerender } = await goToResults()
    rerender(
      <LocaleProvider initialLocale="de">
        <SimpleLayout
          places={[]}
          isLoading={false}
          searchCenter={{ lat: 50.9, lon: 6.9 }}
          onSelect={vi.fn<(place: Place) => void>()}
          onSimpleNearbySearch={vi.fn<(query: string, coords: { lat: number; lon: number }) => void>()}
          onPlaceSearch={vi.fn()}
          onAmenitySearch={vi.fn()}
          onSearchHere={vi.fn()}
          onFocusSearchHere={vi.fn()}
          settings={DEFAULT_APP_SETTINGS}
          onUpdateSettings={vi.fn<(patch: Partial<AppSettings>) => void>()}
        />
      </LocaleProvider>,
    )
    expect(screen.getByText("Keine barrierefreien Orte in der Nähe gefunden")).toBeInTheDocument()
  })

  it("suppresses the misleading empty-state message when an error is showing instead", async () => {
    const { rerender } = await goToResults()
    rerender(
      <LocaleProvider initialLocale="de">
        <SimpleLayout
          places={[]}
          isLoading={false}
          error="Netzwerkfehler"
          searchCenter={{ lat: 50.9, lon: 6.9 }}
          onSelect={vi.fn<(place: Place) => void>()}
          onSimpleNearbySearch={vi.fn<(query: string, coords: { lat: number; lon: number }) => void>()}
          onPlaceSearch={vi.fn()}
          onAmenitySearch={vi.fn()}
          onSearchHere={vi.fn()}
          onFocusSearchHere={vi.fn()}
          settings={DEFAULT_APP_SETTINGS}
          onUpdateSettings={vi.fn<(patch: Partial<AppSettings>) => void>()}
        />
      </LocaleProvider>,
    )
    expect(screen.getByText("Netzwerkfehler")).toBeInTheDocument()
    expect(screen.queryByText("Keine barrierefreien Orte in der Nähe gefunden")).not.toBeInTheDocument()
  })

  it("opens the detail screen when a card is tapped, and returns to results on back", async () => {
    const { rerender } = await goToResults()
    rerender(
      <LocaleProvider initialLocale="de">
        <SimpleLayout
          places={[makePlace()]}
          isLoading={false}
          searchCenter={{ lat: 50.9, lon: 6.9 }}
          onSelect={vi.fn<(place: Place) => void>()}
          onSimpleNearbySearch={vi.fn<(query: string, coords: { lat: number; lon: number }) => void>()}
          onPlaceSearch={vi.fn()}
          onAmenitySearch={vi.fn()}
          onSearchHere={vi.fn()}
          onFocusSearchHere={vi.fn()}
          settings={DEFAULT_APP_SETTINGS}
          onUpdateSettings={vi.fn<(patch: Partial<AppSettings>) => void>()}
        />
      </LocaleProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: /Café Sonnenschein/ }))
    expect(screen.getByRole("heading", { name: "Café Sonnenschein" })).toBeInTheDocument()
    fireEvent.click(screen.getByText("Zurück"))
    expect(screen.getByText("Cafés & Eis in Ihrer Nähe")).toBeInTheDocument()
  })

  it("opening a place from the map's 'show in results' popup opens its detail", async () => {
    await goToResults()
    act(() => { mapViewProps.current.onShowInResults(makePlace()) })
    expect(screen.getByRole("heading", { name: "Café Sonnenschein" })).toBeInTheDocument()
  })

  // Regression (found via live browser testing): clicking a marker inside a
  // cluster opened its popup, then it immediately closed and the cluster
  // re-collapsed. Root cause: `sortedPlaces` was recomputed as a brand-new
  // array on every render, including the one triggered by the marker click
  // itself (onSelect → selectedId change). MapView's own marker-building
  // effect depends on the `places` array BY REFERENCE, so a new array — even
  // with identical contents — made it tear down and rebuild every marker
  // from scratch, destroying the just-opened popup. The `places` reference
  // MapView receives must stay stable across a selectedId-only change.
  it("keeps the same `places` array reference across a marker selection (doesn't rebuild MapView's markers)", async () => {
    const { rerender, handlers } = await goToResults()
    const twoPlaces = [makePlace(), makePlace({ id: "p2", name: "Café Zwei" })]
    // Same object reference reused across both renders below — mirrors
    // HomeClient's real `searchCenter` useState value, which only gets a NEW
    // reference when an actual search result arrives, never on a mere
    // selectedId change. A fresh object literal per render here would
    // invalidate the memo for an unrelated reason and defeat the test.
    const searchCenter = { lat: 50.9, lon: 6.9 }
    const renderWith = (selectedId?: string) => rerender(
      <LocaleProvider initialLocale="de">
        <SimpleLayout
          places={twoPlaces}
          isLoading={false}
          searchCenter={searchCenter}
          selectedId={selectedId}
          onSelect={handlers.onSelect}
          onSimpleNearbySearch={handlers.onSimpleNearbySearch}
          onPlaceSearch={handlers.onPlaceSearch}
          onAmenitySearch={handlers.onAmenitySearch}
          onSearchHere={vi.fn()}
          onFocusSearchHere={vi.fn()}
          settings={DEFAULT_APP_SETTINGS}
          onUpdateSettings={handlers.onUpdateSettings}
        />
      </LocaleProvider>,
    )
    renderWith(undefined)
    const placesBefore = mapViewProps.current.places
    // Simulates the real trigger: HomeClient re-rendering SimpleLayout with a
    // NEW selectedId prop after a marker click's onSelect bubbles up to it
    // (onSelect is a no-op spy here, so the parent re-render has to be driven
    // explicitly — but this is exactly what a real setSelectedId call does).
    renderWith(twoPlaces[0].id)
    expect(mapViewProps.current.places).toBe(placesBefore)
  })

  // Map ↔ list cross-highlighting: tapping a marker already opens its Leaflet
  // popup natively (MapView's own behaviour, untested here); what SimpleLayout
  // must add is scrolling the matching card into view and highlighting it.
  it("tapping a marker (MapView's onSelect) scrolls the matching list card into view and highlights it", async () => {
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {})
    const { rerender, handlers } = await goToResults()
    rerender(
      <LocaleProvider initialLocale="de">
        <SimpleLayout
          places={[makePlace()]}
          isLoading={false}
          searchCenter={{ lat: 50.9, lon: 6.9 }}
          selectedId={undefined}
          onSelect={handlers.onSelect}
          onSimpleNearbySearch={handlers.onSimpleNearbySearch}
          onPlaceSearch={handlers.onPlaceSearch}
          onAmenitySearch={handlers.onAmenitySearch}
          onSearchHere={vi.fn()}
          onFocusSearchHere={vi.fn()}
          settings={DEFAULT_APP_SETTINGS}
          onUpdateSettings={handlers.onUpdateSettings}
        />
      </LocaleProvider>,
    )
    act(() => { mapViewProps.current.onSelect(makePlace()) })
    expect(handlers.onSelect).toHaveBeenCalledWith(makePlace())
    // "auto", not "smooth" — a smooth scroll queued here was verified live to
    // get silently interrupted by the marker click's own popup/layout changes.
    // "start", not "nearest" — the selected card must land flush under the
    // map (reading as the first result), not merely somewhere on screen.
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto", block: "start" }))
    scrollSpy.mockRestore()
  })

  // The card's own "Zur Karte" button is the reverse direction: select the
  // place (highlighting/panning to its marker via MapView's existing
  // selectedId handling) without opening the detail screen. panTrigger must
  // bump so MapView re-pans even if this card was already selected.
  it("a card's 'Zur Karte' button selects the place and bumps the map's panTrigger, without opening detail", async () => {
    const { rerender, handlers } = await goToResults()
    rerender(
      <LocaleProvider initialLocale="de">
        <SimpleLayout
          places={[makePlace()]}
          isLoading={false}
          searchCenter={{ lat: 50.9, lon: 6.9 }}
          onSelect={handlers.onSelect}
          onSimpleNearbySearch={handlers.onSimpleNearbySearch}
          onPlaceSearch={handlers.onPlaceSearch}
          onAmenitySearch={handlers.onAmenitySearch}
          onSearchHere={vi.fn()}
          onFocusSearchHere={vi.fn()}
          settings={DEFAULT_APP_SETTINGS}
          onUpdateSettings={handlers.onUpdateSettings}
        />
      </LocaleProvider>,
    )
    const panTriggerBefore = mapViewProps.current.panTrigger
    fireEvent.click(screen.getByRole("button", { name: "Zur Karte" }))
    expect(handlers.onSelect).toHaveBeenCalledWith(makePlace())
    expect(mapViewProps.current.panTrigger).toBeGreaterThan(panTriggerBefore)
    expect(screen.queryByRole("heading", { name: "Café Sonnenschein" })).not.toBeInTheDocument()
  })

  // Regression: MapView's own popup "Details" chip ignores onShowInResults
  // entirely and, by default, opens the full PlaceDebugSheet internally —
  // discovered via live browser testing. onOpenDetails is the override that
  // must be wired for Simple View's own reduced detail screen to actually be
  // reachable from the map, not just from the result list.
  it("passes onOpenDetails to MapView so its popup's own 'Details' chip also opens SimpleDetail", async () => {
    await goToResults()
    expect(mapViewProps.current.onOpenDetails).toBeInstanceOf(Function)
    act(() => { mapViewProps.current.onOpenDetails(makePlace()) })
    expect(screen.getByRole("heading", { name: "Café Sonnenschein" })).toBeInTheDocument()
  })

  // The map/list split is freely drag-resizable (like Google Maps' bottom
  // sheet) rather than a binary strip/fullscreen toggle — see clampSplitHeight
  // in SimpleLayout. jsdom never actually computes layout (clientHeight is
  // always 0), so these tests stub HTMLElement.prototype.clientHeight to a
  // fixed value to exercise the real sizing math.
  describe("resizable split", () => {
    const ORIGINAL_CLIENT_HEIGHT = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight")

    function stubClientHeight(px: number) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: px })
    }
    afterEach(() => {
      if (ORIGINAL_CLIENT_HEIGHT) Object.defineProperty(HTMLElement.prototype, "clientHeight", ORIGINAL_CLIENT_HEIGHT)
    })

    function mapPanelHeightPx(): number {
      const style = screen.getByTestId("map-view-stub").parentElement!.getAttribute("style") ?? ""
      const m = /height:\s*(\d+)px/.exec(style)
      return m ? Number(m[1]) : NaN
    }

    // The seeding effect (mapHeightPx: null → 40% of the measured container)
    // runs after the "results" screen commits, in its own effect pass — under
    // full-suite scheduling pressure that can land after a synchronous
    // assertion immediately following goToResults(), not just before it.
    // Every test in this block that interacts with the separator must wait
    // for the seed first: beginSplitDrag/the keyboard handler both no-op
    // while mapHeightPx is still null, so an unseeded interaction silently
    // does nothing instead of failing loudly — easy to misread as "the drag
    // handler is broken" when it's actually "the seed hadn't landed yet".
    async function goToSeededResults() {
      stubClientHeight(400)
      await goToResults()
      await waitFor(() => expect(mapPanelHeightPx()).toBe(160)) // 40% of 400
      return screen.getByRole("separator", { name: "Größe von Karte und Liste anpassen" })
    }

    it("seeds the split at 40% map / 60% list once the container can be measured", async () => {
      await goToSeededResults()
    })

    it("exposes the split as an accessible separator with a current-value percentage", async () => {
      const separator = await goToSeededResults()
      expect(separator).toHaveAttribute("aria-valuenow", "40")
    })

    it("ArrowDown/ArrowUp on the separator resize the map pane, clamped to a minimum", async () => {
      const separator = await goToSeededResults()
      fireEvent.keyDown(separator, { key: "ArrowDown" })
      expect(mapPanelHeightPx()).toBe(192) // 160 + 32 step
      fireEvent.keyDown(separator, { key: "ArrowUp" })
      fireEvent.keyDown(separator, { key: "ArrowUp" })
      expect(mapPanelHeightPx()).toBe(128) // 192 - 32 - 32
      // Drive it far past the minimum — must clamp, not go negative or collapse to 0.
      for (let i = 0; i < 20; i++) fireEvent.keyDown(separator, { key: "ArrowUp" })
      expect(mapPanelHeightPx()).toBe(90) // SPLIT_PANE_MIN_PX
    })

    it("dragging the separator resizes the map pane arbitrarily within [min, max]", async () => {
      const separator = await goToSeededResults()
      fireEvent.pointerDown(separator, { clientY: 200, pointerId: 1 })
      fireEvent.pointerMove(separator, { clientY: 260, pointerId: 1 }) // +60px
      expect(mapPanelHeightPx()).toBe(220) // 160 + 60
      fireEvent.pointerMove(separator, { clientY: 500, pointerId: 1 }) // driven past the max
      expect(mapPanelHeightPx()).toBe(310) // clamped to containerHeight(400) - 90
      fireEvent.pointerUp(separator, { pointerId: 1 })
      // A stray move after release must not keep resizing.
      fireEvent.pointerMove(separator, { clientY: 210, pointerId: 1 })
      expect(mapPanelHeightPx()).toBe(310)
    })
  })
})

// Parking/WC as a first-class "what to search for" tile, alongside the 6
// category tiles — reuses HomeClient's own handleAmenitySearch and the
// already-type-filtered parkingSpots/toiletSpots arrays, so this is mostly
// wiring: a new tile, a results-list branch (AmenityCard instead of
// SimplePlaceCard), and the same map↔list cross-highlighting the venue path
// already has.
describe("SimpleLayout — amenity (parking/WC) flow", () => {
  function makeSpot(overrides: Partial<AmenityFeature> = {}): AmenityFeature {
    return {
      amenityType: "parking",
      lat: 50.91,
      lon: 6.91,
      tier: "strong",
      osmId: "node/111",
      ...overrides,
    }
  }

  it("shows Parken and WC tiles alongside the category tiles", () => {
    renderLayout()
    fireEvent.click(screen.getByText("In meiner Nähe suchen"))
    expect(screen.getByText("Parken")).toBeInTheDocument()
    expect(screen.getByText("WC")).toBeInTheDocument()
  })

  it("locates then fires onAmenitySearch with the type and coords, landing on results", async () => {
    mockGetBestPosition.mockResolvedValue({ lat: 50.9, lon: 6.9 })
    const { handlers } = renderLayout()
    fireEvent.click(screen.getByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Parken"))
    expect(screen.getByText("Ihr Standort wird ermittelt …")).toBeInTheDocument()

    await waitFor(() => {
      expect(handlers.onAmenitySearch).toHaveBeenCalledWith("parking", { lat: 50.9, lon: 6.9 })
    })
    expect(screen.getByText("Parken in Ihrer Nähe")).toBeInTheDocument()
    // The venue search callback must NOT have fired for an amenity tile.
    expect(handlers.onSimpleNearbySearch).not.toHaveBeenCalled()
  })

  async function goToParkingResults(handlers?: Partial<Handlers>) {
    mockGetBestPosition.mockResolvedValue({ lat: 50.9, lon: 6.9 })
    const utils = renderLayout({}, handlers)
    fireEvent.click(screen.getByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Parken"))
    await waitFor(() => expect(screen.getByText("Parken in Ihrer Nähe")).toBeInTheDocument())
    return utils
  }

  it("passes onFocusSearchHere through to MapView, with focusMode true during an amenity search", async () => {
    const { handlers } = await goToParkingResults()
    expect(mapViewProps.current.onFocusSearchHere).toBe(handlers.onFocusSearchHere)
    expect(mapViewProps.current.focusMode).toBe(true)
  })

  it("renders amenity results as AmenityCards, not SimplePlaceCards", async () => {
    const { rerender, handlers } = await goToParkingResults()
    rerender(
      <LocaleProvider initialLocale="de">
        <SimpleLayout
          places={[]}
          isLoading={false}
          searchCenter={{ lat: 50.9, lon: 6.9 }}
          onSelect={handlers.onSelect}
          onSimpleNearbySearch={handlers.onSimpleNearbySearch}
          onPlaceSearch={handlers.onPlaceSearch}
          onAmenitySearch={handlers.onAmenitySearch}
          amenityResults={[makeSpot()]}
          onSearchHere={vi.fn()}
          onFocusSearchHere={vi.fn()}
          settings={DEFAULT_APP_SETTINGS}
          onUpdateSettings={handlers.onUpdateSettings}
        />
      </LocaleProvider>,
    )
    expect(screen.getByText("1 Treffer")).toBeInTheDocument()
    expect(screen.getByText("Reserviert")).toBeInTheDocument() // AmenityCard's own reserved badge (tier: "strong")
  })

  it("shows the amenity-specific empty-state hint when a search returns nothing", async () => {
    const { rerender, handlers } = await goToParkingResults()
    rerender(
      <LocaleProvider initialLocale="de">
        <SimpleLayout
          places={[]}
          isLoading={false}
          searchCenter={{ lat: 50.9, lon: 6.9 }}
          onSelect={handlers.onSelect}
          onSimpleNearbySearch={handlers.onSimpleNearbySearch}
          onPlaceSearch={handlers.onPlaceSearch}
          onAmenitySearch={handlers.onAmenitySearch}
          amenityResults={[]}
          amenityHint="Keine Behindertenparkplätze in der Nähe gefunden."
          onSearchHere={vi.fn()}
          onFocusSearchHere={vi.fn()}
          settings={DEFAULT_APP_SETTINGS}
          onUpdateSettings={handlers.onUpdateSettings}
        />
      </LocaleProvider>,
    )
    expect(screen.getByText("Keine Behindertenparkplätze in der Nähe gefunden.")).toBeInTheDocument()
  })

  it("passes parkingSpots/toiletSpots and the active amenity type straight through to MapView", async () => {
    const { rerender, handlers } = await goToParkingResults()
    const spots = [makeSpot()]
    rerender(
      <LocaleProvider initialLocale="de">
        <SimpleLayout
          places={[]}
          isLoading={false}
          searchCenter={{ lat: 50.9, lon: 6.9 }}
          onSelect={handlers.onSelect}
          onSimpleNearbySearch={handlers.onSimpleNearbySearch}
          onPlaceSearch={handlers.onPlaceSearch}
          onAmenitySearch={handlers.onAmenitySearch}
          amenityResults={spots}
          parkingSpots={spots}
          onSearchHere={vi.fn()}
          onFocusSearchHere={vi.fn()}
          settings={DEFAULT_APP_SETTINGS}
          onUpdateSettings={handlers.onUpdateSettings}
        />
      </LocaleProvider>,
    )
    expect(mapViewProps.current.parkingSpots).toBe(spots)
    expect(mapViewProps.current.amenityType).toBe("parking")
  })

  // Mirrors the venue "Zur Karte" test: selecting an amenity card must pan the
  // map (bump amenityPanTrigger) without opening any detail screen — amenity
  // results have no detail sheet at all (see AmenityCard's own comments).
  it("an amenity card's 'Zur Karte' button bumps the map's amenityPanTrigger", async () => {
    const { rerender, handlers } = await goToParkingResults()
    rerender(
      <LocaleProvider initialLocale="de">
        <SimpleLayout
          places={[]}
          isLoading={false}
          searchCenter={{ lat: 50.9, lon: 6.9 }}
          onSelect={handlers.onSelect}
          onSimpleNearbySearch={handlers.onSimpleNearbySearch}
          onPlaceSearch={handlers.onPlaceSearch}
          onAmenitySearch={handlers.onAmenitySearch}
          amenityResults={[makeSpot()]}
          onSearchHere={vi.fn()}
          onFocusSearchHere={vi.fn()}
          settings={DEFAULT_APP_SETTINGS}
          onUpdateSettings={handlers.onUpdateSettings}
        />
      </LocaleProvider>,
    )
    const triggerBefore = mapViewProps.current.amenityPanTrigger
    fireEvent.click(screen.getByRole("button", { name: "Zur Karte" }))
    expect(mapViewProps.current.amenityPanTrigger).toBeGreaterThan(triggerBefore)
    expect(mapViewProps.current.amenityPanTarget).toEqual({ lat: 50.91, lon: 6.91 })
  })

  // Marker → list, the amenity mirror of the venue marker-click test above:
  // MapView's onAmenityMarkerClick has no stable Place id to key by, so it's
  // keyed via amenitySpotKey (osmId, falling back to lat/lon) instead.
  it("clicking an amenity marker (MapView's onAmenityMarkerClick) scrolls the matching card into view", async () => {
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {})
    const { rerender, handlers } = await goToParkingResults()
    rerender(
      <LocaleProvider initialLocale="de">
        <SimpleLayout
          places={[]}
          isLoading={false}
          searchCenter={{ lat: 50.9, lon: 6.9 }}
          onSelect={handlers.onSelect}
          onSimpleNearbySearch={handlers.onSimpleNearbySearch}
          onPlaceSearch={handlers.onPlaceSearch}
          onAmenitySearch={handlers.onAmenitySearch}
          amenityResults={[makeSpot()]}
          onSearchHere={vi.fn()}
          onFocusSearchHere={vi.fn()}
          settings={DEFAULT_APP_SETTINGS}
          onUpdateSettings={handlers.onUpdateSettings}
        />
      </LocaleProvider>,
    )
    act(() => { mapViewProps.current.onAmenityMarkerClick({ osmId: "node/111", lat: 50.91, lon: 6.91 }) })
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto", block: "start" }))
    scrollSpy.mockRestore()
  })

  it("selecting Parken clears any previously selected category (and vice versa) so the results title is correct", async () => {
    mockGetBestPosition.mockResolvedValue({ lat: 50.9, lon: 6.9 })
    renderLayout()
    fireEvent.click(screen.getByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Cafés & Eis"))
    await waitFor(() => expect(screen.getByText("Cafés & Eis in Ihrer Nähe")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Zurück"))
    fireEvent.click(screen.getByText("Parken"))
    await waitFor(() => expect(screen.getByText("Parken in Ihrer Nähe")).toBeInTheDocument())
  })
})

describe("SimpleLayout — venue flow", () => {
  function mockSuggestResponse(items: Array<{ kind: "area" | "venue"; name: string; display: string; lat: number | null; lon: number | null }>) {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => items.map((i) => ({ osmKey: null, osmValue: null, ...i })),
    })
  }

  it("navigates to the venue screen and shows a hint before typing", () => {
    renderLayout()
    fireEvent.click(screen.getByText("Einen konkreten Ort prüfen"))
    expect(screen.getByText("Tippen Sie einen Namen ein, um zu suchen.")).toBeInTheDocument()
  })

  it("filters suggestions to venue-kind results only", async () => {
    mockSuggestResponse([
      { kind: "area", name: "Köln", display: "Köln", lat: 50.9, lon: 6.9 },
      { kind: "venue", name: "Café Sonnenschein", display: "Café Sonnenschein, Köln", lat: 50.93, lon: 6.93 },
    ])
    renderLayout()
    fireEvent.click(screen.getByText("Einen konkreten Ort prüfen"))
    fireEvent.change(screen.getByPlaceholderText("Name des Lokals …"), { target: { value: "Café" } })
    await waitFor(() => expect(screen.getByText("Café Sonnenschein, Köln")).toBeInTheDocument())
    expect(screen.queryByText("Köln")).not.toBeInTheDocument()
  })

  it("picking a suggestion calls onPlaceSearch and jumps to detail once results arrive", async () => {
    mockSuggestResponse([{ kind: "venue", name: "Café Sonnenschein", display: "Café Sonnenschein, Köln", lat: 50.93, lon: 6.93 }])
    renderVenueHarness()
    fireEvent.click(screen.getByText("Einen konkreten Ort prüfen"))
    fireEvent.change(screen.getByPlaceholderText("Name des Lokals …"), { target: { value: "Café" } })
    await waitFor(() => expect(screen.getByText("Café Sonnenschein, Köln")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Café Sonnenschein, Köln"))
    expect(onPlaceSearchSpy).toHaveBeenCalledWith("Café Sonnenschein", { lat: 50.93, lon: 6.93 })
    // Still on the venue screen, showing its own loading state, not a stale one.
    expect(screen.getByPlaceholderText("Name des Lokals …")).toBeInTheDocument()

    act(() => venueSettle?.({ places: [makePlace()] }))
    expect(screen.getByRole("heading", { name: "Café Sonnenschein" })).toBeInTheDocument()

    // Back from a venue-originated detail must return to "venue", not "results".
    fireEvent.click(screen.getByText("Zurück"))
    expect(screen.getByPlaceholderText("Name des Lokals …")).toBeInTheDocument()
  })

  // Regression (found via live browser testing): a venue lookup's `searchCenter`
  // ends up equal to the found place's own coordinates (mirrors the full app's
  // place-search behaviour), so a naive distance calculation shows a meaningless
  // "0 m entfernt". The full app already suppresses distance for text/place
  // search results for exactly this reason; Simple View's venue-originated
  // detail screen must do the same.
  it("does not show a distance on a venue-originated detail screen", async () => {
    mockSuggestResponse([{ kind: "venue", name: "Café Sonnenschein", display: "Café Sonnenschein, Köln", lat: 50.93, lon: 6.93 }])
    renderVenueHarness()
    fireEvent.click(screen.getByText("Einen konkreten Ort prüfen"))
    fireEvent.change(screen.getByPlaceholderText("Name des Lokals …"), { target: { value: "Café" } })
    await waitFor(() => expect(screen.getByText("Café Sonnenschein, Köln")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Café Sonnenschein, Köln"))

    act(() => venueSettle?.({ places: [makePlace()], searchCenter: { lat: 50.93, lon: 6.93 } }))
    expect(screen.getByRole("heading", { name: "Café Sonnenschein" })).toBeInTheDocument()
    expect(screen.queryByText(/entfernt/)).not.toBeInTheDocument()
  })

  // Regression: handlePlaceSearch has early-return failure paths that set
  // `error` without ever clearing `places` — a stale non-empty `places` array
  // from a PREVIOUS successful venue lookup must not cause the new (failed)
  // lookup to silently reopen the old venue's detail.
  it("does not reopen a stale previous venue's detail when the new lookup fails", async () => {
    mockSuggestResponse([{ kind: "venue", name: "Café Sonnenschein", display: "Café Sonnenschein, Köln", lat: 50.93, lon: 6.93 }])
    renderVenueHarness()
    fireEvent.click(screen.getByText("Einen konkreten Ort prüfen"))
    fireEvent.change(screen.getByPlaceholderText("Name des Lokals …"), { target: { value: "Café" } })
    await waitFor(() => expect(screen.getByText("Café Sonnenschein, Köln")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Café Sonnenschein, Köln"))
    // First lookup succeeds, landing on its detail screen.
    act(() => venueSettle?.({ places: [makePlace({ id: "stale", name: "Alte Bäckerei" })] }))
    expect(screen.getByRole("heading", { name: "Alte Bäckerei" })).toBeInTheDocument()

    // Back to venue, search again — this time the lookup fails. handlePlaceSearch's
    // real 404 path sets `error` WITHOUT clearing `places`, so simulate that
    // exact stale-places-plus-error combination here.
    fireEvent.click(screen.getByText("Zurück"))
    fireEvent.change(screen.getByPlaceholderText("Name des Lokals …"), { target: { value: "Café" } })
    await waitFor(() => expect(screen.getByText("Café Sonnenschein, Köln")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Café Sonnenschein, Köln"))
    act(() => venueSettle?.({ places: [makePlace({ id: "stale", name: "Alte Bäckerei" })], error: "place_not_found" }))

    expect(screen.queryByRole("heading", { name: "Alte Bäckerei" })).not.toBeInTheDocument()
    expect(screen.getByText("Keine Treffer für diesen Namen.")).toBeInTheDocument()
  })

  // Regression: a user backing out of the venue screen mid-search must not be
  // yanked into a detail screen once that abandoned search eventually settles.
  it("does not force-navigate to detail if the user already left the venue screen", async () => {
    mockSuggestResponse([{ kind: "venue", name: "Café Sonnenschein", display: "Café Sonnenschein, Köln", lat: 50.93, lon: 6.93 }])
    renderVenueHarness()
    fireEvent.click(screen.getByText("Einen konkreten Ort prüfen"))
    fireEvent.change(screen.getByPlaceholderText("Name des Lokals …"), { target: { value: "Café" } })
    await waitFor(() => expect(screen.getByText("Café Sonnenschein, Köln")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Café Sonnenschein, Köln"))

    // Abandon the search before it settles.
    fireEvent.click(screen.getByText("Zurück"))
    expect(screen.getByText("In meiner Nähe suchen")).toBeInTheDocument() // back on start

    act(() => venueSettle?.({ places: [makePlace()] }))
    expect(screen.getByText("In meiner Nähe suchen")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Café Sonnenschein" })).not.toBeInTheDocument()
  })

  it("shows 'no matches' when the geocode lookup returns zero places without an error", async () => {
    mockSuggestResponse([{ kind: "venue", name: "Nirgendwo", display: "Nirgendwo", lat: 1, lon: 1 }])
    renderVenueHarness()
    fireEvent.click(screen.getByText("Einen konkreten Ort prüfen"))
    fireEvent.change(screen.getByPlaceholderText("Name des Lokals …"), { target: { value: "Nirgendwo" } })
    await waitFor(() => expect(screen.getByText("Nirgendwo")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Nirgendwo"))

    act(() => venueSettle?.({ places: [] }))
    expect(screen.getByText("Keine Treffer für diesen Namen.")).toBeInTheDocument()
  })
})

describe("SimpleLayout — settings always reachable", () => {
  it("is reachable from the category tiles screen", () => {
    renderLayout()
    fireEvent.click(screen.getByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen" }))
    expect(screen.getByText("Einfache Ansicht")).toBeInTheDocument()
  })

  it("is reachable from the venue search screen", () => {
    renderLayout()
    fireEvent.click(screen.getByText("Einen konkreten Ort prüfen"))
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen" }))
    expect(screen.getByText("Einfache Ansicht")).toBeInTheDocument()
  })

  it("toggling it off calls onUpdateSettings({ simpleView: false })", () => {
    const { handlers } = renderLayout({ settings: { ...DEFAULT_APP_SETTINGS, simpleView: true } })
    fireEvent.click(screen.getByText("Alle Funktionen anzeigen"))
    fireEvent.click(screen.getByRole("switch", { name: /Einfache Ansicht/ }))
    expect(handlers.onUpdateSettings).toHaveBeenCalledWith({ simpleView: false })
  })
})
