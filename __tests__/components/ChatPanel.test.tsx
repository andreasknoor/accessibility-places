import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, within } from "@testing-library/react"
import ChatPanel, { CHIP_GROUPS } from "@/components/chat/ChatPanel"
import { ALL_CATEGORIES, inferCategories } from "@/lib/llm"
import de from "@/lib/i18n/de"

vi.mock("@/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n")>()
  const de = (await import("@/lib/i18n/de")).default
  return {
    ...actual,
    useTranslations: () => de,
    useLocale: () => ({ locale: "de", setLocale: vi.fn() }),
  }
})

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }))

type MockSuggestion = {
  kind: "area" | "venue"
  display: string
  name: string
  lat: number | null
  lon: number | null
  osmKey: string | null
  osmValue: string | null
}

function area(name: string, display = name): MockSuggestion {
  return { kind: "area", display, name, lat: 52.5, lon: 13.4, osmKey: "place", osmValue: "city" }
}

function venue(name: string, display = name, coords: { lat: number | null; lon: number | null } = { lat: 51.54, lon: 6.42 }): MockSuggestion {
  return { kind: "venue", display, name, ...coords, osmKey: "amenity", osmValue: "pub" }
}

function renderPanel(onSearch = vi.fn(), isLoading = false, onPlaceSearch = vi.fn()) {
  return render(<ChatPanel onSearch={onSearch} onPlaceSearch={onPlaceSearch} isLoading={isLoading} initialMode="text" />)
}

// Drill-in category chips (Konzept A): leaf category chips (e.g. "Hotels")
// only render once their group ("Unterkunft") is open. Opens the group by
// clicking its level-1 chip — this also selects the whole group as a
// side effect (openGroupChip), same as a real user tap.
function openChipGroup(groupText: string) {
  const group = screen.getAllByRole("radio").find((b) => b.textContent?.includes(groupText))!
  fireEvent.click(group)
  return group
}

function closeChipGroup() {
  fireEvent.click(screen.getByRole("button", { name: "Zurück" }))
}

function mockFetch(suggestions: MockSuggestion[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(suggestions), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  )
}

function getInput() {
  // By role, not placeholder — the placeholder switches to the short "… oder
  // Ort eintippen" variant while the GPS location token occupies the field.
  return screen.getByRole("combobox") as HTMLInputElement
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ─── Autocomplete trigger ────────────────────────────────────────────────────

describe("ChatPanel autocomplete — trigger", () => {
  it("does not fetch for input shorter than 2 chars", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "B" } })
    await act(() => vi.runAllTimersAsync())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fetches unified suggestions after 300 ms debounce for 2+ char input", async () => {
    mockFetch([area("Berlin")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Be" } })
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining("unified-suggest?q=Be"),
      expect.any(Object),
    )
  })

  it("does not fetch before the debounce delay elapses", async () => {
    mockFetch([])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it("only fires one fetch for rapid successive keystrokes", async () => {
    mockFetch([area("Berlin")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Be" } })
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    fireEvent.change(getInput(), { target: { value: "Berl" } })
    await act(() => vi.runAllTimersAsync())
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it("clears fetched suggestions but keeps the dropdown open (freetext row) when input drops below 2 chars", async () => {
    mockFetch([area("Berlin")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    await act(() => vi.runAllTimersAsync())
    expect(screen.getByRole("option", { name: "Berlin" })).toBeInTheDocument()

    fireEvent.change(getInput(), { target: { value: "B" } })
    await act(() => vi.runAllTimersAsync())
    // The fetched suggestion is gone …
    expect(screen.queryByRole("option", { name: "Berlin" })).not.toBeInTheDocument()
    // … but the dropdown itself stays open: the always-present freetext row
    // ("search for B") is a mouse/touch user's only way to trigger a search,
    // and must not disappear just because the suggest API has nothing to show.
    expect(screen.getByRole("listbox")).toBeInTheDocument()
  })
})

// ─── Dropdown rendering (grouped) ────────────────────────────────────────────

describe("ChatPanel autocomplete — grouped dropdown", () => {
  it("shows the areas group header for area suggestions", async () => {
    mockFetch([area("Berlin"), area("Bernau", "Bernau, Brandenburg (DE)")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    expect(screen.getByText("Orte")).toBeInTheDocument()
    expect(screen.queryByText("Lokationen")).not.toBeInTheDocument()
  })

  it("shows the venues group header for venue suggestions", async () => {
    mockFetch([venue("Bierpumpe", "Bierpumpe, Issum (DE)")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Bier" } })
    await act(() => vi.runAllTimersAsync())
    expect(screen.getByText("Lokationen")).toBeInTheDocument()
    expect(screen.queryByText("Orte")).not.toBeInTheDocument()
  })

  it("shows both group headers, areas first, for mixed results", async () => {
    mockFetch([area("Essen"), venue("Restaurant Essen", "Restaurant Essen, Bochum (DE)")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Essen" } })
    await act(() => vi.runAllTimersAsync())
    const headers = [screen.getByText("Orte"), screen.getByText("Lokationen")]
    expect(headers[0].compareDocumentPosition(headers[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // headers are not selectable options — 3 = the always-present freetext row + 1 area + 1 venue
    expect(screen.getAllByRole("option")).toHaveLength(3)
  })

  it("shows only the freetext row (no group headers) when the API returns empty array", async () => {
    mockFetch([])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "xyz" } })
    await act(() => vi.runAllTimersAsync())
    // The dropdown itself is NOT hidden — an empty suggest result must not remove
    // the only mouse/touch-reachable way to trigger a search (no-submit-button redesign).
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /xyz/ })).toBeInTheDocument()
    expect(screen.queryByText("Orte")).not.toBeInTheDocument()
    expect(screen.queryByText("Lokationen")).not.toBeInTheDocument()
  })

  it("shows only the freetext row when the API request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")))
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /Ber/ })).toBeInTheDocument()
    expect(screen.queryByText("Orte")).not.toBeInTheDocument()
  })

  it("hides dropdown on Escape", async () => {
    mockFetch([area("Berlin")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())
    expect(screen.getByRole("listbox")).toBeInTheDocument()

    fireEvent.keyDown(getInput(), { key: "Escape" })
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })
})

// ─── Area pill rail (Konzept C) ──────────────────────────────────────────────
// Areas render as a horizontal pill rail (<button>, wrapped in a labelled
// role="group") instead of vertical <li> rows shared with venues — a
// structurally different shape, not just a different color/icon, so a venue
// whose OSM name happens to read like a place (e.g. a railway station
// literally named "Berlin-Charlottenburg") can no longer be mistaken for the
// district itself. See docs/plans (issue: unified-suggest area/venue mixup).

describe("ChatPanel autocomplete — area pill rail (Konzept C)", () => {
  it("renders each area suggestion as a <button>, not a <li>", async () => {
    mockFetch([area("Berlin")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())

    const option = screen.getByRole("option", { name: "Berlin" })
    expect(option.tagName).toBe("BUTTON")
  })

  it("renders each venue suggestion as a <li>, a different element than area pills", async () => {
    mockFetch([venue("Bierpumpe", "Bierpumpe, Issum (DE)")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Bier" } })
    await act(() => vi.runAllTimersAsync())

    const option = screen.getByRole("option", { name: /Bierpumpe/ })
    expect(option.tagName).toBe("LI")
  })

  it("groups all area pills under a single element labelled by the 'Orte' heading", async () => {
    mockFetch([
      area("Charlottenburg", "Charlottenburg, Berlin (DE)"),
      area("Charlottenburg-Wilmersdorf", "Charlottenburg-Wilmersdorf, Berlin (DE)"),
      area("Charlottenburg-Nord", "Charlottenburg-Nord, Berlin (DE)"),
    ])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Berlin Char" } })
    await act(() => vi.runAllTimersAsync())

    const group = screen.getByRole("group", { name: "Orte" })
    const pills = within(group).getAllByRole("option")
    expect(pills).toHaveLength(3)
    expect(pills.map((p) => p.textContent)).toEqual([
      "Charlottenburg, Berlin (DE)",
      "Charlottenburg-Wilmersdorf, Berlin (DE)",
      "Charlottenburg-Nord, Berlin (DE)",
    ])
  })

  it("does not render an area group when there are no area suggestions", async () => {
    mockFetch([venue("Bierpumpe", "Bierpumpe, Issum (DE)")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Bier" } })
    await act(() => vi.runAllTimersAsync())

    expect(screen.queryByRole("group", { name: "Orte" })).not.toBeInTheDocument()
  })

  it("keeps the venues list outside the area group", async () => {
    mockFetch([area("Essen"), venue("Restaurant Essen", "Restaurant Essen, Bochum (DE)")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Essen" } })
    await act(() => vi.runAllTimersAsync())

    const group = screen.getByRole("group", { name: "Orte" })
    expect(within(group).queryByText(/Restaurant Essen/)).not.toBeInTheDocument()
    expect(screen.getByRole("option", { name: /Restaurant Essen/ })).toBeInTheDocument()
  })

  it("each area pill carries a hidden icon distinguishing it visually from venue rows", async () => {
    mockFetch([area("Berlin")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())

    const pill = screen.getByRole("option", { name: "Berlin" })
    expect(pill.querySelector("svg[aria-hidden]")).toBeInTheDocument()
  })

  it("keyboard ArrowDown steps through every area pill before reaching the first venue", async () => {
    mockFetch([
      area("Charlottenburg", "Charlottenburg, Berlin (DE)"),
      area("Charlottenburg-Nord", "Charlottenburg-Nord, Berlin (DE)"),
      venue("Berlin-Charlottenburg", "Berlin-Charlottenburg, Berlin (DE)"),
    ])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Berlin Char" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    expect(screen.getByRole("option", { name: "Charlottenburg, Berlin (DE)" })).toHaveAttribute("aria-selected", "true")

    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    expect(screen.getByRole("option", { name: "Charlottenburg-Nord, Berlin (DE)" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("option", { name: "Charlottenburg, Berlin (DE)" })).toHaveAttribute("aria-selected", "false")

    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    expect(screen.getByRole("option", { name: /Berlin-Charlottenburg/ })).toHaveAttribute("aria-selected", "true")
  })

  it("aria-activedescendant follows highlight from an area pill to a venue row", async () => {
    mockFetch([area("Charlottenburg", "Charlottenburg, Berlin (DE)"), venue("Bierpumpe", "Bierpumpe, Issum (DE)")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Char" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    expect(getInput()).toHaveAttribute("aria-activedescendant", "unified-opt-0")
    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    expect(getInput()).toHaveAttribute("aria-activedescendant", "unified-opt-1")
  })

  it("clicking a non-first area pill selects that specific area, not the first one", async () => {
    const onSearch = vi.fn()
    mockFetch([
      area("Charlottenburg", "Charlottenburg, Berlin (DE)"),
      area("Charlottenburg-Nord", "Charlottenburg-Nord, Berlin (DE)"),
    ])
    renderPanel(onSearch)
    fireEvent.change(getInput(), { target: { value: "Berlin Char" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.mouseDown(screen.getByRole("option", { name: "Charlottenburg-Nord, Berlin (DE)" }))
    expect(getInput().value).toBe("Charlottenburg-Nord, Berlin (DE)")
    expect(onSearch).toHaveBeenCalledWith(expect.stringContaining("Charlottenburg-Nord, Berlin (DE)"), undefined, undefined)
  })

  it("Enter on a highlighted area pill (not just the first) selects the highlighted one", async () => {
    const onSearch = vi.fn()
    mockFetch([
      area("Charlottenburg", "Charlottenburg, Berlin (DE)"),
      area("Charlottenburg-Nord", "Charlottenburg-Nord, Berlin (DE)"),
    ])
    renderPanel(onSearch)
    fireEvent.change(getInput(), { target: { value: "Berlin Char" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    fireEvent.keyDown(getInput(), { key: "Enter" })

    expect(onSearch).toHaveBeenCalledWith(expect.stringContaining("Charlottenburg-Nord, Berlin (DE)"), undefined, undefined)
  })

  it("a venue whose display string reads like a place still renders as a list row, not a pill", async () => {
    // Regression guard for the exact bug report: a railway station literally
    // named "Berlin-Charlottenburg" must not visually resemble the district.
    mockFetch([
      area("Charlottenburg", "Charlottenburg, Berlin (DE)"),
      venue("Berlin-Charlottenburg", "Berlin-Charlottenburg, Berlin (DE)"),
    ])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Berlin Char" } })
    await act(() => vi.runAllTimersAsync())

    const stationOption = screen.getByRole("option", { name: "Berlin-Charlottenburg, Berlin (DE)" })
    const districtOption = screen.getByRole("option", { name: "Charlottenburg, Berlin (DE)" })
    expect(stationOption.tagName).toBe("LI")
    expect(districtOption.tagName).toBe("BUTTON")
    expect(stationOption.closest('[role="group"]')).toBeNull()
    expect(districtOption.closest('[role="group"]')).not.toBeNull()
  })
})

// ─── Keyboard navigation (flat index across groups) ─────────────────────────

describe("ChatPanel autocomplete — keyboard navigation", () => {
  it("ArrowDown highlights first item", async () => {
    mockFetch([area("Berlin")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    const option = screen.getByRole("option", { name: "Berlin" })
    expect(option).toHaveAttribute("aria-selected", "true")
  })

  it("ArrowDown crosses from the areas group into the venues group", async () => {
    mockFetch([area("Essen"), venue("Bierpumpe", "Bierpumpe, Issum (DE)")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Essen" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    const venueOpt = screen.getByRole("option", { name: /Bierpumpe/ })
    expect(venueOpt).toHaveAttribute("aria-selected", "true")
  })

  it("ArrowUp after ArrowDown moves highlight back", async () => {
    mockFetch([area("Berlin"), area("Hamburg")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    fireEvent.keyDown(getInput(), { key: "ArrowUp" })
    const first = screen.getByRole("option", { name: "Berlin" })
    expect(first).toHaveAttribute("aria-selected", "true")
  })

  it("sets aria-activedescendant on the input while navigating", async () => {
    mockFetch([area("Berlin")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    expect(getInput()).toHaveAttribute("aria-activedescendant", "unified-opt-0")
  })

  it("Enter with highlighted area selects it and fires onSearch", async () => {
    const onSearch = vi.fn()
    mockFetch([area("Berlin")])
    renderPanel(onSearch)
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    fireEvent.keyDown(getInput(), { key: "Enter" })

    expect(onSearch).toHaveBeenCalledWith(expect.stringContaining("Berlin"), undefined, undefined)
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("Enter without highlighted item submits the raw input as area search", async () => {
    const onSearch = vi.fn()
    const onPlaceSearch = vi.fn()
    mockFetch([area("Berlin"), venue("Berliner Kindl")])
    renderPanel(onSearch, false, onPlaceSearch)
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.keyDown(getInput(), { key: "Enter" })
    expect(onSearch).toHaveBeenCalledWith(expect.stringContaining("Berlin"), undefined, undefined)
    expect(onPlaceSearch).not.toHaveBeenCalled()
  })
})

// ─── Suggestion selection ────────────────────────────────────────────────────

describe("ChatPanel autocomplete — selection", () => {
  it("clicking an area suggestion sets the input value and triggers onSearch", async () => {
    const onSearch = vi.fn()
    mockFetch([area("Mitte", "Mitte, Berlin")])
    renderPanel(onSearch)
    fireEvent.change(getInput(), { target: { value: "Mit" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.mouseDown(screen.getByRole("option", { name: "Mitte, Berlin" }))
    expect(getInput().value).toBe("Mitte, Berlin")
    expect(onSearch).toHaveBeenCalledWith(expect.stringContaining("Mitte, Berlin"), undefined, undefined)
  })

  it("clicking a venue suggestion triggers onPlaceSearch with name and coords", async () => {
    const onSearch = vi.fn()
    const onPlaceSearch = vi.fn()
    mockFetch([venue("Bierpumpe", "Bierpumpe, Issum (DE)", { lat: 51.54, lon: 6.42 })])
    renderPanel(onSearch, false, onPlaceSearch)
    fireEvent.change(getInput(), { target: { value: "Bierpumpe Issum" } })
    await act(() => vi.runAllTimersAsync())

    // Exact display string, not a /Bierpumpe/ regex: the always-present freetext
    // row's label ("Nach „Bierpumpe…" suchen") also contains "Bierpumpe" and
    // would otherwise match too, causing a "multiple elements found" failure.
    fireEvent.mouseDown(screen.getByRole("option", { name: "Bierpumpe, Issum (DE)" }))
    expect(onPlaceSearch).toHaveBeenCalledWith("Bierpumpe", { lat: 51.54, lon: 6.42 })
    expect(onSearch).not.toHaveBeenCalled()
    expect(getInput().value).toBe("Bierpumpe, Issum (DE)")
  })

  it("venue pick without coordinates calls onPlaceSearch without coords", async () => {
    const onPlaceSearch = vi.fn()
    mockFetch([venue("Bierpumpe", "Bierpumpe, Issum (DE)", { lat: null, lon: null })])
    renderPanel(vi.fn(), false, onPlaceSearch)
    fireEvent.change(getInput(), { target: { value: "Bierpumpe" } })
    await act(() => vi.runAllTimersAsync())

    // Exact display string, not a /Bierpumpe/ regex: the always-present freetext
    // row's label ("Nach „Bierpumpe…" suchen") also contains "Bierpumpe" and
    // would otherwise match too, causing a "multiple elements found" failure.
    fireEvent.mouseDown(screen.getByRole("option", { name: "Bierpumpe, Issum (DE)" }))
    expect(onPlaceSearch).toHaveBeenCalledWith("Bierpumpe", undefined)
  })

  it("Enter after a venue pick re-runs the place search", async () => {
    const onPlaceSearch = vi.fn()
    mockFetch([venue("Bierpumpe", "Bierpumpe, Issum (DE)", { lat: 51.54, lon: 6.42 })])
    renderPanel(vi.fn(), false, onPlaceSearch)
    fireEvent.change(getInput(), { target: { value: "Bierpumpe" } })
    await act(() => vi.runAllTimersAsync())
    // Exact display string, not a /Bierpumpe/ regex: the always-present freetext
    // row's label ("Nach „Bierpumpe…" suchen") also contains "Bierpumpe" and
    // would otherwise match too, causing a "multiple elements found" failure.
    fireEvent.mouseDown(screen.getByRole("option", { name: "Bierpumpe, Issum (DE)" }))
    expect(onPlaceSearch).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(getInput(), { key: "Enter" })
    expect(onPlaceSearch).toHaveBeenCalledTimes(2)
    expect(onPlaceSearch).toHaveBeenLastCalledWith("Bierpumpe", { lat: 51.54, lon: 6.42 })
  })

  it("closes the dropdown after selecting a suggestion", async () => {
    mockFetch([area("Berlin")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.mouseDown(screen.getByRole("option", { name: "Berlin" }))
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("does not re-open the dropdown after selection even after debounce fires", async () => {
    // Regression: selecting a suggestion triggers setLocation which used to re-fetch
    // and call setShowSuggestions(true) 300 ms later (visible bug on iPhone).
    mockFetch([area("Berlin")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.mouseDown(screen.getByRole("option", { name: "Berlin" }))
    // Advance past debounce — must NOT re-open
    await act(() => vi.advanceTimersByTimeAsync(500))
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("keeps category chips clickable after a venue pick; a chip click exits venue mode and runs a category search around the venue", async () => {
    const onSearch = vi.fn()
    const onPlaceSearch = vi.fn()
    mockFetch([venue("Bierpumpe", "Bierpumpe, Issum (DE)")])
    // activeSearchCoords mirrors what the parent sets to the venue coords after a place search.
    render(
      <ChatPanel
        onSearch={onSearch}
        onPlaceSearch={onPlaceSearch}
        isLoading={false}
        initialMode="text"
        activeSearchCoords={{ lat: 51.54, lon: 6.42 }}
      />,
    )
    fireEvent.change(getInput(), { target: { value: "Bierpumpe" } })
    await act(() => vi.runAllTimersAsync())
    // Exact display string, not a /Bierpumpe/ regex: the always-present freetext
    // row's label ("Nach „Bierpumpe…" suchen") also contains "Bierpumpe" and
    // would otherwise match too, causing a "multiple elements found" failure.
    fireEvent.mouseDown(screen.getByRole("option", { name: "Bierpumpe, Issum (DE)" }))
    expect(onPlaceSearch).toHaveBeenCalledWith("Bierpumpe", { lat: 51.54, lon: 6.42 })

    openChipGroup("Gastronomie")
    const chip = screen.getAllByRole("radio").find((b) => b.textContent?.includes("Restaurants"))!
    // Chips stay enabled — they are the escape hatch out of the venue lookup.
    expect(chip).not.toBeDisabled()

    fireEvent.click(chip)
    // Clicking the chip runs a coordinate-based category search at the venue location…
    expect(onSearch).toHaveBeenCalledWith(expect.stringMatching(/Restaurant/), { lat: 51.54, lon: 6.42 })
    // …and does NOT re-open the autocomplete dropdown.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })
})

// ─── Quoted name filter (single-field replacement for the old name input) ────

describe("ChatPanel quoted-name syntax", () => {
  it("does not send the quoted part to the suggest API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    renderPanel()
    fireEvent.change(getInput(), { target: { value: '"Goldener Löwe" Ber' } })
    await act(() => vi.runAllTimersAsync())

    const calledUrl: string = fetchMock.mock.calls[0][0]
    expect(calledUrl).toContain("q=Ber")
    expect(calledUrl).not.toContain("Goldener")
  })

  it("passes the quoted name as nameHint on submit", async () => {
    const onSearch = vi.fn()
    mockFetch([])
    renderPanel(onSearch)
    fireEvent.change(getInput(), { target: { value: '"Goldener Löwe" Berlin' } })
    fireEvent.keyDown(getInput(), { key: "Enter" })
    expect(onSearch).toHaveBeenCalledWith(expect.stringContaining("Berlin"), undefined, "Goldener Löwe")
  })

  it("a quoted name without location triggers onPlaceSearch", async () => {
    const onSearch = vi.fn()
    const onPlaceSearch = vi.fn()
    mockFetch([])
    renderPanel(onSearch, false, onPlaceSearch)
    fireEvent.change(getInput(), { target: { value: '"Bierpumpe"' } })
    fireEvent.keyDown(getInput(), { key: "Enter" })
    expect(onPlaceSearch).toHaveBeenCalledWith("Bierpumpe")
    expect(onSearch).not.toHaveBeenCalled()
  })

  it("preserves the quoted name when picking an area suggestion", async () => {
    const onSearch = vi.fn()
    mockFetch([area("Berlin", "Berlin (DE)")])
    renderPanel(onSearch)
    fireEvent.change(getInput(), { target: { value: '"Goldener Löwe" Ber' } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.mouseDown(screen.getByRole("option", { name: "Berlin (DE)" }))
    expect(getInput().value).toBe('"Goldener Löwe" in Berlin (DE)')
    expect(onSearch).toHaveBeenCalledWith(expect.stringContaining("Berlin (DE)"), undefined, "Goldener Löwe")
  })

  it("does not produce a double 'in' when submitting after an area pick with quotes", async () => {
    const onSearch = vi.fn()
    mockFetch([])
    renderPanel(onSearch)
    fireEvent.change(getInput(), { target: { value: '"Goldener Löwe" in Berlin' } })
    fireEvent.keyDown(getInput(), { key: "Enter" })
    const query: string = onSearch.mock.calls[0][0]
    expect(query).not.toMatch(/in\s+in/)
  })
})

// ─── Clear button ────────────────────────────────────────────────────────────

describe("ChatPanel clear button", () => {
  it("is hidden when input is empty", () => {
    renderPanel()
    expect(screen.queryByRole("button", { name: /Eingabe löschen/ })).not.toBeInTheDocument()
  })

  it("appears when input has text", () => {
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    expect(screen.getByRole("button", { name: /Eingabe löschen/ })).toBeInTheDocument()
  })

  it("clears the input and closes the dropdown on click", async () => {
    mockFetch([area("Berlin")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.mouseDown(screen.getByRole("button", { name: /Eingabe löschen/ }))
    expect(getInput().value).toBe("")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Eingabe löschen/ })).not.toBeInTheDocument()
  })
})

// ─── Location token in the field (search-row variant B) ─────────────────────

// Simulates the map's own locate button resolving a district — the inline ⌖
// search-row action is gone, so mapLocateFix/mapLocateFixKey (bumped by the
// parent once HomeClient.handleLocate's background reverse-geocode resolves)
// is now the only path that populates nearbyPhase WITHOUT running a search.
// See docs/plans/remove-nearby-button-from-search-row.md.
function simulateMapLocateFix(
  rerender: (ui: React.ReactElement) => void,
  baseProps: React.ComponentProps<typeof ChatPanel>,
  lat: number, lon: number, district: string,
) {
  rerender(<ChatPanel {...baseProps} mapLocateFix={{ lat, lon, district }} mapLocateFixKey={1} />)
}

describe("ChatPanel location token (search-row variant B)", () => {
  it("shows the district as a visible token after a locate; its ✕ clears the fix", () => {
    const baseProps = { onSearch: vi.fn(), isLoading: false, initialMode: "text" as const }
    const { rerender } = render(<ChatPanel {...baseProps} />)
    simulateMapLocateFix(rerender, baseProps, 48.14, 11.56, "Maxvorstadt")
    expect(screen.getByText(/Maxvorstadt/)).toBeInTheDocument()

    // ✕ on the token drops the fix.
    fireEvent.click(screen.getByRole("button", { name: "Standort entfernen" }))
    expect(screen.queryByText(/Maxvorstadt/)).not.toBeInTheDocument()
  })

  it("typing hides the token WITHOUT dropping the fix; clearing the text brings it back", () => {
    const baseProps = { onSearch: vi.fn(), isLoading: false, initialMode: "text" as const }
    const { rerender } = render(<ChatPanel {...baseProps} />)
    simulateMapLocateFix(rerender, baseProps, 48.14, 11.56, "Maxvorstadt")
    expect(screen.getByText(/Maxvorstadt/)).toBeInTheDocument()

    // Typing: token steps back visually (same reversible pattern as panPending) …
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    expect(screen.queryByText(/Maxvorstadt/)).not.toBeInTheDocument()

    // … and returns when the text is cleared — the fix was never dropped.
    fireEvent.mouseDown(screen.getByRole("button", { name: /Eingabe löschen/ }))
    expect(screen.getByText(/Maxvorstadt/)).toBeInTheDocument()
  })

  it("Enter on an empty field with an active fix re-runs the nearby search (no-submit-button redesign)", () => {
    const onSearch = vi.fn()
    const baseProps = { onSearch, isLoading: false, initialMode: "text" as const }
    const { rerender } = render(<ChatPanel {...baseProps} />)
    simulateMapLocateFix(rerender, baseProps, 48.14, 11.56, "Maxvorstadt")

    fireEvent.keyDown(getInput(), { key: "Enter" })
    expect(onSearch).toHaveBeenCalledWith("in Maxvorstadt", { lat: 48.14, lon: 11.56 })
  })

  it("the location token itself is a Tab-focusable/clickable button that re-runs the nearby search — not just reachable via Enter", () => {
    const onSearch = vi.fn()
    const baseProps = { onSearch, isLoading: false, initialMode: "text" as const }
    const { rerender } = render(<ChatPanel {...baseProps} />)
    simulateMapLocateFix(rerender, baseProps, 48.14, 11.56, "Maxvorstadt")

    // The token's label (not its ✕) is its own accessible, clickable control —
    // distinct from "Standort entfernen" (the ✕).
    fireEvent.click(screen.getByRole("button", { name: "Suche um Maxvorstadt" }))
    expect(onSearch).toHaveBeenCalledWith("in Maxvorstadt", { lat: 48.14, lon: 11.56 })
  })
})

// ─── initialChipCat / defaultChipCat restore ────────────────────────────────

describe("ChatPanel initialChipCat restore", () => {
  it("selects the chip for initialChipCat when no saved last-search exists", () => {
    localStorage.clear()
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" initialChipCat="hotel" />)
    const buttons = screen.getAllByRole("radio")
    const hotelChip = buttons.find((b) => b.textContent?.includes("Hotels"))
    expect(hotelChip).toBeDefined()
    expect(hotelChip).toHaveClass("bg-primary")
  })

  it("saved last-search chip overrides initialChipCat (legacy {idx} payload still migrates)", () => {
    // Legacy positional payload: idx 1 = old "Cafés" chip → migrates to cat "cafe".
    localStorage.setItem("ap_last_search", JSON.stringify({ idx: 1, loc: "Berlin" }))
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" initialChipCat="hotel" />)
    const buttons = screen.getAllByRole("radio")
    // cafe is selected → its group chip ("Gastronomie") shows the composite
    // label and is active; hotel is not selected → its group chip
    // ("Unterkunft") stays plain and inactive (Hotels only appears once
    // opened, which is exactly what "not selected" means here).
    const cafeChip  = buttons.find((b) => b.textContent?.includes("Cafés"))
    const stayChip  = buttons.find((b) => b.textContent?.includes("Unterkunft"))
    expect(cafeChip).toHaveClass("bg-primary")
    expect(stayChip).not.toHaveClass("bg-primary")
  })

  it("falls back to initialChipCat when saved idx is invalid", () => {
    localStorage.setItem("ap_last_search", JSON.stringify({ idx: 999, loc: "Berlin" }))
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" initialChipCat="biergarten" />)
    const buttons = screen.getAllByRole("radio")
    const biergartChip = buttons.find((b) => b.textContent?.includes("Biergärten"))
    expect(biergartChip).toHaveClass("bg-primary")
  })

  it("defaults to the 'Alle' chip (all categories) when neither saved search nor initialChipCat exist", () => {
    localStorage.clear()
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    const buttons = screen.getAllByRole("radio")
    const alleChip  = buttons.find((b) => b.textContent?.includes("Alle"))
    const gastroChip = buttons.find((b) => b.textContent?.includes("Gastronomie"))
    expect(alleChip).toHaveClass("bg-primary")
    expect(gastroChip).not.toHaveClass("bg-primary")
  })

  it("restores a saved null chip ('Alle') without falling back to a category", () => {
    localStorage.setItem("ap_last_search", JSON.stringify({ cat: null, loc: "Berlin" }))
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" initialChipCat="hotel" />)
    const buttons = screen.getAllByRole("radio")
    const alleChip = buttons.find((b) => b.textContent?.includes("Alle"))
    expect(alleChip).toHaveClass("bg-primary")
  })
})

// ─── All-categories default (chips as optional quick-fills) ──────────────────

describe("ChatPanel all-categories chip", () => {
  it("clicking a category chip and then 'Alle' returns to the all-categories state", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    openChipGroup("Unterkunft")
    const hotelChip = screen.getAllByRole("radio").find((b) => b.textContent?.includes("Hotels"))!
    fireEvent.click(hotelChip)
    expect(hotelChip).toHaveClass("bg-primary")

    // "Alle" only lives on the collapsed (level-1) row — back out first.
    closeChipGroup()
    const stayChip = screen.getAllByRole("radio").find((b) => b.textContent?.includes("Unterkunft"))!
    const alleChip = screen.getAllByRole("radio").find((b) => b.textContent?.includes("Alle"))!
    expect(stayChip).toHaveClass("bg-primary")
    expect(alleChip).not.toHaveClass("bg-primary")

    fireEvent.click(alleChip)
    expect(alleChip).toHaveClass("bg-primary")
    expect(stayChip).not.toHaveClass("bg-primary")
  })

  it("submit with 'Alle' sends the raw text without a chip-label prefix", () => {
    const onSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "Sushi in Berlin" } })
    fireEvent.keyDown(getInput(), { key: "Enter" })
    expect(onSearch).toHaveBeenCalledWith("Sushi in Berlin", undefined, undefined)
  })

  it("submit with a selected chip prefixes the chip label", () => {
    const onSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} isLoading={false} initialMode="text" />)
    openChipGroup("Unterkunft")
    const hotelChip = screen.getAllByRole("radio").find((b) => b.textContent?.includes("Hotels"))!
    fireEvent.click(hotelChip)
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    fireEvent.keyDown(getInput(), { key: "Enter" })
    expect(onSearch).toHaveBeenCalledWith("Hotels in Berlin", undefined, undefined)
  })

  it("submit with a chip but 'in'-structured text sends the raw text (typed query wins)", () => {
    // "Arztpraxen in Arzt in Frankenthal" would make parseQuery geocode
    // "Arzt in Frankenthal" as the location → 'location not found'.
    const onSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} isLoading={false} initialMode="text" />)
    openChipGroup("Unterkunft")
    const hotelChip = screen.getAllByRole("radio").find((b) => b.textContent?.includes("Hotels"))!
    fireEvent.click(hotelChip)
    fireEvent.change(getInput(), { target: { value: "Arzt in Frankenthal" } })
    fireEvent.keyDown(getInput(), { key: "Enter" })
    expect(onSearch).toHaveBeenCalledWith("Arzt in Frankenthal", undefined, undefined)
  })

  it("area pick with 'Alle' sends 'in <display>' so city names never become category hints", async () => {
    const onSearch = vi.fn()
    mockFetch([area("Essen", "Essen (DE)")])
    renderPanel(onSearch)
    fireEvent.change(getInput(), { target: { value: "Essen" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.mouseDown(screen.getByRole("option", { name: "Essen (DE)" }))
    expect(onSearch).toHaveBeenCalledWith("in Essen (DE)", undefined, undefined)
  })

  it("clicking 'Alle' with a filled location re-fires the search as 'in <location>'", () => {
    const onSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    const alleChip = screen.getAllByRole("radio").find((b) => b.textContent?.includes("Alle"))!
    fireEvent.click(alleChip)
    expect(onSearch).toHaveBeenCalledWith("in Berlin", undefined, undefined)
  })
})

// ─── initialMode ─────────────────────────────────────────────────────────────

describe("ChatPanel initialMode", () => {
  it("renders no mode tabs, but does render the freestanding nearby-search button (search row has no submit action, issue #28; nearby button reintroduced v10.1)", () => {
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(), clearWatch: vi.fn() }, clipboard: navigator.clipboard })
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} />)
    // The old top-level "Überall" mode tab no longer exists.
    expect(screen.queryByText("Überall")).not.toBeInTheDocument()
    // The freestanding circular nearby button (right of the field) DOES exist —
    // reintroduced in v10.1 after v9.72 removed the docked inline ⌖, which read
    // as part of the field rather than a separate control. This one is visually
    // separated (gap + circle + primary fill) instead of docked.
    expect(screen.getByRole("button", { name: "In der Nähe suchen" })).toBeInTheDocument()
  })

  it("calls geolocation.getCurrentPosition on mount when initialMode is not passed (returning visitor)", () => {
    localStorage.setItem("ap_visited", "1")   // not a first-time visitor → auto-locate is appropriate
    const getCurrentPosition = vi.fn()
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition }, clipboard: navigator.clipboard })
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} />)
    expect(getCurrentPosition).toHaveBeenCalledOnce()
  })

  it("does NOT auto-locate on mount for a first-time visitor (welcome screen must stay)", () => {
    // Empty localStorage = first visit. The auto-locate effect reads localStorage
    // directly (not the racy isFirstVisit-derived prop), so it must skip here.
    // Regression guard for the native welcome-screen-flash bug (v3.96–3.98).
    const getCurrentPosition = vi.fn()
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition }, clipboard: navigator.clipboard })
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="nearby" />)
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it("does not render visible Überall/Nearby mode tabs when initialMode='nearby' (issue #28)", () => {
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(), clearWatch: vi.fn() }, clipboard: navigator.clipboard })
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="nearby" />)
    expect(screen.queryByText("Überall")).not.toBeInTheDocument()
    // "In der Nähe" only appears later as the location token (after a GPS fix), never as a tab.
  })

  it("calls geolocation.getCurrentPosition on mount when initialMode='nearby' (returning visitor)", () => {
    localStorage.setItem("ap_visited", "1")
    const getCurrentPosition = vi.fn()
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition }, clipboard: navigator.clipboard })
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="nearby" />)
    expect(getCurrentPosition).toHaveBeenCalledOnce()
  })

  it("does not call getCurrentPosition when initialMode='text'", () => {
    const getCurrentPosition = vi.fn()
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition }, clipboard: navigator.clipboard })
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })
})

// ─── GPS resolution ──────────────────────────────────────────────────────────

function simulateGpsSuccess(lat = 52.52, lon = 13.405, district = "Mitte") {
  vi.stubGlobal("navigator", {
    clipboard: navigator.clipboard,
    geolocation: {
      getCurrentPosition: (success: PositionCallback) =>
        success({ coords: { latitude: lat, longitude: lon } } as GeolocationPosition),
      watchPosition: vi.fn().mockReturnValue(1),
      clearWatch: vi.fn(),
    },
  })
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ district }), { status: 200 }),
  ))
}

describe("ChatPanel GPS resolution", () => {
  it("calls onGpsResolved with coords after GPS success (locateTrigger — e.g. welcome-screen auto-locate)", async () => {
    simulateGpsSuccess(48.137, 11.576, "Maxvorstadt")
    const onGpsResolved = vi.fn()
    const props = { onSearch: vi.fn(), isLoading: false, onGpsResolved }
    const { rerender } = render(<ChatPanel {...props} locateTrigger={0} />)
    rerender(<ChatPanel {...props} locateTrigger={1} />)
    await act(() => vi.runAllTimersAsync())
    expect(onGpsResolved).toHaveBeenCalledWith({ lat: 48.137, lon: 11.576 })
  })

  it("locateTrigger locates AND immediately starts a nearby search (welcome-screen/defaultSearchMode='nearby' auto-locate — unaffected by removing the inline ⌖ row button)", async () => {
    simulateGpsSuccess(48.137, 11.576, "Maxvorstadt")
    const onSearch = vi.fn()
    const props = { onSearch, isLoading: false }
    const { rerender } = render(<ChatPanel {...props} locateTrigger={0} />)
    rerender(<ChatPanel {...props} locateTrigger={1} />)
    await act(() => vi.runAllTimersAsync())
    // The GPS fix is fed straight into a venue search at those coordinates.
    expect(onSearch).toHaveBeenCalledWith(expect.any(String), { lat: 48.137, lon: 11.576 })
  })

  it("clicking the freestanding nearby-search button locates AND immediately starts a search using the active chip (v10.1)", async () => {
    simulateGpsSuccess(48.137, 11.576, "Maxvorstadt")
    const onSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} isLoading={false} />)
    fireEvent.click(screen.getByRole("button", { name: "In der Nähe suchen" }))
    await act(() => vi.runAllTimersAsync())
    expect(onSearch).toHaveBeenCalledWith(expect.any(String), { lat: 48.137, lon: 11.576 })
  })

  it("clears stale typed text (e.g. a prior 'Berlin' text search) so the location token shows after the nearby-search button (v10.1 regression)", async () => {
    simulateGpsSuccess(48.137, 11.576, "Maxvorstadt")
    const onSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} isLoading={false} />)
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "Berlin" } })
    expect(input).toHaveValue("Berlin")
    fireEvent.click(screen.getByRole("button", { name: "In der Nähe suchen" }))
    await act(() => vi.runAllTimersAsync())
    expect(onSearch).toHaveBeenCalledWith(expect.any(String), { lat: 48.137, lon: 11.576 })
    expect(input).toHaveValue("")
    expect(screen.getByText(/Maxvorstadt/)).toBeInTheDocument()
  })

  it("a typed search after a nearby fix exits nearby mode and drops the location token (H1/M1)", async () => {
    // Reverse geocode → district; everything else (autocomplete suggest) → empty.
    vi.stubGlobal("navigator", {
      clipboard: navigator.clipboard,
      geolocation: {
        getCurrentPosition: (success: PositionCallback) =>
          success({ coords: { latitude: 48.1, longitude: 11.5 } } as GeolocationPosition),
        watchPosition: vi.fn().mockReturnValue(1),
        clearWatch: vi.fn(),
      },
    })
    vi.stubGlobal("fetch", vi.fn((url: unknown) => {
      const body = String(url).includes("/reverse") ? { district: "Maxvorstadt" } : []
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    }))
    const onSearch = vi.fn()
    const onModeChange = vi.fn()
    const props = { onSearch, isLoading: false, initialMode: "text" as const, onModeChange }
    const { rerender } = render(<ChatPanel {...props} locateTrigger={0} />)

    // 1. Locate → nearby mode + GPS badge on the locate button (district in title).
    rerender(<ChatPanel {...props} locateTrigger={1} />)
    await act(() => vi.runAllTimersAsync())
    expect(screen.getByTitle(/Maxvorstadt/)).toBeInTheDocument()
    expect(onModeChange).toHaveBeenLastCalledWith("nearby")

    // 2. A typed area search must leave nearby behind: badge gone, mode back to text.
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    await act(() => vi.runAllTimersAsync())
    fireEvent.keyDown(getInput(), { key: "Enter" })
    await act(() => vi.runAllTimersAsync())
    expect(screen.queryByTitle(/Maxvorstadt/)).not.toBeInTheDocument()
    expect(onModeChange).toHaveBeenLastCalledWith("text")
  })

  it("bumping exitNearbyTrigger leaves nearby mode so a chip pick refines the searched area, not the GPS fix (viewport-origin bug)", async () => {
    // Reverse geocode → district; everything else (autocomplete suggest) → empty.
    vi.stubGlobal("navigator", {
      clipboard: navigator.clipboard,
      geolocation: {
        getCurrentPosition: (success: PositionCallback) =>
          success({ coords: { latitude: 48.1, longitude: 11.5 } } as GeolocationPosition),
        watchPosition: vi.fn().mockReturnValue(1),
        clearWatch: vi.fn(),
      },
    })
    vi.stubGlobal("fetch", vi.fn((url: unknown) => {
      const body = String(url).includes("/reverse") ? { district: "Maxvorstadt" } : []
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    }))
    const onSearch = vi.fn()
    const onModeChange = vi.fn()
    // activeSearchCoords = the panned area the user just ran "Hier suchen" on (Berlin),
    // distinct from the GPS fix (Munich). The parent sets it to the last searched coords.
    const props = {
      onSearch, onModeChange, isLoading: false, initialMode: "text" as const,
      activeSearchCoords: { lat: 52.5, lon: 13.4 },
    }
    const { rerender } = render(<ChatPanel {...props} exitNearbyTrigger={0} locateTrigger={0} />)

    // Locate → nearby GPS fix (Munich) is active (district badge shown).
    rerender(<ChatPanel {...props} exitNearbyTrigger={0} locateTrigger={1} />)
    await act(() => vi.runAllTimersAsync())
    expect(onModeChange).toHaveBeenLastCalledWith("nearby")
    expect(screen.getByTitle(/Maxvorstadt/)).toBeInTheDocument()

    // Parent runs "Hier suchen" on the panned area → bumps exitNearbyTrigger.
    // The parent (HomeClient) calls setChatMode("text") directly in the same batch
    // as handleSearch, so exitNearbyTrigger must NOT call onModeChange — doing so
    // would trigger clearSearchState() and wipe lastQuery after handleSearch set it.
    rerender(<ChatPanel {...props} exitNearbyTrigger={1} locateTrigger={1} />)
    await act(() => vi.runAllTimersAsync())
    // onModeChange is NOT called from the trigger path (parent owns the chatMode sync).
    expect(onModeChange).not.toHaveBeenCalledWith("text")

    // Picking a chip now refines the searched area (Berlin), NOT the GPS fix (Munich).
    // (Clear the locate's own initial nearby search first so we assert only the chip.)
    onSearch.mockClear()
    openChipGroup("Gastronomie")
    const chip = screen.getAllByRole("radio").find((b) => b.textContent?.includes("Restaurants"))!
    fireEvent.click(chip)
    expect(onSearch).toHaveBeenCalledWith(expect.stringMatching(/Restaurant/), { lat: 52.5, lon: 13.4 })
    expect(onSearch).not.toHaveBeenCalledWith(expect.anything(), { lat: 48.1, lon: 11.5 })
  })

  it("hides the green 'at my location' badge while a map pan is pending (panPending)", async () => {
    vi.stubGlobal("navigator", {
      clipboard: navigator.clipboard,
      geolocation: {
        getCurrentPosition: (success: PositionCallback) =>
          success({ coords: { latitude: 48.1, longitude: 11.5 } } as GeolocationPosition),
        watchPosition: vi.fn().mockReturnValue(1),
        clearWatch: vi.fn(),
      },
    })
    vi.stubGlobal("fetch", vi.fn((url: unknown) => {
      const body = String(url).includes("/reverse") ? { district: "Maxvorstadt" } : []
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    }))
    const props = { onSearch: vi.fn(), isLoading: false, initialMode: "text" as const }
    const { rerender } = render(<ChatPanel {...props} panPending={false} locateTrigger={0} />)

    // Acquire a GPS fix → the green district badge shows.
    rerender(<ChatPanel {...props} panPending={false} locateTrigger={1} />)
    await act(() => vi.runAllTimersAsync())
    expect(screen.getByTitle(/Maxvorstadt/)).toBeInTheDocument()

    // A pan becomes pending → badge hidden.
    rerender(<ChatPanel {...props} panPending={true} locateTrigger={1} />)
    expect(screen.queryByTitle(/Maxvorstadt/)).not.toBeInTheDocument()

    // Panning back / a new search clears the pending pan → badge returns (reversible).
    rerender(<ChatPanel {...props} panPending={false} locateTrigger={1} />)
    expect(screen.getByTitle(/Maxvorstadt/)).toBeInTheDocument()
  })
})

// ─── Single-field UI (name field removed in step 2 of issue #24) ─────────────

describe("ChatPanel single-field UI", () => {
  it("renders exactly one text input in text mode", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    expect(screen.getAllByRole("combobox")).toHaveLength(1)
    expect(screen.queryByPlaceholderText(/Hotel Adlon Berlin/i)).not.toBeInTheDocument()
  })

  it("does NOT render an 'Ort suchen' button in the mode bar", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} />)
    expect(screen.queryByRole("button", { name: /Ort suchen/ })).not.toBeInTheDocument()
  })

  it("renders no visible mode tabs (issue #28) but does render the freestanding nearby-search button (v10.1)", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} />)
    expect(screen.queryByRole("button", { name: /Überall/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "In der Nähe suchen" })).toBeInTheDocument()
  })

  it("chip strip is visible in text mode", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    expect(screen.getByText(/Gastronomie/)).toBeInTheDocument()
  })

  it("initialMode='place' falls back to text mode with the unified input visible", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="place" />)
    expect(getInput()).toBeInTheDocument()
  })

  it("renders no submit button — Google Maps model, no-submit-button redesign", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    expect(screen.queryByRole("button", { name: "Suchen" })).not.toBeInTheDocument()
  })

  it("Enter with raw text fires an area search, never onPlaceSearch", () => {
    const onSearch = vi.fn()
    const onPlaceSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} onPlaceSearch={onPlaceSearch} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "Bierpumpe Issum" } })
    fireEvent.keyDown(getInput(), { key: "Enter" })
    expect(onSearch).toHaveBeenCalledWith(expect.stringContaining("Bierpumpe Issum"), undefined, undefined)
    expect(onPlaceSearch).not.toHaveBeenCalled()
  })

  it("clicking the always-present freetext dropdown row fires the same search as Enter", () => {
    const onSearch = vi.fn()
    const onPlaceSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} onPlaceSearch={onPlaceSearch} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "Bierpumpe Issum" } })
    fireEvent.mouseDown(screen.getByRole("option", { name: /Nach.*Bierpumpe Issum.*suchen/ }))
    expect(onSearch).toHaveBeenCalledWith(expect.stringContaining("Bierpumpe Issum"), undefined, undefined)
    expect(onPlaceSearch).not.toHaveBeenCalled()
  })

  it("the freetext row is the default-highlighted option (aria-selected) and carries aria-activedescendant", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    const row = screen.getByRole("option", { name: /Nach.*Berlin.*suchen/ })
    expect(row).toHaveAttribute("aria-selected", "true")
    expect(getInput()).toHaveAttribute("aria-activedescendant", "unified-opt-freetext")
  })

  it("the dropdown (and freetext row) is not rendered while the field is empty", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("Escape closes the dropdown even when only the freetext row is showing (no suggestions yet)", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "B" } }) // 1 char — below the suggest-fetch threshold
    expect(screen.getByRole("listbox")).toBeInTheDocument()

    fireEvent.keyDown(getInput(), { key: "Escape" })
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("shows a spinner instead of the clear button, and an indeterminate progress bar, while loading", () => {
    const { rerender } = render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    expect(screen.getByRole("button", { name: /Eingabe löschen/ })).toBeInTheDocument()
    expect(screen.queryByRole("status", { name: "Suche läuft …" })).not.toBeInTheDocument()

    rerender(<ChatPanel onSearch={vi.fn()} isLoading initialMode="text" />)
    expect(screen.queryByRole("button", { name: /Eingabe löschen/ })).not.toBeInTheDocument()
    expect(screen.getByRole("status", { name: "Suche läuft …" })).toBeInTheDocument()
  })

  it("Enter on desktop does NOT blur the input — keyboard users keep focus after a search (matchMedia mocked to desktop)", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    getInput().focus()
    expect(document.activeElement).toBe(getInput())

    fireEvent.keyDown(getInput(), { key: "Enter" })
    expect(document.activeElement).toBe(getInput())
  })

  it("Enter on mobile DOES blur the input, so the on-screen keyboard closes", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }))
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    getInput().focus()

    fireEvent.keyDown(getInput(), { key: "Enter" })
    expect(document.activeElement).not.toBe(getInput())
  })

  it("a blur→refocus within the close delay keeps the dropdown open (no stale-timer race)", async () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "x" } }) // 1 char — freetext row only, no fetch yet
    expect(screen.getByRole("listbox")).toBeInTheDocument()

    fireEvent.blur(getInput())
    await act(() => vi.advanceTimersByTimeAsync(50))
    expect(screen.getByRole("listbox")).toBeInTheDocument() // still open, close not yet due

    fireEvent.focus(getInput()) // must cancel the pending close
    await act(() => vi.advanceTimersByTimeAsync(100)) // past the original 150ms mark
    expect(screen.getByRole("listbox")).toBeInTheDocument() // NOT slammed shut while focused
  })

  it("blurring away for real still closes the dropdown after the delay", async () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "x" } })
    expect(screen.getByRole("listbox")).toBeInTheDocument()

    fireEvent.blur(getInput())
    await act(() => vi.advanceTimersByTimeAsync(150))
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("blur resets aria-activedescendant along with the dropdown, even when a suggestion was highlighted", async () => {
    mockFetch([area("Berlin")])
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())
    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    expect(getInput()).toHaveAttribute("aria-activedescendant", "unified-opt-0")

    fireEvent.blur(getInput())
    await act(() => vi.advanceTimersByTimeAsync(150))

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    expect(getInput()).not.toHaveAttribute("aria-activedescendant")
    expect(document.getElementById("unified-opt-0")).toBeNull()
  })

  it("the 'accessible places' easter egg still opens the dev console on Enter (single check, now only in submit())", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "accessible places" } })
    fireEvent.keyDown(getInput(), { key: "Enter" })
    expect(screen.getByText(/ACCESSIBLE PLACES/)).toBeInTheDocument()
  })
})

// ─── Amenity focus mode — chip strip ────────────────────────────────────────

describe("ChatPanel amenity chips", () => {
  it("renders the parking and WC chips alongside the venue chips", () => {
    render(<ChatPanel onSearch={vi.fn()} onAmenitySearch={vi.fn()} isLoading={false} initialMode="text" />)
    expect(screen.getByText(/🍽 Gastronomie/)).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /🅿/ })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /🚻/ })).toBeInTheDocument()
  })

  it("does not render amenity chips when onAmenitySearch is absent", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    expect(screen.queryByRole("radio", { name: /🅿/ })).not.toBeInTheDocument()
  })

  it("runs an amenity search at the active area coordinates", () => {
    const onAmenitySearch = vi.fn()
    render(
      <ChatPanel
        onSearch={vi.fn()}
        onAmenitySearch={onAmenitySearch}
        isLoading={false}
        initialMode="text"
        activeSearchCoords={{ lat: 52.5, lon: 13.4 }}
      />,
    )
    fireEvent.click(screen.getByRole("radio", { name: /🅿/ }))
    expect(onAmenitySearch).toHaveBeenCalledWith("parking", { lat: 52.5, lon: 13.4 })
  })
})

// ─── Finding F5 / issue #28 (a11y): chips form two single-select radiogroups —
// row 1 = venue categories (Alle + venues), row 2 = amenity quick-find actions ─

describe("ChatPanel amenity chips — accessibility (finding F5 / B2 two-row layout)", () => {
  it("groups category chips and amenity chips into two distinct radiogroups", () => {
    render(<ChatPanel onSearch={vi.fn()} onAmenitySearch={vi.fn()} isLoading={false} initialMode="text" />)
    // Category row (label "Kategorie") holds Alle + venue chips, not the amenity chips.
    const categoryGroup = screen.getByRole("radiogroup", { name: "Kategorie" })
    expect(within(categoryGroup).getByRole("radio", { name: new RegExp(`^${"Alle"}`) })).toBeInTheDocument()
    expect(within(categoryGroup).getByRole("radio", { name: /Gastronomie/ })).toBeInTheDocument()
    expect(within(categoryGroup).queryByRole("radio", { name: /🅿/ })).not.toBeInTheDocument()
    // Amenity quick-find row (label "Schnellsuche") holds the two amenity chips.
    const amenityGroup = screen.getByRole("radiogroup", { name: "Schnellsuche" })
    expect(within(amenityGroup).getByRole("radio", { name: /🅿/ })).toBeInTheDocument()
    expect(within(amenityGroup).getByRole("radio", { name: /🚻/ })).toBeInTheDocument()
  })

  it("marks exactly the active amenity chip as checked, all others unchecked", () => {
    render(
      <ChatPanel onSearch={vi.fn()} onAmenitySearch={vi.fn()} isLoading={false} initialMode="text" amenityActive="parking" />,
    )
    expect(screen.getByRole("radio", { name: /🅿/ })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: /🚻/ })).toHaveAttribute("aria-checked", "false")
    expect(screen.getByRole("radio", { name: /Gastronomie/ })).toHaveAttribute("aria-checked", "false")
  })

  it("marks 'Alle' as checked and both amenity chips as unchecked when no amenity is active and no category is selected", () => {
    render(<ChatPanel onSearch={vi.fn()} onAmenitySearch={vi.fn()} isLoading={false} initialMode="text" />)
    expect(screen.getByRole("radio", { name: /🅿/ })).toHaveAttribute("aria-checked", "false")
    expect(screen.getByRole("radio", { name: /🚻/ })).toHaveAttribute("aria-checked", "false")
  })
})

// ─── Schnellsuche (issue #28): a typed, not-yet-searched location is honoured by
// the amenity chips — "Hamburg" + 🅿 geocodes Hamburg and searches there, beating
// even a live GPS fix (typing is the more explicit signal) ────────────────────

describe("ChatPanel Schnellsuche — typed-location geocode", () => {
  it("geocodes the typed location and runs the amenity search there", async () => {
    const onAmenitySearch = vi.fn()
    vi.stubGlobal("fetch", vi.fn((url: unknown) =>
      Promise.resolve(new Response(
        JSON.stringify(typeof url === "string" && url.includes("/api/geocode?q=")
          ? { lat: 53.55, lon: 9.99, displayName: "Hamburg" }
          : []),
        { status: 200 },
      )),
    ))
    render(<ChatPanel onSearch={vi.fn()} onAmenitySearch={onAmenitySearch} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "Hamburg" } })
    fireEvent.click(screen.getByRole("radio", { name: /🅿/ }))
    await act(() => vi.runAllTimersAsync())
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining("/api/geocode?q=Hamburg"))
    expect(onAmenitySearch).toHaveBeenCalledWith("parking", { lat: 53.55, lon: 9.99 })
  })

  it("a typed location beats a live GPS fix", async () => {
    // Resolve a real GPS fix first (via the map's locate button), then type a
    // different place and tap an amenity chip — the typed place must win.
    const onAmenitySearch = vi.fn()
    const baseProps = { onSearch: vi.fn(), onAmenitySearch, isLoading: false, initialMode: "text" as const }
    const { rerender } = render(<ChatPanel {...baseProps} />)
    simulateMapLocateFix(rerender, baseProps, 52.52, 13.405, "Mitte")
    onAmenitySearch.mockClear()
    // Re-stub fetch to answer the geocode call for the typed place.
    vi.stubGlobal("fetch", vi.fn((url: unknown) =>
      Promise.resolve(new Response(
        JSON.stringify(typeof url === "string" && url.includes("/api/geocode?q=")
          ? { lat: 53.55, lon: 9.99 } : []),
        { status: 200 },
      )),
    ))
    fireEvent.change(getInput(), { target: { value: "Hamburg" } })
    fireEvent.click(screen.getByRole("radio", { name: /🅿/ }))
    await act(() => vi.runAllTimersAsync())
    expect(onAmenitySearch).toHaveBeenCalledWith("parking", { lat: 53.55, lon: 9.99 })
  })

  it("forwards the intl flag to the geocode call when international is set", async () => {
    const onAmenitySearch = vi.fn()
    vi.stubGlobal("fetch", vi.fn((url: unknown) =>
      Promise.resolve(new Response(
        JSON.stringify(typeof url === "string" && url.includes("/api/geocode?q=") ? { lat: 48.85, lon: 2.35 } : []),
        { status: 200 },
      )),
    ))
    render(<ChatPanel onSearch={vi.fn()} onAmenitySearch={onAmenitySearch} isLoading={false} initialMode="text" international />)
    fireEvent.change(getInput(), { target: { value: "Paris" } })
    fireEvent.click(screen.getByRole("radio", { name: /🚻/ }))
    await act(() => vi.runAllTimersAsync())
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining("intl=1"))
  })
})

// ─── Finding F1 (critical): amenity chip must use the resolved search location
// for ANY prior search (not just a coordinate-known one), and must never hijack
// the legacy Überall/In-der-Nähe mode or clear search state while locating ──────

describe("ChatPanel amenity chips — location resolution & no mode-hijack (finding F1)", () => {
  it("uses the resolved search center from a plain typed-area search (e.g. \"Cafés in Hamburg\"), which never carries client-side coordinates", () => {
    // This is the exact real-world gap: ChatPanel.submit() always passes
    // coords=undefined for a typed area search, so HomeClient's `lastCoords`
    // (activeSearchCoords) stays undefined even though the area IS resolved and
    // its centre is known via `searchCenter` (set from the server's response).
    const onAmenitySearch = vi.fn()
    const onModeChange = vi.fn()
    const onSearch = vi.fn()
    render(
      <ChatPanel
        onSearch={onSearch}
        onModeChange={onModeChange}
        onAmenitySearch={onAmenitySearch}
        isLoading={false}
        initialMode="text"
        searchCenter={{ lat: 53.55, lon: 9.99 }}
      />,
    )
    fireEvent.click(screen.getByRole("radio", { name: /🅿/ }))
    expect(onAmenitySearch).toHaveBeenCalledWith("parking", { lat: 53.55, lon: 9.99 })
    expect(onModeChange).not.toHaveBeenCalled()
    expect(onSearch).not.toHaveBeenCalled()
  })

  it("auto-locates without switching mode or clearing search state when no location is known at all", async () => {
    const onAmenitySearch = vi.fn()
    const onModeChange = vi.fn()
    const onSearch = vi.fn()
    vi.stubGlobal("navigator", {
      clipboard: navigator.clipboard,
      geolocation: {
        getCurrentPosition: (success: PositionCallback) =>
          success({ coords: { latitude: 48.2, longitude: 16.37 } } as GeolocationPosition),
      },
    })
    render(
      <ChatPanel
        onSearch={onSearch}
        onModeChange={onModeChange}
        onAmenitySearch={onAmenitySearch}
        isLoading={false}
        initialMode="text"
      />,
    )
    fireEvent.click(screen.getByRole("radio", { name: /🚻/ }))
    await act(() => vi.runAllTimersAsync())
    expect(onAmenitySearch).toHaveBeenCalledWith("toilet", { lat: 48.2, lon: 16.37 })
    // The critical bug: tapping the chip used to flip the legacy mode toggle and
    // synchronously wipe any on-screen venue results via clearSearchState —
    // before the GPS fix even resolved. Neither must happen for the amenity flow.
    expect(onModeChange).not.toHaveBeenCalled()
    expect(onSearch).not.toHaveBeenCalled()
  })

  it("shows an error and never searches when locating fails, without switching mode", async () => {
    const onAmenitySearch = vi.fn()
    const onModeChange = vi.fn()
    vi.stubGlobal("navigator", {
      clipboard: navigator.clipboard,
      geolocation: {
        getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback) =>
          error({ code: 1, message: "denied" } as GeolocationPositionError),
      },
    })
    render(
      <ChatPanel
        onSearch={vi.fn()}
        onModeChange={onModeChange}
        onAmenitySearch={onAmenitySearch}
        isLoading={false}
        initialMode="text"
      />,
    )
    fireEvent.click(screen.getByRole("radio", { name: /🅿/ }))
    await act(() => vi.runAllTimersAsync())
    expect(screen.getByText(/Standort konnte nicht ermittelt werden/)).toBeInTheDocument()
    expect(onAmenitySearch).not.toHaveBeenCalled()
    expect(onModeChange).not.toHaveBeenCalled()
  })

  it("prefers an active nearby GPS fix over a stale searchCenter prop", () => {
    const onAmenitySearch = vi.fn()
    const baseProps = { onSearch: vi.fn(), onAmenitySearch, isLoading: false, searchCenter: { lat: 1, lon: 1 } }
    const { rerender } = render(<ChatPanel {...baseProps} />)
    // Resolve a real GPS fix via the map's locate button first.
    simulateMapLocateFix(rerender, baseProps, 52.52, 13.405, "Mitte")
    onAmenitySearch.mockClear()

    fireEvent.click(screen.getByRole("radio", { name: /🅿/ }))
    expect(onAmenitySearch).toHaveBeenCalledWith("parking", { lat: 52.52, lon: 13.405 })
  })
})

// ─── Regression: tapping an amenity chip immediately after "In der Nähe" must
// not race a second, independent geolocation request against the one already
// in flight — it must reuse that fix and route it into the amenity search,
// never the venue nearby-search ─────────────────────────────────────────────

describe("ChatPanel amenity chips — racing an in-flight 'In der Nähe' locate (regression)", () => {
  it("does not start a second geolocation request and routes the fix to the amenity search, not a venue search", async () => {
    let resolveGps: (() => void) | undefined
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      resolveGps = () => success({ coords: { latitude: 52.52, longitude: 13.405 } } as GeolocationPosition)
    })
    vi.stubGlobal("navigator", {
      clipboard: navigator.clipboard,
      geolocation: { getCurrentPosition, watchPosition: vi.fn().mockReturnValue(1), clearWatch: vi.fn() },
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ district: "Mitte" }), { status: 200 }),
    ))
    const onSearch = vi.fn()
    const onAmenitySearch = vi.fn()
    const props = { onSearch, onAmenitySearch, isLoading: false, initialMode: "text" as const }
    const { rerender } = render(<ChatPanel {...props} locateTrigger={0} />)

    rerender(<ChatPanel {...props} locateTrigger={1} />)
    // GPS hasn't resolved yet — tap WC immediately, before the fix lands.
    fireEvent.click(screen.getByRole("radio", { name: /🚻/ }))

    expect(getCurrentPosition).toHaveBeenCalledTimes(1)

    resolveGps?.()
    await act(() => vi.runAllTimersAsync())

    expect(onAmenitySearch).toHaveBeenCalledWith("toilet", { lat: 52.52, lon: 13.405 })
    expect(onSearch).not.toHaveBeenCalled()
  })

  it("falls back to the normal venue nearby-search when no amenity chip was tapped while locating", async () => {
    simulateGpsSuccess(52.52, 13.405, "Mitte")
    const onSearch = vi.fn()
    const onAmenitySearch = vi.fn()
    const props = { onSearch, onAmenitySearch, isLoading: false, initialMode: "text" as const }
    const { rerender } = render(<ChatPanel {...props} locateTrigger={0} />)
    rerender(<ChatPanel {...props} locateTrigger={1} />)
    await act(() => vi.runAllTimersAsync())
    expect(onSearch).toHaveBeenCalled()
    expect(onAmenitySearch).not.toHaveBeenCalled()
  })
})

// ─── Finding F6b (low): the tapped chip should show its own loading indicator
// while acquiring a GPS fix, since the old per-chip spinner was dropped ────────

describe("ChatPanel amenity chips — loading indicator while locating (finding F6b)", () => {
  it("marks the tapped chip aria-busy while a GPS fix is being acquired", async () => {
    vi.stubGlobal("navigator", {
      clipboard: navigator.clipboard,
      // Never resolves — simulates a slow/in-flight GPS fix.
      geolocation: { getCurrentPosition: () => {} },
    })
    render(<ChatPanel onSearch={vi.fn()} onAmenitySearch={vi.fn()} isLoading={false} initialMode="text" />)
    const chip = screen.getByRole("radio", { name: /🅿/ })
    fireEvent.click(chip)
    expect(chip).toHaveAttribute("aria-busy", "true")
    expect(screen.getByRole("radio", { name: /🚻/ })).toHaveAttribute("aria-busy", "false")
  })
})

// ─── CHIP_GROUPS completeness (regression: a plain Category[] list, not a
// Record<Category,…>, so a category left out of every group would compile
// fine and just become silently unreachable from the chip UI) ────────────────

describe("CHIP_GROUPS completeness", () => {
  it("covers every Category in exactly one group", () => {
    const cats = CHIP_GROUPS.flatMap((g) => g.cats)
    expect(new Set(cats).size).toBe(cats.length) // no duplicates across groups
    expect([...cats].sort()).toEqual([...ALL_CATEGORIES].sort())
  })

  it("every group's 'whole group' blob classifies to exactly its own members (no missing, no extra)", () => {
    // Mirrors ChatPanel's groupLabel(): concatenate each member's chip text
    // and check the server-side inferCategories reconstructs the same set —
    // this is the mechanism "Alle <Gruppe>" relies on with zero API changes.
    for (const group of CHIP_GROUPS) {
      const blob = group.cats.map((cat) => de.chipLabels[cat] ?? de.categories[cat]).join(" ")
      const result = inferCategories(blob)
      expect([...result].sort()).toEqual([...group.cats].sort())
    }
  })
})

// ─── Regression: reopening a group while an amenity search is active must
// exit amenity mode even when the group already "contains" the last-picked
// venue category (previously openGroupChip silently skipped applySelection
// in that case, leaving the amenity results on screen with no new fetch) ────

describe("ChatPanel drill-in chips — reopening a group while an amenity search is active", () => {
  it("exits amenity mode and re-fires the venue search when reopening the group of the already-selected category", () => {
    const onSearch = vi.fn()
    const onExitAmenity = vi.fn()
    const { rerender } = render(
      <ChatPanel
        onSearch={onSearch}
        onExitAmenity={onExitAmenity}
        isLoading={false}
        initialMode="text"
        activeSearchCoords={{ lat: 52.5, lon: 13.4 }}
      />,
    )
    openChipGroup("Unterkunft")
    fireEvent.click(screen.getAllByRole("radio").find((b) => b.textContent?.includes("Hotels"))!)
    closeChipGroup()
    onSearch.mockClear()
    onExitAmenity.mockClear()

    // Parent now shows an amenity search (e.g. the user tapped 🅿 afterwards).
    rerender(
      <ChatPanel
        onSearch={onSearch}
        onExitAmenity={onExitAmenity}
        isLoading={false}
        initialMode="text"
        activeSearchCoords={{ lat: 52.5, lon: 13.4 }}
        amenityActive="parking"
      />,
    )

    // Reopening "Unterkunft" (which already contains the stale "hotel" pick)
    // must still exit amenity mode and re-run a venue search.
    openChipGroup("Unterkunft");
    expect(onExitAmenity).toHaveBeenCalled()
    expect(onSearch).toHaveBeenCalledWith(expect.stringMatching(/Hotel/), { lat: 52.5, lon: 13.4 })
  })
})

// ─── Chip display sync with typed free text (regression) ────────────────────
// Typing a category word directly into the field (no chip click) previously
// left the chip row showing "Alle" even though the server-side parseQuery
// filters the results to a specific category — a visible lie about what was
// actually searched. submit() now re-derives the same categories client-side
// (via the shared lib/llm parseQuery) and syncs the chip display to match.

describe("ChatPanel chip sync with typed free text", () => {
  it("activates the matching single-category chip after a plain-text submit", () => {
    const onSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "Restaurants in Berlin Charlottenburg" } })
    fireEvent.keyDown(getInput(), { key: "Enter" })
    expect(onSearch).toHaveBeenCalledWith("Restaurants in Berlin Charlottenburg", undefined, undefined)

    const gastroChip = screen.getAllByRole("radio").find((b) => b.textContent?.includes("Gastronomie"))!
    expect(gastroChip).toHaveClass("bg-primary")
    expect(gastroChip.textContent).toMatch(/Restaurants/)
  })

  it("activates the matching whole-group chip when every member category is mentioned", () => {
    const onSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} isLoading={false} initialMode="text" />)
    // Concatenation of every "Unterkunft" member's own chip label — the same
    // mechanism ChatPanel's own groupLabel() uses for "Alle <Gruppe>".
    fireEvent.change(getInput(), { target: { value: "Hotels Hostels Ferienwohnungen Campingplätze in Köln" } })
    fireEvent.keyDown(getInput(), { key: "Enter" })

    const stayChip = screen.getAllByRole("radio").find((b) => b.textContent?.includes("Unterkunft"))!
    expect(stayChip).toHaveClass("bg-primary")
  })

  it("falls back to 'Alle' for an ambiguous multi-category query with no matching group", () => {
    const onSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "Restaurants und Cafés in Hamburg" } })
    fireEvent.keyDown(getInput(), { key: "Enter" })

    const alleChip = screen.getAllByRole("radio").find((b) => b.textContent?.includes("Alle"))!
    expect(alleChip).toHaveClass("bg-primary")
  })

  it("re-syncs off a stale chip when typed 'in'-structured text overrides it with a different category", () => {
    // Companion to the existing "typed query wins" test: the query text was
    // already correct (Arzt, not Hotels), but the chip used to stay stuck on
    // the old "Hotels" pick — now it follows the text that actually ran.
    const onSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} isLoading={false} initialMode="text" />)
    openChipGroup("Unterkunft")
    fireEvent.click(screen.getAllByRole("radio").find((b) => b.textContent?.includes("Hotels"))!)
    fireEvent.change(getInput(), { target: { value: "Arzt in Frankenthal" } })
    fireEvent.keyDown(getInput(), { key: "Enter" })
    expect(onSearch).toHaveBeenCalledWith("Arzt in Frankenthal", undefined, undefined)

    const healthChip = screen.getAllByRole("radio").find((b) => b.textContent?.includes("Gesundheit"))!
    expect(healthChip).toHaveClass("bg-primary")
    expect(healthChip.textContent).toMatch(/Arztpraxen/)
  })

  it("keeps 'Alle' active when no category hint matches the typed text", () => {
    const onSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "Berlin Mitte" } })
    fireEvent.keyDown(getInput(), { key: "Enter" })

    const alleChip = screen.getAllByRole("radio").find((b) => b.textContent?.includes("Alle"))!
    expect(alleChip).toHaveClass("bg-primary")
  })
})
