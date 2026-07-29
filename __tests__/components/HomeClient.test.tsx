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
  // Simple View's background prefetch (v10.58) gates on this — default to
  // "not granted" so it stays a no-op and these tests keep exercising the
  // per-tap fetch path unchanged.
  hasLocationPermission: () => Promise.resolve(false),
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
    await waitFor(() => expect(screen.getByText("Cafés & Eis in Deiner Nähe")).toBeInTheDocument())

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
    await waitFor(() => expect(screen.getByText("Cafés & Eis in Deiner Nähe")).toBeInTheDocument())

    const body = lastSearchRequestBody(fetchMock) as unknown as { filters?: { entrance?: boolean; acceptUnknown?: boolean } }
    expect(body.filters?.entrance).toBe(true)
    expect(body.filters?.acceptUnknown).toBe(false)
  })
})

// Code-review finding: Simple View's search calls used to omit a
// sourcesOverride entirely, silently inheriting whatever `sources` toggles
// were last persisted from the full UI (ap_prefs) — the opposite of Simple
// View's whole premise (a fixed preset, independent of ambient full-UI
// state). Fixed by passing DEFAULT_SOURCES explicitly.
describe("HomeClient — Simple View always searches with the fixed default sources", () => {
  it("ignores a full-UI source disabled via persisted prefs (ap_prefs)", async () => {
    localStorage.setItem("ap_settings", JSON.stringify({ ...DEFAULT_APP_SETTINGS, simpleView: true }))
    // Simulate a user who previously turned OSM off in the full UI.
    localStorage.setItem("ap_prefs", JSON.stringify({ sources: { osm: false } }))
    mockGetBestPosition.mockResolvedValue({ lat: 52.5, lon: 13.4 })
    const fetchMock = mockSearchFetch()
    vi.stubGlobal("fetch", fetchMock)

    render(<HomeClient />)
    fireEvent.click(await screen.findByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Cafés & Eis"))
    await waitFor(() => expect(screen.getByText("Cafés & Eis in Deiner Nähe")).toBeInTheDocument())

    const body = lastSearchRequestBody(fetchMock) as unknown as { sources?: Record<string, boolean> }
    expect(body.sources?.osm).toBe(true)
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
    await waitFor(() => expect(screen.getByText("Cafés & Eis in Deiner Nähe")).toBeInTheDocument())

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
    await waitFor(() => expect(screen.getByText(/in Deiner Nähe/)).toBeInTheDocument())

    expect(screen.queryByText("Place cafe-unknown-toilet")).not.toBeInTheDocument()
    expect(screen.getByText("Place pharmacy-unknown-toilet")).toBeInTheDocument()
  })
})

// ─── Simple View's own "Suchradius vergrößern" — mirrors the full UI's
// handleExpandRadius, but doubles a dedicated simpleRadiusKm (not the shared
// radiusKm state) and keeps SIMPLE_FILTERS_OVERRIDE on the re-run. ─────────
describe("HomeClient — Simple View's expand-radius button", () => {
  it("doubles the 5 km default to 10 km and re-searches at the same coords", async () => {
    localStorage.setItem("ap_settings", JSON.stringify({ ...DEFAULT_APP_SETTINGS, simpleView: true }))
    mockGetBestPosition.mockResolvedValue({ lat: 52.5, lon: 13.4 })
    const fetchMock = mockSearchFetch()
    vi.stubGlobal("fetch", fetchMock)

    render(<HomeClient />)
    fireEvent.click(await screen.findByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Cafés & Eis"))
    await waitFor(() => expect(screen.getByText("Cafés & Eis in Deiner Nähe")).toBeInTheDocument())

    // The stub search response returns zero places, so the empty state (and
    // its expand-radius button) should already be showing.
    await waitFor(() => expect(screen.getByText("Suchradius vergrößern?")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Suchradius vergrößern?"))

    await waitFor(() => {
      const body = lastSearchRequestBody(fetchMock) as unknown as { radiusKm?: number }
      expect(body.radiusKm).toBe(10)
    })
  })

  // Requested explicitly: show the current search radius so the user can
  // tell at a glance how far a search reached, without a dedicated picker.
  it("shows the current radius in the empty-state title, and updates it after expanding", async () => {
    localStorage.setItem("ap_settings", JSON.stringify({ ...DEFAULT_APP_SETTINGS, simpleView: true }))
    mockGetBestPosition.mockResolvedValue({ lat: 52.5, lon: 13.4 })
    vi.stubGlobal("fetch", mockSearchFetch())

    render(<HomeClient />)
    fireEvent.click(await screen.findByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Cafés & Eis"))
    await waitFor(() => expect(screen.getByText("Keine barrierefreien Orte in der Nähe gefunden (5 km von Deinem Standort)")).toBeInTheDocument())

    fireEvent.click(screen.getByText("Suchradius vergrößern?"))
    await waitFor(() => expect(screen.getByText("Keine barrierefreien Orte in der Nähe gefunden (10 km von Deinem Standort)")).toBeInTheDocument())
  })

  it("shows the current radius in the results count once places arrive", async () => {
    localStorage.setItem("ap_settings", JSON.stringify({ ...DEFAULT_APP_SETTINGS, simpleView: true }))
    mockGetBestPosition.mockResolvedValue({ lat: 52.5, lon: 13.4 })
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (typeof url === "string" && url.startsWith("/api/search")) {
        return Promise.resolve(ndjsonResponse([resultEvent({
          places: [{
            id: "p1", name: "Café Eins", category: "cafe",
            address: { street: "Teststr.", houseNumber: "1", postalCode: "10115", city: "Berlin", country: "DE" },
            coordinates: { lat: 52.5, lon: 13.4 },
            accessibility: {
              entrance: { value: "yes", confidence: 1, conflict: false, sources: [], details: {} },
              toilet:   { value: "yes", confidence: 1, conflict: false, sources: [], details: {} },
              parking:  { value: "unknown", confidence: 1, conflict: false, sources: [], details: {} },
            },
            overallConfidence: 0.8,
            primarySource: "osm",
            sourceRecords: [{ sourceId: "osm", externalId: "p1", fetchedAt: "", raw: {} }],
          }],
        })]))
      }
      return Promise.resolve(new Response(null, { status: 204 }))
    }))

    render(<HomeClient />)
    fireEvent.click(await screen.findByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Cafés & Eis"))
    await waitFor(() => expect(screen.getByText("1 Ort gefunden (5 km Suchradius)")).toBeInTheDocument())
  })

  // Requested explicitly: a plain-doubling 20→40 jump felt too coarse, so the
  // venue radius steps through a fixed table with a 30 km rung between them,
  // ending at RADIUS_MAX_KM (50) rather than growing forever.
  it("steps through 5 → 10 → 20 → 30 → 40 → 50, then stays at 50", async () => {
    localStorage.setItem("ap_settings", JSON.stringify({ ...DEFAULT_APP_SETTINGS, simpleView: true }))
    mockGetBestPosition.mockResolvedValue({ lat: 52.5, lon: 13.4 })
    const fetchMock = mockSearchFetch()
    vi.stubGlobal("fetch", fetchMock)

    render(<HomeClient />)
    fireEvent.click(await screen.findByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Cafés & Eis"))
    await waitFor(() => expect(screen.getByText("Suchradius vergrößern?")).toBeInTheDocument())

    for (const expected of [10, 20, 30, 40, 50, 50]) {
      fireEvent.click(screen.getByText("Suchradius vergrößern?"))
      await waitFor(() => {
        const body = lastSearchRequestBody(fetchMock) as unknown as { radiusKm?: number }
        expect(body.radiusKm).toBe(expected)
      })
    }
  })

  // Requested explicitly: "Alles anzeigen" (no category filter) buries the
  // user in results at the normal 5 km start, so it gets its own smaller
  // start radius — but reuses the exact same step table on expand, so it
  // just joins the existing 5→10→20→30→40→50 sequence one rung earlier.
  it("'Alles anzeigen' starts at 2 km, then joins the normal step table: 2 → 5 → 10 → 20 → 30 → 40 → 50", async () => {
    localStorage.setItem("ap_settings", JSON.stringify({ ...DEFAULT_APP_SETTINGS, simpleView: true }))
    mockGetBestPosition.mockResolvedValue({ lat: 52.5, lon: 13.4 })
    const fetchMock = mockSearchFetch()
    vi.stubGlobal("fetch", fetchMock)

    render(<HomeClient />)
    fireEvent.click(await screen.findByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Alles anzeigen"))
    await waitFor(() => {
      const body = lastSearchRequestBody(fetchMock) as unknown as { radiusKm?: number }
      expect(body.radiusKm).toBe(2)
    })
    await waitFor(() => expect(screen.getByText("Suchradius vergrößern?")).toBeInTheDocument())

    for (const expected of [5, 10, 20, 30, 40, 50, 50]) {
      fireEvent.click(screen.getByText("Suchradius vergrößern?"))
      await waitFor(() => {
        const body = lastSearchRequestBody(fetchMock) as unknown as { radiusKm?: number }
        expect(body.radiusKm).toBe(expected)
      })
    }
  })
})

// Requested explicitly: the Parken/WC radius in Simple View must behave like
// the venue radius above (fixed start, reset every new selection, doubling,
// capped) — NOT reuse the full UI's persisted parkingRadiusKm/amenityRadiusKm
// setting, which would leak Simple View's expansions into the full UI (and
// vice versa) since that's a single shared value across both UIs.
describe("HomeClient — Simple View's own (non-persisted) amenity radius", () => {
  function mockAmenityFetch() {
    return vi.fn((url: string) => {
      if (typeof url === "string" && url.startsWith("/api/nearby-parking")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }))
      }
      return Promise.resolve(new Response(null, { status: 204 }))
    })
  }

  function lastAmenityRadius(fetchMock: ReturnType<typeof vi.fn>): number {
    const call = fetchMock.mock.calls.filter(([u]) => typeof u === "string" && u.startsWith("/api/nearby-parking")).at(-1)!
    return Number(new URL(call[0], "http://localhost").searchParams.get("radius"))
  }

  it("starts at 4 km regardless of a different persisted parkingRadiusKm setting, and doesn't overwrite it on expand", async () => {
    localStorage.setItem("ap_settings", JSON.stringify({ ...DEFAULT_APP_SETTINGS, simpleView: true, parkingRadiusKm: 10 }))
    mockGetBestPosition.mockResolvedValue({ lat: 52.5, lon: 13.4 })
    const fetchMock = mockAmenityFetch()
    vi.stubGlobal("fetch", fetchMock)

    render(<HomeClient />)
    fireEvent.click(await screen.findByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Parken"))
    await waitFor(() => expect(lastAmenityRadius(fetchMock)).toBe(4))

    fireEvent.click(screen.getByText("Suchradius vergrößern?"))
    await waitFor(() => expect(lastAmenityRadius(fetchMock)).toBe(8))

    // The full UI's persisted setting must be untouched by the Simple View expansion.
    const stored = JSON.parse(localStorage.getItem("ap_settings")!)
    expect(stored.parkingRadiusKm).toBe(10)
  })

  it("doubles 4 → 8 → 16 → 25, then stays at 25 (AMENITY_RADIUS_MAX_KM)", async () => {
    localStorage.setItem("ap_settings", JSON.stringify({ ...DEFAULT_APP_SETTINGS, simpleView: true }))
    mockGetBestPosition.mockResolvedValue({ lat: 52.5, lon: 13.4 })
    const fetchMock = mockAmenityFetch()
    vi.stubGlobal("fetch", fetchMock)

    render(<HomeClient />)
    fireEvent.click(await screen.findByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Parken"))
    await waitFor(() => expect(lastAmenityRadius(fetchMock)).toBe(4))

    for (const expected of [8, 16, 25, 25]) {
      fireEvent.click(screen.getByText("Suchradius vergrößern?"))
      await waitFor(() => expect(lastAmenityRadius(fetchMock)).toBe(expected))
    }
  })

  // Code-review finding: "search this area" (map pan during an active
  // Parken/WC search) was still wired to the full UI's own
  // handleAmenitySearchHere, which sets AND PERSISTS amenityRadiusKm/
  // parkingRadiusKm — exactly the leak the two tests above already guard
  // against for the plain search/expand paths, just missed for this third
  // entry point. Fixed via a dedicated handleSimpleAmenitySearchHere.
  it("'search this area' during a Parken search doesn't persist to the full UI's parkingRadiusKm setting", async () => {
    localStorage.setItem("ap_settings", JSON.stringify({ ...DEFAULT_APP_SETTINGS, simpleView: true, parkingRadiusKm: 10 }))
    mockGetBestPosition.mockResolvedValue({ lat: 52.5, lon: 13.4 })
    const fetchMock = mockAmenityFetch()
    vi.stubGlobal("fetch", fetchMock)

    render(<HomeClient />)
    fireEvent.click(await screen.findByText("In meiner Nähe suchen"))
    fireEvent.click(screen.getByText("Parken"))
    await waitFor(() => expect(lastAmenityRadius(fetchMock)).toBe(4))

    act(() => { mapViewProps.current.onFocusSearchHere({ lat: 52.6, lon: 13.5 }, 7.3) })
    await waitFor(() => expect(lastAmenityRadius(fetchMock)).toBeCloseTo(7.3, 5))

    const stored = JSON.parse(localStorage.getItem("ap_settings")!)
    expect(stored.parkingRadiusKm).toBe(10)
  })
})

// ─── Cost regression: a place deep-link (SEO "open in app", shared copy-link,
// native App Link) must NOT force the paid Google Places source on. It used to
// hardcode google_places:true in runPlaceDeepLink's sourcesOverride, billing
// Google for every deep-link open regardless of the receiver's setting — the
// path most exposed to non-UI traffic (shared/indexed URLs, JS-rendering
// crawlers, link-preview bots). It must respect the off-by-default like an
// ordinary search; the DACH sources stay forced on. ────────────────────────
describe("HomeClient — place deep-link does not force Google Places on", () => {
  it("sends google_places:false but keeps the DACH sources forced on", async () => {
    const fetchMock = mockSearchFetch()
    vi.stubGlobal("fetch", fetchMock)

    // initialCity unset + initialSelectLat/Lon set → the deep-link auto-search
    // effect fires on mount (coordinates provided, so no geocode/GPS needed).
    render(
      <HomeClient
        initialSelectLat={52.5}
        initialSelectLon={13.4}
        initialSelectName="Café Beispiel"
        initialCategory="cafe"
      />,
    )

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => typeof u === "string" && u.startsWith("/api/search"))).toBe(true)
    })

    const body = lastSearchRequestBody(fetchMock) as unknown as { sources?: Record<string, boolean> }
    expect(body.sources?.google_places).toBe(false)
    // Broad DACH query is still forced on regardless of receiver toggles.
    expect(body.sources?.osm).toBe(true)
    expect(body.sources?.accessibility_cloud).toBe(true)
    expect(body.sources?.reisen_fuer_alle).toBe(true)
    expect(body.sources?.ginto).toBe(true)
  })
})

// ─── Consistency regression: a place that was visible enough to be shared
// (e.g. via "report a data error", which deliberately surfaces places with
// poor/missing accessibility data) must still open via its own deep-link on
// a receiver with DEFAULT_FILTERS (entrance/toilet on, acceptUnknown off).
// Without forcing every filter off, the OSM adapter's own wheelchair
// pre-filter drops untagged nodes from the raw fetch before nameHint's
// bypass ever runs — the linked place silently never appears. ────────────
describe("HomeClient — place deep-link forces accessibility filters off", () => {
  it("sends every accessibility filter disabled and acceptUnknown true, regardless of the receiver's own filters", async () => {
    const fetchMock = mockSearchFetch()
    vi.stubGlobal("fetch", fetchMock)

    render(
      <HomeClient
        initialSelectLat={52.5}
        initialSelectLon={13.4}
        initialSelectName="MOT (Reha)"
        initialCategory="doctors"
      />,
    )

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([u]) => typeof u === "string" && u.startsWith("/api/search"))).toBe(true)
    })

    const body = lastSearchRequestBody(fetchMock) as unknown as {
      filters?: { entrance?: boolean; toilet?: boolean; parking?: boolean; seating?: boolean; acceptUnknown?: boolean }
    }
    expect(body.filters?.entrance).toBe(false)
    expect(body.filters?.toilet).toBe(false)
    expect(body.filters?.parking).toBe(false)
    expect(body.filters?.seating).toBe(false)
    expect(body.filters?.acceptUnknown).toBe(true)
  })
})

// ─── Consistency regression: opening a place deep-link whose target place
// isn't in the returned results (removed, re-tagged beyond recognition, or
// — before this fix — dropped by the receiver's own filter defaults) used
// to fail completely silently: no selection, no message, just an unrelated
// results list with no indication anything was supposed to open. Now the
// receiver gets an explicit, honest message instead. ──────────────────────
describe("HomeClient — place deep-link honesty when the target isn't found", () => {
  it("shows an explicit message when no returned place is within 100 m of the linked coordinates", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (typeof url === "string" && url.startsWith("/api/search")) {
        return Promise.resolve(ndjsonResponse([resultEvent({
          places: [{
            id: "far-away", name: "Anderer Ort", category: "doctors",
            address: { street: "Teststr.", houseNumber: "1", postalCode: "10115", city: "Berlin", country: "DE" },
            coordinates: { lat: 53.0, lon: 14.0 }, // far outside the 100 m cap
            accessibility: {
              entrance: { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
              toilet:   { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
              parking:  { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
            },
            overallConfidence: 0,
            primarySource: "osm",
            sourceRecords: [{ sourceId: "osm", externalId: "far-away", fetchedAt: "", raw: {} }],
          }],
        })]))
      }
      return Promise.resolve(new Response(null, { status: 204 }))
    }))

    render(
      <HomeClient
        initialSelectLat={52.5}
        initialSelectLon={13.4}
        initialSelectName="MOT (Reha)"
        initialCategory="doctors"
      />,
    )

    // "Anderer Ort" (the unrelated place actually returned) is a legitimate
    // result and may still render in the list — the point being tested is
    // that the honest not-found message for the LINKED place also appears,
    // rather than the app staying silent about it.
    expect(await screen.findByText(/lässt sich in den aktuellen Daten nicht mehr finden/)).toBeInTheDocument()
  })

  it("auto-selects the linked place instead when it IS within 100 m, without showing the not-found message", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (typeof url === "string" && url.startsWith("/api/search")) {
        return Promise.resolve(ndjsonResponse([resultEvent({
          places: [{
            id: "p1", name: "MOT (Reha)", category: "doctors",
            address: { street: "Teststr.", houseNumber: "1", postalCode: "10115", city: "Berlin", country: "DE" },
            coordinates: { lat: 52.5, lon: 13.4 },
            accessibility: {
              entrance: { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
              toilet:   { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
              parking:  { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
            },
            overallConfidence: 0,
            primarySource: "osm",
            sourceRecords: [{ sourceId: "osm", externalId: "p1", fetchedAt: "", raw: {} }],
          }],
        })]))
      }
      return Promise.resolve(new Response(null, { status: 204 }))
    }))

    render(
      <HomeClient
        initialSelectLat={52.5}
        initialSelectLon={13.4}
        initialSelectName="MOT (Reha)"
        initialCategory="doctors"
      />,
    )

    // ResultsList itself is mocked (see the module mock at the top of this
    // file) — it only renders radiusKm, not place cards — so assert on the
    // captured `selectedId` prop HomeClient passes it, rather than on
    // rendered place-name text.
    await waitFor(() => expect(resultsListProps.current?.selectedId).toBe("p1"))
    expect(screen.queryByText(/lässt sich in den aktuellen Daten nicht mehr finden/)).not.toBeInTheDocument()
  })
})

// ─── Quickstart-vs-Turbo mode resolution ──────────────────────────────────
// The mode is resolved from three sources in strict precedence:
//   1. the persisted explicit choice (settings.simpleView, tri-state)
//   2. the device fallback, but ONLY for a device that hasn't used the app
//      before (so an existing user is never moved without choosing to)
//   3. a one-shot override that forces Turbo for deep links Quickstart
//      cannot represent — deliberately never persisted.
// jsdom's matchMedia mock reports desktop by default (vitest.setup.ts), so
// the mobile cases override it explicitly — without that they would silently
// only ever exercise the desktop branch and pass for the wrong reason.
function setMobileViewport(isMobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: isMobile, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

// Quickstart's start screen is unmistakable: the full UI never renders it.
const quickstartMarker = "Wie willst Du suchen?"

describe("HomeClient — Quickstart/Turbo mode resolution", () => {
  afterEach(() => setMobileViewport(false))

  it("a fresh install on a mobile device starts in Quickstart", async () => {
    setMobileViewport(true)
    vi.stubGlobal("fetch", mockSearchFetch())
    render(<HomeClient />)
    expect(await screen.findByText(quickstartMarker)).toBeInTheDocument()
  })

  it("a fresh install on desktop starts in Turbo — the reduced layout is opt-in there", async () => {
    setMobileViewport(false)
    vi.stubGlobal("fetch", mockSearchFetch())
    render(<HomeClient />)
    await waitFor(() => expect(screen.queryByText(quickstartMarker)).not.toBeInTheDocument())
  })

  it("an existing mobile user who never chose a mode keeps Turbo, rather than being moved", async () => {
    setMobileViewport(true)
    localStorage.setItem("ap_visited", "1")
    vi.stubGlobal("fetch", mockSearchFetch())
    render(<HomeClient />)
    await waitFor(() => expect(screen.queryByText(quickstartMarker)).not.toBeInTheDocument())
  })

  it("an explicit Turbo choice wins over the mobile fallback", async () => {
    setMobileViewport(true)
    localStorage.setItem("ap_settings", JSON.stringify({ ...DEFAULT_APP_SETTINGS, simpleView: false }))
    vi.stubGlobal("fetch", mockSearchFetch())
    render(<HomeClient />)
    await waitFor(() => expect(screen.queryByText(quickstartMarker)).not.toBeInTheDocument())
  })

  it("an explicit Quickstart choice wins on desktop, where the fallback would say Turbo", async () => {
    setMobileViewport(false)
    localStorage.setItem("ap_settings", JSON.stringify({ ...DEFAULT_APP_SETTINGS, simpleView: true }))
    vi.stubGlobal("fetch", mockSearchFetch())
    render(<HomeClient />)
    expect(await screen.findByText(quickstartMarker)).toBeInTheDocument()
  })

  // A category Quickstart has no tile for cannot be shown on its results
  // screen without either inventing a tile or silently searching something
  // else, so it falls back to the full UI. "theater" is an SEO category but
  // not one of Quickstart's eight tiles.
  it("a city/category deep link outside Quickstart's tiles forces Turbo, even for a fresh mobile install", async () => {
    setMobileViewport(true)
    vi.stubGlobal("fetch", mockSearchFetch())
    render(<HomeClient initialCity="Berlin" initialCategory="theater" />)
    await waitFor(() => expect(screen.queryByText(quickstartMarker)).not.toBeInTheDocument())
    expect(screen.queryByText(/in Berlin$/)).not.toBeInTheDocument()
  })

  // ...but that override must never be written to disk: the next ordinary
  // launch has to be back in Quickstart.
  it("the deep-link Turbo override is not persisted", async () => {
    setMobileViewport(true)
    vi.stubGlobal("fetch", mockSearchFetch())
    render(<HomeClient initialCity="Berlin" initialCategory="theater" />)
    await waitFor(() => expect(screen.queryByText(quickstartMarker)).not.toBeInTheDocument())
    const stored = localStorage.getItem("ap_settings")
    expect(stored == null || JSON.parse(stored).simpleView !== false).toBe(true)
  })

  // A category that IS one of Quickstart's tiles maps cleanly onto its
  // results screen, so the link must stay in Quickstart rather than ejecting
  // a first-time user into the full UI — the exact audience the reduced
  // layout exists for.
  it("a city/category deep link within Quickstart's tiles opens its results screen", async () => {
    setMobileViewport(true)
    vi.stubGlobal("fetch", mockSearchFetch())
    render(<HomeClient initialCity="Berlin" initialCategory="cafe" />)
    // Quickstart's own results header, naming both the category and the city.
    expect(await screen.findByText("Cafés & Eis in Berlin")).toBeInTheDocument()
  })

  // Quickstart hides places with unknown entrance data on purpose — its plain
  // yes/limited/no sentences cannot express "unknown". An SEO arrival must
  // therefore search with that same preset, not the full UI's live filters.
  it("a Quickstart city/category arrival searches with Quickstart's fixed filter preset", async () => {
    setMobileViewport(true)
    const fetchMock = mockSearchFetch()
    vi.stubGlobal("fetch", fetchMock)
    render(<HomeClient initialCity="Berlin" initialCategory="cafe" />)
    await screen.findByText("Cafés & Eis in Berlin")

    const body = lastSearchRequestBody(fetchMock) as unknown as {
      filters?: { entrance?: boolean; acceptUnknown?: boolean }
    }
    expect(body.filters?.entrance).toBe(true)
    expect(body.filters?.acceptUnknown).toBe(false)
  })

  // A link to one specific place IS representable in Quickstart (its detail
  // screen), so it must not eject a Quickstart user into the full UI.
  it("a place deep link stays in Quickstart for a fresh mobile install", async () => {
    setMobileViewport(true)
    vi.stubGlobal("fetch", mockSearchFetch())
    render(<HomeClient initialSelectLat={52.5} initialSelectLon={13.4} initialSelectName="Café Beispiel" />)
    expect(await screen.findByText(quickstartMarker)).toBeInTheDocument()
  })
})

// ─── Regressions around the mode resolution's two stateful inputs ─────────
describe("HomeClient — mode resolution stays stable across a session", () => {
  afterEach(() => setMobileViewport(false))

  // The "has used the app before" signal is snapshotted once per tab session,
  // NOT re-read per mount. HomeClient remounts on an in-app navigation (FAQ →
  // "Zurück"), and by then this session's own first search has already set
  // ap_visited — re-deriving the signal there would silently throw an active
  // Quickstart user into the full UI mid-browsing.
  it("a remount after this session's own first search stays in Quickstart", async () => {
    setMobileViewport(true)
    vi.stubGlobal("fetch", mockSearchFetch())

    const first = render(<HomeClient />)
    expect(await screen.findByText(quickstartMarker)).toBeInTheDocument()
    // Whatever the user does next marks the app as visited.
    localStorage.setItem("ap_visited", "1")
    first.unmount()

    render(<HomeClient />)
    expect(await screen.findByText(quickstartMarker)).toBeInTheDocument()
  })

  // A device that genuinely used the app in an EARLIER session is a different
  // case and must still keep the full UI it is used to.
  it("a brand-new tab for a device that used the app earlier starts in Turbo", async () => {
    setMobileViewport(true)
    localStorage.setItem("ap_visited", "1")
    sessionStorage.clear()  // a new tab has no snapshot yet
    vi.stubGlobal("fetch", mockSearchFetch())

    render(<HomeClient />)
    await waitFor(() => expect(screen.queryByText(quickstartMarker)).not.toBeInTheDocument())
  })

  // A link whose place never showed up (search returned nothing) must not sit
  // around and later hijack an unrelated search that happens to return a
  // result near the same coordinates.
  it("starting a new Quickstart search abandons an unresolved deep-link target", async () => {
    setMobileViewport(true)
    mockGetBestPosition.mockResolvedValue({ lat: 52.5, lon: 13.4 })
    vi.stubGlobal("fetch", mockSearchFetch())  // every search resolves with zero places

    render(<HomeClient initialSelectLat={52.5} initialSelectLon={13.4} initialSelectName="Café Beispiel" />)
    // The deep-link search found nothing, so the user is left on the start screen.
    expect(await screen.findByText(quickstartMarker)).toBeInTheDocument()

    // They now start something of their own; the stale target must be gone, so
    // this lands on the results screen rather than a hijacked detail screen.
    fireEvent.click(screen.getByText("In meiner Nähe suchen"))
    fireEvent.click(await screen.findByText("Cafés & Eis"))
    await waitFor(() => expect(screen.getByText("Cafés & Eis in Deiner Nähe")).toBeInTheDocument())
  })
})
