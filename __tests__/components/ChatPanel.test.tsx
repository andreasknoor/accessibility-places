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
  return render(<ChatPanel onSearch={onSearch} isLoading={isLoading} />)
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
    // Expand name field and fill it
    const nameInput = screen.getByPlaceholderText(/Name des Ortes|Venue name/i) as HTMLInputElement
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
