import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import ChatPanel from "@/components/chat/ChatPanel"

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
  return screen.getByPlaceholderText(/Ort oder Name|Place or name/i) as HTMLInputElement
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

  it("clears suggestions when input drops below 2 chars", async () => {
    mockFetch([area("Berlin")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    await act(() => vi.runAllTimersAsync())
    expect(screen.getByRole("listbox")).toBeInTheDocument()

    fireEvent.change(getInput(), { target: { value: "B" } })
    await act(() => vi.runAllTimersAsync())
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
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
    // headers are not selectable options
    expect(screen.getAllByRole("option")).toHaveLength(2)
  })

  it("hides dropdown when API returns empty array", async () => {
    mockFetch([])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "xyz" } })
    await act(() => vi.runAllTimersAsync())
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("hides dropdown when API request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")))
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
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

    fireEvent.mouseDown(screen.getByRole("option", { name: /Bierpumpe/ }))
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

    fireEvent.mouseDown(screen.getByRole("option", { name: /Bierpumpe/ }))
    expect(onPlaceSearch).toHaveBeenCalledWith("Bierpumpe", undefined)
  })

  it("Enter after a venue pick re-runs the place search", async () => {
    const onPlaceSearch = vi.fn()
    mockFetch([venue("Bierpumpe", "Bierpumpe, Issum (DE)", { lat: 51.54, lon: 6.42 })])
    renderPanel(vi.fn(), false, onPlaceSearch)
    fireEvent.change(getInput(), { target: { value: "Bierpumpe" } })
    await act(() => vi.runAllTimersAsync())
    fireEvent.mouseDown(screen.getByRole("option", { name: /Bierpumpe/ }))
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

  it("greys out category chips after a venue pick and re-enables them on edit", async () => {
    mockFetch([venue("Bierpumpe", "Bierpumpe, Issum (DE)")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Bierpumpe" } })
    await act(() => vi.runAllTimersAsync())
    fireEvent.mouseDown(screen.getByRole("option", { name: /Bierpumpe/ }))

    const chip = screen.getAllByRole("button").find((b) => b.textContent?.includes("Restaurants"))
    expect(chip).toBeDisabled()

    fireEvent.change(getInput(), { target: { value: "Bierpump" } })
    expect(chip).not.toBeDisabled()
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
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument()
  })

  it("appears when input has text", () => {
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    expect(screen.getByRole("button", { name: /clear/i })).toBeInTheDocument()
  })

  it("clears the input and closes the dropdown on click", async () => {
    mockFetch([area("Berlin")])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.mouseDown(screen.getByRole("button", { name: /clear/i }))
    expect(getInput().value).toBe("")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument()
  })
})

// ─── initialChipIdx / defaultChipIdx restore ────────────────────────────────

describe("ChatPanel initialChipIdx restore", () => {
  it("selects the chip at initialChipIdx when no saved last-search exists", () => {
    localStorage.clear()
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" initialChipIdx={2} />)
    // chip index 2 = Hotels
    const buttons = screen.getAllByRole("button")
    const hotelChip = buttons.find((b) => b.textContent?.includes("Hotels"))
    expect(hotelChip).toBeDefined()
    expect(hotelChip).toHaveClass("bg-primary")
  })

  it("saved last-search chip overrides initialChipIdx", () => {
    localStorage.setItem("ap_last_search", JSON.stringify({ idx: 1, loc: "Berlin" }))
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" initialChipIdx={2} />)
    const buttons = screen.getAllByRole("button")
    const cafeChip  = buttons.find((b) => b.textContent?.includes("Cafés"))
    const hotelChip = buttons.find((b) => b.textContent?.includes("Hotels"))
    expect(cafeChip).toHaveClass("bg-primary")
    expect(hotelChip).not.toHaveClass("bg-primary")
  })

  it("falls back to initialChipIdx when saved idx is invalid", () => {
    localStorage.setItem("ap_last_search", JSON.stringify({ idx: 999, loc: "Berlin" }))
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" initialChipIdx={3} />)
    const buttons = screen.getAllByRole("button")
    // chip index 3 = Biergärten
    const biergartChip = buttons.find((b) => b.textContent?.includes("Biergärten"))
    expect(biergartChip).toHaveClass("bg-primary")
  })

  it("defaults to the 'Alle' chip (all categories) when neither saved search nor initialChipIdx exist", () => {
    localStorage.clear()
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    const buttons = screen.getAllByRole("button")
    const alleChip       = buttons.find((b) => b.textContent?.includes("Alle"))
    const restaurantChip = buttons.find((b) => b.textContent?.includes("Restaurants"))
    expect(alleChip).toHaveClass("bg-primary")
    expect(restaurantChip).not.toHaveClass("bg-primary")
  })

  it("restores a saved null chip ('Alle') without falling back to a category", () => {
    localStorage.setItem("ap_last_search", JSON.stringify({ idx: null, loc: "Berlin" }))
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" initialChipIdx={2} />)
    const buttons = screen.getAllByRole("button")
    const alleChip = buttons.find((b) => b.textContent?.includes("Alle"))
    expect(alleChip).toHaveClass("bg-primary")
  })
})

// ─── All-categories default (chips as optional quick-fills) ──────────────────

describe("ChatPanel all-categories chip", () => {
  it("clicking a category chip and then 'Alle' returns to the all-categories state", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    const buttons = screen.getAllByRole("button")
    const hotelChip = buttons.find((b) => b.textContent?.includes("Hotels"))!
    const alleChip  = buttons.find((b) => b.textContent?.includes("Alle"))!

    fireEvent.click(hotelChip)
    expect(hotelChip).toHaveClass("bg-primary")
    expect(alleChip).not.toHaveClass("bg-primary")

    fireEvent.click(alleChip)
    expect(alleChip).toHaveClass("bg-primary")
    expect(hotelChip).not.toHaveClass("bg-primary")
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
    const hotelChip = screen.getAllByRole("button").find((b) => b.textContent?.includes("Hotels"))!
    fireEvent.click(hotelChip)
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    fireEvent.keyDown(getInput(), { key: "Enter" })
    expect(onSearch).toHaveBeenCalledWith("Hotels in Berlin", undefined, undefined)
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
    const alleChip = screen.getAllByRole("button").find((b) => b.textContent?.includes("Alle"))!
    fireEvent.click(alleChip)
    expect(onSearch).toHaveBeenCalledWith("in Berlin", undefined, undefined)
  })
})

// ─── initialMode ─────────────────────────────────────────────────────────────

describe("ChatPanel initialMode", () => {
  it("defaults to nearby mode when initialMode is not passed", () => {
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(), clearWatch: vi.fn() }, clipboard: navigator.clipboard })
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} />)
    const nearbyTab = screen.getByText(/In der Nähe/)
    expect(nearbyTab.closest("button")).toHaveClass("bg-primary")
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

  it("shows nearby mode tab as active when initialMode='nearby'", () => {
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: vi.fn(), watchPosition: vi.fn(), clearWatch: vi.fn() }, clipboard: navigator.clipboard })
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="nearby" />)
    const nearbyTab = screen.getByText(/In der Nähe/)
    expect(nearbyTab.closest("button")).toHaveClass("bg-primary")
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
  it("calls onGpsResolved with coords after GPS success", async () => {
    simulateGpsSuccess(48.137, 11.576, "Maxvorstadt")
    const onGpsResolved = vi.fn()
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} onGpsResolved={onGpsResolved} />)
    fireEvent.click(screen.getByText(/In der Nähe/))
    await act(() => vi.runAllTimersAsync())
    expect(onGpsResolved).toHaveBeenCalledWith({ lat: 48.137, lon: 11.576 })
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

  it("renders exactly two mode buttons: In der Nähe and Überall", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} />)
    const modeButtons = screen.getAllByRole("button", { name: /In der Nähe|Überall/ })
    expect(modeButtons).toHaveLength(2)
  })

  it("chip strip is visible in text mode", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    expect(screen.getByText(/Restaurants/)).toBeInTheDocument()
  })

  it("initialMode='place' falls back to text mode with the unified input visible", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="place" />)
    expect(getInput()).toBeInTheDocument()
  })

  it("search button is disabled when the input is empty", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    expect(screen.getByRole("button", { name: "Suchen" })).toBeDisabled()
  })

  it("search button is enabled when the input has text", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    expect(screen.getByRole("button", { name: "Suchen" })).not.toBeDisabled()
  })

  it("clicking Suchen with raw text fires an area search, never onPlaceSearch", () => {
    const onSearch = vi.fn()
    const onPlaceSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} onPlaceSearch={onPlaceSearch} isLoading={false} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "Bierpumpe Issum" } })
    fireEvent.click(screen.getByRole("button", { name: "Suchen" }))
    expect(onSearch).toHaveBeenCalledWith(expect.stringContaining("Bierpumpe Issum"), undefined, undefined)
    expect(onPlaceSearch).not.toHaveBeenCalled()
  })
})

// ─── Amenity focus mode — chip strip ────────────────────────────────────────

describe("ChatPanel focus mode — chip strip", () => {
  it("shows chips in text mode without focus layers", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    expect(screen.getByText(/🍽 Restaurants/)).toBeInTheDocument()
  })

  it("hides chips when focusLayers has parking", () => {
    render(
      <ChatPanel
        onSearch={vi.fn()}
        isLoading={false}
        initialMode="text"
        focusLayers={new Set(["parking"] as const)}
      />,
    )
    expect(screen.queryByText(/🍽 Restaurants/)).not.toBeInTheDocument()
  })

  it("hides chips when focusLayers has toilet", () => {
    render(
      <ChatPanel
        onSearch={vi.fn()}
        isLoading={false}
        initialMode="text"
        focusLayers={new Set(["toilet"] as const)}
      />,
    )
    expect(screen.queryByText(/🍽 Restaurants/)).not.toBeInTheDocument()
  })

  it("shows chips again when focusLayers is empty", () => {
    render(
      <ChatPanel
        onSearch={vi.fn()}
        isLoading={false}
        initialMode="text"
        focusLayers={new Set()}
      />,
    )
    expect(screen.getByText(/🍽 Restaurants/)).toBeInTheDocument()
  })
})
