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

function renderPanel(onSearch = vi.fn(), isLoading = false) {
  return render(<ChatPanel onSearch={onSearch} isLoading={isLoading} initialMode="text" />)
}

function mockFetch(suggestions: { display: string; name: string }[]) {
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
  // Match location-input placeholder specifically — the name field also contains "Ort" in DE
  return screen.getByPlaceholderText(/Ort eingeben|Enter a city/i) as HTMLInputElement
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

  it("fetches suggestions after 300 ms debounce for 2+ char input", async () => {
    mockFetch([{ display: "Berlin", name: "Berlin" }])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Be" } })
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining("q=Be"),
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
    mockFetch([{ display: "Berlin", name: "Berlin" }])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Be" } })
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    fireEvent.change(getInput(), { target: { value: "Berl" } })
    await act(() => vi.runAllTimersAsync())
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it("clears suggestions when input drops below 2 chars", async () => {
    mockFetch([{ display: "Berlin", name: "Berlin" }])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    await act(() => vi.runAllTimersAsync())
    expect(screen.getByRole("listbox")).toBeInTheDocument()

    fireEvent.change(getInput(), { target: { value: "B" } })
    await act(() => vi.runAllTimersAsync())
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })
})

// ─── Dropdown rendering ──────────────────────────────────────────────────────

describe("ChatPanel autocomplete — dropdown", () => {
  it("shows suggestion items when API returns data", async () => {
    mockFetch([
      { display: "Berlin", name: "Berlin" },
      { display: "Mitte, Berlin", name: "Mitte" },
    ])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    expect(screen.getByText("Berlin")).toBeInTheDocument()
    // "Mitte, Berlin" is rendered as <span>Mitte</span>, Berlin — match by full text content
    expect(screen.getByText((_, el) => el?.textContent === "Mitte, Berlin")).toBeInTheDocument()
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
    mockFetch([{ display: "Berlin", name: "Berlin" }])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())
    expect(screen.getByRole("listbox")).toBeInTheDocument()

    fireEvent.keyDown(getInput(), { key: "Escape" })
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })
})

// ─── Keyboard navigation ─────────────────────────────────────────────────────

describe("ChatPanel autocomplete — keyboard navigation", () => {
  it("ArrowDown highlights first item", async () => {
    mockFetch([{ display: "Berlin", name: "Berlin" }])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    const option = screen.getByRole("option", { name: "Berlin" })
    expect(option).toHaveAttribute("aria-selected", "true")
  })

  it("ArrowUp after ArrowDown moves highlight back", async () => {
    mockFetch([
      { display: "Berlin", name: "Berlin" },
      { display: "Hamburg", name: "Hamburg" },
    ])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    fireEvent.keyDown(getInput(), { key: "ArrowUp" })
    const first = screen.getByRole("option", { name: "Berlin" })
    expect(first).toHaveAttribute("aria-selected", "true")
  })

  it("Enter with highlighted item selects the suggestion", async () => {
    const onSearch = vi.fn()
    mockFetch([{ display: "Berlin", name: "Berlin" }])
    renderPanel(onSearch)
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.keyDown(getInput(), { key: "ArrowDown" })
    fireEvent.keyDown(getInput(), { key: "Enter" })

    expect(onSearch).toHaveBeenCalledWith(expect.stringContaining("Berlin"), undefined, undefined)
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("Enter without highlighted item submits the current input", async () => {
    const onSearch = vi.fn()
    mockFetch([{ display: "Berlin", name: "Berlin" }])
    renderPanel(onSearch)
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.keyDown(getInput(), { key: "Enter" })
    expect(onSearch).toHaveBeenCalledWith(expect.stringContaining("Berlin"), undefined, undefined)
  })
})

// ─── Suggestion selection ────────────────────────────────────────────────────

describe("ChatPanel autocomplete — selection", () => {
  it("clicking a suggestion sets the input value and triggers search", async () => {
    const onSearch = vi.fn()
    mockFetch([{ display: "Mitte, Berlin", name: "Mitte" }])
    renderPanel(onSearch)
    fireEvent.change(getInput(), { target: { value: "Mit" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.mouseDown(screen.getByRole("option", { name: "Mitte, Berlin" }))
    expect(getInput().value).toBe("Mitte, Berlin")
    expect(onSearch).toHaveBeenCalledWith(expect.stringContaining("Mitte, Berlin"), undefined, undefined)
  })

  it("passes name field value as nameHint to onSearch when selecting a suggestion", async () => {
    const onSearch = vi.fn()
    mockFetch([{ display: "Berlin", name: "Berlin" }])
    renderPanel(onSearch)
    // Name field is always visible in text mode (desktop) — fill it first
    const nameInput = screen.getByPlaceholderText(/Hotel Adlon Berlin/i) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: "Goldener Löwe" } })
    // Type and select location
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())
    fireEvent.mouseDown(screen.getByRole("option", { name: "Berlin" }))
    expect(onSearch).toHaveBeenCalledWith(
      expect.stringContaining("Berlin"),
      undefined,
      "Goldener Löwe",
    )
  })

  it("closes the dropdown after selecting a suggestion", async () => {
    mockFetch([{ display: "Berlin", name: "Berlin" }])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.mouseDown(screen.getByRole("option", { name: "Berlin" }))
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("does not re-open the dropdown after selection even after debounce fires", async () => {
    // Regression: selecting a suggestion triggers setLocation which used to re-fetch
    // and call setShowSuggestions(true) 300 ms later (visible bug on iPhone).
    mockFetch([{ display: "Berlin", name: "Berlin" }])
    renderPanel()
    fireEvent.change(getInput(), { target: { value: "Ber" } })
    await act(() => vi.runAllTimersAsync())

    fireEvent.mouseDown(screen.getByRole("option", { name: "Berlin" }))
    // Advance past debounce — must NOT re-open
    await act(() => vi.advanceTimersByTimeAsync(500))
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
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
    mockFetch([{ display: "Berlin", name: "Berlin" }])
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
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialChipIdx={2} />)
    // chip index 2 = Hotels
    const buttons = screen.getAllByRole("button")
    const hotelChip = buttons.find((b) => b.textContent?.includes("Hotels"))
    expect(hotelChip).toBeDefined()
    expect(hotelChip).toHaveClass("bg-primary")
  })

  it("saved last-search chip overrides initialChipIdx", () => {
    localStorage.setItem("ap_last_search", JSON.stringify({ idx: 1, loc: "Berlin" }))
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialChipIdx={2} />)
    const buttons = screen.getAllByRole("button")
    const cafeChip  = buttons.find((b) => b.textContent?.includes("Cafés"))
    const hotelChip = buttons.find((b) => b.textContent?.includes("Hotels"))
    expect(cafeChip).toHaveClass("bg-primary")
    expect(hotelChip).not.toHaveClass("bg-primary")
  })

  it("falls back to initialChipIdx when saved idx is invalid", () => {
    localStorage.setItem("ap_last_search", JSON.stringify({ idx: 999, loc: "Berlin" }))
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialChipIdx={3} />)
    const buttons = screen.getAllByRole("button")
    // chip index 3 = Biergärten
    const biergartChip = buttons.find((b) => b.textContent?.includes("Biergärten"))
    expect(biergartChip).toHaveClass("bg-primary")
  })

  it("defaults to chip 0 (Restaurant) when neither saved search nor initialChipIdx exist", () => {
    localStorage.clear()
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} />)
    const buttons = screen.getAllByRole("button")
    const restaurantChip = buttons.find((b) => b.textContent?.includes("Restaurants"))
    expect(restaurantChip).toHaveClass("bg-primary")
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

// ─── Parking button ──────────────────────────────────────────────────────────

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

// ─── Place-search trigger (via text mode, name field always visible) ─────────

describe("ChatPanel place-search", () => {
  function getNameInput() {
    // In text mode with empty location, name field shows the place-mode placeholder
    return screen.getByPlaceholderText(/Hotel Adlon Berlin/i) as HTMLInputElement
  }

  it("name field is always visible in text mode (no toggle required)", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    expect(getNameInput()).toBeInTheDocument()
  })

  it("search button is disabled when both location and name are empty", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} onPlaceSearch={vi.fn()} initialMode="text" />)
    const btn = screen.getByRole("button", { name: "Suchen" })
    expect(btn).toBeDisabled()
  })

  it("search button is enabled when name has content and location is empty", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} onPlaceSearch={vi.fn()} initialMode="text" />)
    fireEvent.change(getNameInput(), { target: { value: "Hotel Adlon" } })
    const btn = screen.getByRole("button", { name: "Suchen" })
    expect(btn).not.toBeDisabled()
  })

  it("clicking Suchen with name+no-location calls onPlaceSearch, not onSearch", () => {
    const onSearch = vi.fn()
    const onPlaceSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} isLoading={false} onPlaceSearch={onPlaceSearch} initialMode="text" />)
    fireEvent.change(getNameInput(), { target: { value: "Hotel Adlon" } })
    fireEvent.click(screen.getByRole("button", { name: "Suchen" }))
    expect(onPlaceSearch).toHaveBeenCalledWith("Hotel Adlon")
    expect(onSearch).not.toHaveBeenCalled()
  })

  it("pressing Enter in name field with no location calls onPlaceSearch", () => {
    const onPlaceSearch = vi.fn()
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} onPlaceSearch={onPlaceSearch} initialMode="text" />)
    fireEvent.change(getNameInput(), { target: { value: "Goldener Löwe" } })
    fireEvent.keyDown(getNameInput(), { key: "Enter" })
    expect(onPlaceSearch).toHaveBeenCalledWith("Goldener Löwe")
  })

  it("pressing Enter in name field WITH location calls onSearch, not onPlaceSearch", () => {
    const onSearch = vi.fn()
    const onPlaceSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} isLoading={false} onPlaceSearch={onPlaceSearch} initialMode="text" />)
    fireEvent.change(getInput(), { target: { value: "Berlin" } })
    // After location is filled the name field shows a different placeholder
    const nameInput = screen.getByPlaceholderText(/Zur Linde|The Crown/i) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: "Goldener Löwe" } })
    fireEvent.keyDown(nameInput, { key: "Enter" })
    expect(onSearch).toHaveBeenCalledWith(expect.stringContaining("Berlin"), undefined, "Goldener Löwe")
    expect(onPlaceSearch).not.toHaveBeenCalled()
  })
})

// ─── Place mode removed — verify two-mode UI (v4.13+) ────────────────────────

describe("ChatPanel two-mode UI (place mode removed)", () => {
  it("does NOT render an 'Ort suchen' button in the mode bar", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} />)
    expect(screen.queryByRole("button", { name: /Ort suchen/ })).not.toBeInTheDocument()
  })

  it("renders exactly two mode buttons: In der Nähe and Erkunden", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} />)
    const modeButtons = screen.getAllByRole("button", { name: /In der Nähe|Erkunden/ })
    expect(modeButtons).toHaveLength(2)
  })

  it("chip strip is visible in text mode", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="text" />)
    expect(screen.getByText(/Restaurants/)).toBeInTheDocument()
  })

  it("initialMode='place' falls back to text mode with location input visible", () => {
    render(<ChatPanel onSearch={vi.fn()} isLoading={false} initialMode="place" />)
    expect(screen.getByPlaceholderText(/Ort eingeben|Enter a city/i)).toBeInTheDocument()
  })

  it("calls onPlaceSearch when submit clicked in text mode with name-only", () => {
    const onPlaceSearch = vi.fn()
    const onSearch = vi.fn()
    render(<ChatPanel onSearch={onSearch} isLoading={false} onPlaceSearch={onPlaceSearch} initialMode="text" />)
    fireEvent.change(screen.getByPlaceholderText(/Hotel Adlon Berlin/i), { target: { value: "Café Einstein" } })
    fireEvent.click(screen.getByRole("button", { name: "Suchen" }))
    expect(onPlaceSearch).toHaveBeenCalledWith("Café Einstein")
    expect(onSearch).not.toHaveBeenCalled()
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

// ─── Quoted-name stripping ───────────────────────────────────────────────────

describe("ChatPanel autocomplete — quote stripping", () => {
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
})
