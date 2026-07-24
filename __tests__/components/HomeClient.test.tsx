// @vitest-environment jsdom
//
// Regression coverage for: "Hier suchen" (search-this-area) on the map computes
// a viewport-derived radius and uses it for the actual /api/search request, but
// used to never write it back into the `radiusKm` React state — so the header
// radius pill (RadiusPresetPopover, rendered inside ResultsList's own header on
// desktop / MobileLayout's header pill on mobile) kept showing the pre-pan
// radius while the query underneath used a different one. Fixed in
// `handleSearchHere` (app/HomeClient.tsx) by calling `setRadiusKm` alongside
// `handleSearch`, mirroring the already-correct `handleExpandRadius` sibling.
//
// This is a scoped wiring test, not full HomeClient coverage: every child
// component except the ones under test (MapView's "Hier suchen" callback,
// ResultsList's displayed radiusKm) is mocked to a trivial stub so the test
// doesn't depend on Leaflet, geolocation, or the full search UI.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react"
import HomeClient from "@/app/HomeClient"
import { DEFAULT_APP_SETTINGS } from "@/lib/settings"

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }))
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage:   vi.fn(),
  addBreadcrumb:    vi.fn(),
  flush:            vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n")>()
  const de = (await import("@/lib/i18n/de")).default
  return {
    ...actual,
    useTranslations: () => de,
    useLocale: () => ({ locale: "de" as const, setLocale: vi.fn() }),
  }
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Captured = { current: any }
const mapViewProps: Captured    = { current: null }
const chatPanelProps: Captured  = { current: null }
const resultsListProps: Captured = { current: null }

vi.mock("@/components/map/MapView", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (props: any) => { mapViewProps.current = props; return null },
}))

vi.mock("@/components/chat/ChatPanel", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (props: any) => { chatPanelProps.current = props; return null },
}))

vi.mock("@/components/filters/FilterPanel", () => ({
  default: () => null,
}))

vi.mock("@/components/results/ResultsList", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (props: any) => {
    resultsListProps.current = props
    return <div data-testid="results-radius">{props.radiusKm}</div>
  },
}))

// Irrelevant to this test and each pulls in its own concerns (settings sheet
// state, i18n route links, session-only easter eggs) — stub to reduce noise.
vi.mock("@/components/settings/SettingsSheet", () => ({ default: () => null }))
vi.mock("@/components/LanguageSwitcher",       () => ({ default: () => null }))
vi.mock("@/components/SplashOverlay",          () => ({ default: () => null }))
vi.mock("@/components/IntlHintBanner",         () => ({ default: () => null }))
vi.mock("@/components/easter-eggs/WheelchairRace", () => ({ default: () => null }))

// Only needed by the Simple View describe block below (its "start" -> "tiles"
// -> "results" flow calls the real getBestPosition) — mocked module-wide since
// vi.mock must live at the top level, but every other describe block in this
// file renders the full UI and never touches it.
const mockGetBestPosition = vi.fn()
vi.mock("@/lib/native/geolocation", () => ({
  getBestPosition: (...args: unknown[]) => mockGetBestPosition(...args),
  isGeolocationAvailable: () => true,
}))
vi.mock("@/lib/native/haptics", () => ({ hapticLight: vi.fn(), hapticMedium: vi.fn() }))
vi.mock("@/lib/native/navigation", () => ({
  startDefaultNavigation: vi.fn(),
  startNavigationWithApp: vi.fn(),
  shouldShowChooser: () => false,
}))

function ndjsonResponse(events: object[]): Response {
  const text = events.map((e) => JSON.stringify(e)).join("\n") + "\n"
  return new Response(text, { status: 200, headers: { "Content-Type": "application/x-ndjson" } })
}

function resultEvent(overrides: Partial<{ places: unknown[] }> = {}) {
  return {
    type: "result",
    payload: {
      places:      overrides.places ?? [],
      durationMs:  10,
      sourceStats: {},
      location:    { lat: 52.5, lon: 13.4 },
      locationLabel: "Berlin",
    },
  }
}

function mockSearchFetch() {
  return vi.fn((url: string) => {
    if (typeof url === "string" && url.startsWith("/api/search")) {
      return Promise.resolve(ndjsonResponse([resultEvent()]))
    }
    // /api/ping (usage-stats beacon) and anything else — non-fatal either way,
    // the ping call is wrapped in .catch() in HomeClient itself.
    return Promise.resolve(new Response(null, { status: 204 }))
  })
}

function lastSearchRequestBody(fetchMock: ReturnType<typeof vi.fn>): { radiusKm?: number } {
  const call = fetchMock.mock.calls.filter(([u]) => typeof u === "string" && u.startsWith("/api/search")).at(-1)!
  return JSON.parse(call[1].body)
}

async function runInitialSearch(radiusKm?: number) {
  await act(async () => {
    chatPanelProps.current.onSearch("Restaurants in Berlin", undefined, undefined, radiusKm)
    // handleSearch's fetch/stream-read loop needs a tick to resolve.
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function triggerSearchHere(
  coords: { lat: number; lon: number },
  viewportRadiusKm: number,
  origin: "drag" | "locate" = "drag",
) {
  await act(async () => {
    mapViewProps.current.onSearchHere(coords, viewportRadiusKm, origin)
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  localStorage.clear()
  // Session-restore's "layer 2" (the built-query replay) lives in
  // sessionStorage, not localStorage — a successful runInitialSearch() in one
  // test persists a run that the next test's mount effect would otherwise
  // replay, silently pre-seeding lastQuery and defeating the "no prior query"
  // test case.
  sessionStorage.clear()
  mapViewProps.current = null
  chatPanelProps.current = null
  resultsListProps.current = null
  mockGetBestPosition.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("HomeClient — 'Hier suchen' syncs the header radius pill (regression)", () => {
  it("updates the displayed radiusKm to the viewport-derived radius after 'Hier suchen'", async () => {
    vi.stubGlobal("fetch", mockSearchFetch())
    render(<HomeClient />)

    await runInitialSearch()
    expect(screen.getByTestId("results-radius").textContent).toBe(String(5)) // DEFAULT_RADIUS_KM

    await triggerSearchHere({ lat: 52.52, lon: 13.41 }, 12.3)
    expect(screen.getByTestId("results-radius").textContent).toBe("12.3")
  })

  it("uses the same radius for the displayed pill and the actual /api/search request", async () => {
    const fetchMock = mockSearchFetch()
    vi.stubGlobal("fetch", fetchMock)
    render(<HomeClient />)

    await runInitialSearch()
    await triggerSearchHere({ lat: 52.52, lon: 13.41 }, 8.65)

    expect(screen.getByTestId("results-radius").textContent).toBe("8.65")
    expect(lastSearchRequestBody(fetchMock).radiusKm).toBe(8.65)
  })

  it("clamps a viewport radius below RADIUS_MIN_KM (1) before displaying and searching it", async () => {
    const fetchMock = mockSearchFetch()
    vi.stubGlobal("fetch", fetchMock)
    render(<HomeClient />)

    await runInitialSearch()
    await triggerSearchHere({ lat: 52.52, lon: 13.41 }, 0.2)

    expect(screen.getByTestId("results-radius").textContent).toBe("1")
    expect(lastSearchRequestBody(fetchMock).radiusKm).toBe(1)
  })

  it("clamps a viewport radius above RADIUS_MAX_KM (50) before displaying and searching it", async () => {
    const fetchMock = mockSearchFetch()
    vi.stubGlobal("fetch", fetchMock)
    render(<HomeClient />)

    await runInitialSearch()
    await triggerSearchHere({ lat: 52.52, lon: 13.41 }, 250)

    expect(screen.getByTestId("results-radius").textContent).toBe("50")
    expect(lastSearchRequestBody(fetchMock).radiusKm).toBe(50)
  })

  it("does nothing (no radius change, no search request) when there is no prior query and no active category", async () => {
    const fetchMock = mockSearchFetch()
    vi.stubGlobal("fetch", fetchMock)
    render(<HomeClient />)

    // No runInitialSearch() — lastQuery/categoryQuery are both still empty.
    await triggerSearchHere({ lat: 52.52, lon: 13.41 }, 12 )

    expect(screen.getByTestId("results-radius").textContent).toBe(String(5)) // unchanged default
    expect(fetchMock.mock.calls.some(([u]) => typeof u === "string" && u.startsWith("/api/search"))).toBe(false)
  })

  it("also syncs the radius via the categoryQuery path (a chip search, no free-text query yet)", async () => {
    const fetchMock = mockSearchFetch()
    vi.stubGlobal("fetch", fetchMock)
    render(<HomeClient />)

    // No runInitialSearch(): simulate a category chip having been selected
    // (ChatPanel reports this via onCategoryQueryChange) without a free-text
    // query ever having run yet — handleSearchHere's `else if (categoryQuery)`
    // branch, the fallback path alongside `if (lastQuery)`.
    act(() => { chatPanelProps.current.onCategoryQueryChange("Restaurants") })

    await triggerSearchHere({ lat: 52.52, lon: 13.41 }, 15.7)

    expect(screen.getByTestId("results-radius").textContent).toBe("15.7")
    expect(lastSearchRequestBody(fetchMock).radiusKm).toBe(15.7)
  })

  it("keeps the displayed radius in sync across repeated 'Hier suchen' calls at different viewport radii", async () => {
    vi.stubGlobal("fetch", mockSearchFetch())
    render(<HomeClient />)

    await runInitialSearch()
    await triggerSearchHere({ lat: 52.52, lon: 13.41 }, 6.1)
    expect(screen.getByTestId("results-radius").textContent).toBe("6.1")

    await triggerSearchHere({ lat: 52.55, lon: 13.44 }, 22.9)
    expect(screen.getByTestId("results-radius").textContent).toBe("22.9")

    await triggerSearchHere({ lat: 52.50, lon: 13.40 }, 3.4)
    expect(screen.getByTestId("results-radius").textContent).toBe("3.4")
  })
})

// ─── "Hier suchen" origin (v9.72): a pill armed by the locate button counts as
// a genuine "near me" search (chatMode "nearby", nearby state preserved — the
// green location token stays); one armed by a real drag pan does not (chatMode
// "text", exitNearbyTrigger bumped). See docs/plans/remove-nearby-button-from-search-row.md
// and MapView's searchHereOriginRef. ──────────────────────────────────────────
describe("HomeClient — handleSearchHere branches on pill-arm origin", () => {
  it("origin='locate' enters nearby mode and does NOT bump exitNearbyTrigger (token/nearbyPhase must survive)", async () => {
    vi.stubGlobal("fetch", mockSearchFetch())
    render(<HomeClient />)
    await runInitialSearch()

    const exitNearbyTriggerBefore = chatPanelProps.current.exitNearbyTrigger
    await triggerSearchHere({ lat: 48.14, lon: 11.56 }, 12.3, "locate")

    expect(chatPanelProps.current.initialMode).toBe("nearby")
    expect(chatPanelProps.current.exitNearbyTrigger).toBe(exitNearbyTriggerBefore)
  })

  it("origin='drag' (default) leaves/stays in text mode and bumps exitNearbyTrigger, unchanged from before this feature", async () => {
    vi.stubGlobal("fetch", mockSearchFetch())
    render(<HomeClient />)
    await runInitialSearch()

    const exitNearbyTriggerBefore = chatPanelProps.current.exitNearbyTrigger
    await triggerSearchHere({ lat: 52.52, lon: 13.41 }, 12.3, "drag")

    expect(chatPanelProps.current.initialMode).toBe("text")
    expect(chatPanelProps.current.exitNearbyTrigger).toBe(exitNearbyTriggerBefore + 1)
  })

  it("a subsequent origin='drag' search leaves nearby mode again after an origin='locate' one", async () => {
    vi.stubGlobal("fetch", mockSearchFetch())
    render(<HomeClient />)
    await runInitialSearch()

    await triggerSearchHere({ lat: 48.14, lon: 11.56 }, 12.3, "locate")
    expect(chatPanelProps.current.initialMode).toBe("nearby")

    await triggerSearchHere({ lat: 52.52, lon: 13.41 }, 9.0, "drag")
    expect(chatPanelProps.current.initialMode).toBe("text")
  })
})

// ─── Simple View's map must never inherit the full UI's independent "always
// show parking/WC layer" preference (filters.alwaysShowParking/Toilets, only
// togglable via MapView's own "Ebenen" pill — a control Simple View's map
// never renders). Reported live: a user who'd turned that layer on in the
// full UI saw WC/parking markers stuck on in Simple View too, with no way to
// turn them back off there. Fixed by deriving simpleParkingSpots/
// simpleToiletSpots from Simple View's OWN active amenity search only. ─────
describe("HomeClient — Simple View never shows the full UI's passive parking/WC layer", () => {
  it("passes no parkingSpots/toiletSpots to MapView during a plain category search, even with alwaysShowParking/Toilets on", async () => {
    localStorage.setItem("ap_settings", JSON.stringify({
      ...DEFAULT_APP_SETTINGS,
      simpleView:        true,
      alwaysShowParking: true,
      alwaysShowToilets: true,
    }))
    mockGetBestPosition.mockResolvedValue({ lat: 52.5, lon: 13.4 })
    vi.stubGlobal("fetch", mockSearchFetch())

    render(<HomeClient />)
    fireEvent.click(await screen.findByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Cafés & Eis"))
    await waitFor(() => expect(screen.getByText("Cafés & Eis in Ihrer Nähe")).toBeInTheDocument())

    expect(mapViewProps.current.parkingSpots).toBeUndefined()
    expect(mapViewProps.current.toiletSpots).toBeUndefined()
  })
})

// ─── Simple View's fixed filter preset: only entrance "yes"/"limited" ever
// show, both "no" and "unknown" are filtered out (acceptUnknown: false).
// Previously acceptUnknown was true, so a place with no entrance data at all
// showed right alongside a confirmed-accessible one — indistinguishable in
// this screen's plain yes/limited/no sentences. ────────────────────────────
describe("HomeClient — Simple View's fixed filter preset", () => {
  it("searches with entrance required and acceptUnknown off, so only yes/limited entrances show", async () => {
    localStorage.setItem("ap_settings", JSON.stringify({ ...DEFAULT_APP_SETTINGS, simpleView: true }))
    mockGetBestPosition.mockResolvedValue({ lat: 52.5, lon: 13.4 })
    const fetchMock = mockSearchFetch()
    vi.stubGlobal("fetch", fetchMock)

    render(<HomeClient />)
    fireEvent.click(await screen.findByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Cafés & Eis"))
    await waitFor(() => expect(screen.getByText("Cafés & Eis in Ihrer Nähe")).toBeInTheDocument())

    const body = lastSearchRequestBody(fetchMock) as unknown as { filters?: { entrance?: boolean; acceptUnknown?: boolean } }
    expect(body.filters?.entrance).toBe(true)
    expect(body.filters?.acceptUnknown).toBe(false)
  })
})

// ─── Simple View's extra per-category rule: cafés/restaurants/hotels
// additionally require a wheelchair toilet ("yes" only, not "limited") — a
// client-side post-filter (HomeClient's simplePlaces) since a single
// SearchFilters value sent to the server would apply uniformly to every
// category in a mixed "Alles anzeigen" result set, not just these three. ───
describe("HomeClient — Simple View's extra toilet requirement for cafés/restaurants/hotels", () => {
  function testPlace(overrides: { id: string; category: string; toilet: string }) {
    return {
      id: overrides.id,
      name: `Place ${overrides.id}`,
      category: overrides.category,
      address: { street: "Teststr.", houseNumber: "1", postalCode: "10115", city: "Berlin", country: "DE" },
      coordinates: { lat: 52.5, lon: 13.4 },
      accessibility: {
        entrance: { value: "yes", confidence: 1, conflict: false, sources: [], details: {} },
        toilet:   { value: overrides.toilet, confidence: 1, conflict: false, sources: [], details: {} },
        parking:  { value: "unknown", confidence: 1, conflict: false, sources: [], details: {} },
      },
      overallConfidence: 0.8,
      primarySource: "osm",
      sourceRecords: [{ sourceId: "osm", externalId: overrides.id, fetchedAt: "", raw: {} }],
    }
  }

  it("keeps a café with toilet=yes but drops one with toilet=limited/no/unknown", async () => {
    localStorage.setItem("ap_settings", JSON.stringify({ ...DEFAULT_APP_SETTINGS, simpleView: true }))
    mockGetBestPosition.mockResolvedValue({ lat: 52.5, lon: 13.4 })
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (typeof url === "string" && url.startsWith("/api/search")) {
        return Promise.resolve(ndjsonResponse([resultEvent({
          places: [
            testPlace({ id: "yes",     category: "cafe", toilet: "yes" }),
            testPlace({ id: "limited", category: "cafe", toilet: "limited" }),
            testPlace({ id: "no",      category: "cafe", toilet: "no" }),
            testPlace({ id: "unknown", category: "cafe", toilet: "unknown" }),
          ],
        })]))
      }
      return Promise.resolve(new Response(null, { status: 204 }))
    }))

    render(<HomeClient />)
    fireEvent.click(await screen.findByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Cafés & Eis"))
    await waitFor(() => expect(screen.getByText("Cafés & Eis in Ihrer Nähe")).toBeInTheDocument())

    expect(screen.getByText("Place yes")).toBeInTheDocument()
    expect(screen.queryByText("Place limited")).not.toBeInTheDocument()
    expect(screen.queryByText("Place no")).not.toBeInTheDocument()
    expect(screen.queryByText("Place unknown")).not.toBeInTheDocument()
  })

  it("does not apply the toilet rule to categories outside cafe/restaurant/hotel, even in the same result set", async () => {
    localStorage.setItem("ap_settings", JSON.stringify({ ...DEFAULT_APP_SETTINGS, simpleView: true }))
    mockGetBestPosition.mockResolvedValue({ lat: 52.5, lon: 13.4 })
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (typeof url === "string" && url.startsWith("/api/search")) {
        return Promise.resolve(ndjsonResponse([resultEvent({
          places: [
            testPlace({ id: "cafe-unknown-toilet",   category: "cafe",    toilet: "unknown" }),
            testPlace({ id: "pharmacy-unknown-toilet", category: "pharmacy", toilet: "unknown" }),
          ],
        })]))
      }
      return Promise.resolve(new Response(null, { status: 204 }))
    }))

    render(<HomeClient />)
    fireEvent.click(await screen.findByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Alles anzeigen"))
    await waitFor(() => expect(screen.getByText(/in Ihrer Nähe/)).toBeInTheDocument())

    expect(screen.queryByText("Place cafe-unknown-toilet")).not.toBeInTheDocument()
    expect(screen.getByText("Place pharmacy-unknown-toilet")).toBeInTheDocument()
  })
})
