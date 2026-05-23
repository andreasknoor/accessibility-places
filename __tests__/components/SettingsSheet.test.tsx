import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
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
    expect(screen.queryByText("Allgemein")).toBeNull()
  })

  it("panel opens when gear button is clicked", () => {
    renderSheet()
    fireEvent.click(screen.getByRole("button", { name: /Einstellungen/i }))
    expect(screen.getByText("Allgemein")).toBeInTheDocument()
    expect(screen.getByText("Ergebnisse")).toBeInTheDocument()
    // "Karte" is both a section heading and a select option — check section heading via role
    expect(screen.getAllByText("Karte").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("Mobil")).toBeInTheDocument()
  })

  it("panel closes when the close button is clicked", () => {
    renderSheet()
    fireEvent.click(screen.getByRole("button", { name: /Einstellungen/i }))
    expect(screen.getByText("Allgemein")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Schließen/i }))
    expect(screen.queryByText("Allgemein")).toBeNull()
  })

  it("toggling autoZoom calls onUpdate with { autoZoom: false }", () => {
    const onUpdate = vi.fn()
    renderSheet({ ...DEFAULT_APP_SETTINGS, autoZoom: true }, onUpdate)
    fireEvent.click(screen.getByRole("button", { name: /Einstellungen/i }))
    // autoZoom toggle is the first switch (aria-checked=true)
    const autoZoomSwitch = screen
      .getAllByRole("switch")
      .find((el) => el.getAttribute("aria-checked") === "true")
    expect(autoZoomSwitch).toBeDefined()
    fireEvent.click(autoZoomSwitch!)
    expect(onUpdate).toHaveBeenCalledWith({ autoZoom: false })
  })

  it("toggling alwaysShowParking calls onUpdate with { alwaysShowParking: true }", () => {
    const onUpdate = vi.fn()
    renderSheet({ ...DEFAULT_APP_SETTINGS, alwaysShowParking: false }, onUpdate)
    fireEvent.click(screen.getByRole("button", { name: /Einstellungen/i }))
    const parkingSwitch = screen
      .getAllByRole("switch")
      .find((el) => el.getAttribute("aria-checked") === "false")
    expect(parkingSwitch).toBeDefined()
    fireEvent.click(parkingSwitch!)
    expect(onUpdate).toHaveBeenCalledWith({ alwaysShowParking: true })
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

  it("search mode select includes 'place' option", () => {
    renderSheet()
    fireEvent.click(screen.getByRole("button", { name: /Einstellungen/i }))
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[]
    const modeSelect = selects.find(
      (s) => Array.from(s.options).some((o) => o.value === "place"),
    )
    expect(modeSelect).toBeDefined()
    const options = Array.from(modeSelect!.options).map((o) => o.value)
    expect(options).toContain("text")
    expect(options).toContain("nearby")
    expect(options).toContain("place")
  })
})
