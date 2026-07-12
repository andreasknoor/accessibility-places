import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import SettingsSheet from "@/components/settings/SettingsSheet"
import { DEFAULT_APP_SETTINGS } from "@/lib/settings"
import type { AppSettings } from "@/lib/settings"

vi.mock("@/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n")>()
  const de = (await import("@/lib/i18n/de")).default
  return {
    ...actual,
    useTranslations: () => de,
    useLocale: () => ({ locale: "de", setLocale: vi.fn() }),
  }
})

function renderSheet(
  settings: AppSettings = DEFAULT_APP_SETTINGS,
  onUpdate = vi.fn(),
) {
  return render(<SettingsSheet settings={settings} onUpdate={onUpdate} />)
}

describe("SettingsSheet", () => {
  it("renders the gear icon button", () => {
    renderSheet()
    expect(screen.getByRole("button", { name: /Einstellungen/i })).toBeInTheDocument()
  })

  it("panel is not visible initially", () => {
    renderSheet()
    expect(screen.queryByText("Start & Suche")).toBeNull()
  })

  it("panel opens when gear button is clicked", () => {
    renderSheet()
    fireEvent.click(screen.getByRole("button", { name: /Einstellungen/i }))
    expect(screen.getByText("Start & Suche")).toBeInTheDocument()
    expect(screen.getByText("Ergebnisse")).toBeInTheDocument()
    expect(screen.getByText("Karte & Parkplätze")).toBeInTheDocument()
  })

  it("panel closes when the close button is clicked", () => {
    renderSheet()
    fireEvent.click(screen.getByRole("button", { name: /Einstellungen/i }))
    expect(screen.getByText("Start & Suche")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Schließen/i }))
    expect(screen.queryByText("Start & Suche")).toBeNull()
  })

  it("toggling autoZoom calls onUpdate with { autoZoom: false }", () => {
    const onUpdate = vi.fn()
    renderSheet({ ...DEFAULT_APP_SETTINGS, autoZoom: true }, onUpdate)
    fireEvent.click(screen.getByRole("button", { name: /Einstellungen/i }))
    // Locate the switch by its row label (robust against other toggles being
    // added/reordered — usageStats also defaults to checked).
    const label = screen.getByText("Automatischer Zoom nach Suche")
    const row = label.parentElement!.parentElement! // <p> → label wrapper → Row root
    const autoZoomSwitch = within(row).getByRole("switch")
    fireEvent.click(autoZoomSwitch)
    expect(onUpdate).toHaveBeenCalledWith({ autoZoom: false })
  })

  it("toggling showWeakParking calls onUpdate with { showWeakParking: true }", () => {
    const onUpdate = vi.fn()
    renderSheet({ ...DEFAULT_APP_SETTINGS, showWeakParking: false }, onUpdate)
    fireEvent.click(screen.getByRole("button", { name: /Einstellungen/i }))
    // Locate the switch by its row label (robust against other toggles being
    // added/reordered) rather than by position among all switches.
    const label = screen.getByText("Auch nicht reservierte Parkplätze")
    const row = label.parentElement!.parentElement! // <p> → label wrapper → Row root
    const parkingSwitch = within(row).getByRole("switch")
    fireEvent.click(parkingSwitch)
    expect(onUpdate).toHaveBeenCalledWith({ showWeakParking: true })
  })

  it("changing sortOrder select calls onUpdate with { sortOrder: 'distance' }", () => {
    const onUpdate = vi.fn()
    renderSheet({ ...DEFAULT_APP_SETTINGS, sortOrder: "confidence" }, onUpdate)
    fireEvent.click(screen.getByRole("button", { name: /Einstellungen/i }))
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[]
    // sortOrder select contains "Verlässlichkeit" and "Entfernung"
    const sortSelect = selects.find(
      (s) => Array.from(s.options).some((o) => o.value === "distance"),
    )
    expect(sortSelect).toBeDefined()
    fireEvent.change(sortSelect!, { target: { value: "distance" } })
    expect(onUpdate).toHaveBeenCalledWith({ sortOrder: "distance" })
  })

  it("changing defaultSearchMode select calls onUpdate correctly", () => {
    const onUpdate = vi.fn()
    renderSheet({ ...DEFAULT_APP_SETTINGS, defaultSearchMode: "text" }, onUpdate)
    fireEvent.click(screen.getByRole("button", { name: /Einstellungen/i }))
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[]
    const modeSelect = selects.find(
      (s) => Array.from(s.options).some((o) => o.value === "nearby"),
    )
    expect(modeSelect).toBeDefined()
    fireEvent.change(modeSelect!, { target: { value: "nearby" } })
    expect(onUpdate).toHaveBeenCalledWith({ defaultSearchMode: "nearby" })
  })

  it("search mode select contains text and nearby but not place (removed in v4.13)", () => {
    renderSheet()
    fireEvent.click(screen.getByRole("button", { name: /Einstellungen/i }))
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[]
    const modeSelect = selects.find(
      (s) => Array.from(s.options).some((o) => o.value === "text" || o.value === "nearby"),
    )
    expect(modeSelect).toBeDefined()
    const options = Array.from(modeSelect!.options).map((o) => o.value)
    expect(options).toContain("text")
    expect(options).toContain("nearby")
    expect(options).not.toContain("place")
  })
})
