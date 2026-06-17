import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import PlaceDebugSheet from "@/components/results/PlaceDebugSheet"
import type { Place } from "@/lib/types"

vi.mock("@/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n")>()
  const de = (await import("@/lib/i18n/de")).default
  return {
    ...actual,
    useTranslations: () => de,
    useLocale: () => ({ locale: "de", setLocale: vi.fn() }),
  }
})

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "place-1",
    name: "Café Sonnenschein",
    category: "cafe",
    address: { street: "Hauptstraße", houseNumber: "5", postalCode: "10115", city: "Berlin", country: "DE" },
    coordinates: { lat: 52.52, lon: 13.405 },
    accessibility: {
      entrance: { value: "yes",     confidence: 0.75, conflict: false, sources: [{ sourceId: "osm", value: "yes", rawValue: "yes", reliabilityWeight: 0.75 }], details: {} },
      toilet:   { value: "unknown", confidence: 0,    conflict: false, sources: [], details: {} },
      parking:  { value: "no",      confidence: 0.75, conflict: false, sources: [], details: {} },
    },
    overallConfidence: 0.75,
    primarySource: "osm",
    sourceRecords: [
      { sourceId: "osm", externalId: "node/12345678", fetchedAt: "2024-01-01T12:00:00Z", raw: null, metadata: {} },
    ],
    ...overrides,
  }
}

function renderSheet(place = makePlace(), onClose = vi.fn()) {
  return render(<PlaceDebugSheet place={place} onClose={onClose} />)
}

// ─── Header ──────────────────────────────────────────────────────────────────

describe("PlaceDebugSheet header", () => {
  it("shows place name", () => {
    renderSheet()
    expect(screen.getByText("Café Sonnenschein")).toBeInTheDocument()
  })

  it("shows formatted address", () => {
    renderSheet()
    // Address appears in both header and Grunddaten section
    expect(screen.getAllByText(/Hauptstraße 5/).length).toBeGreaterThanOrEqual(1)
  })

  it("calls onClose when close button in header is clicked", () => {
    const onClose = vi.fn()
    renderSheet(makePlace(), onClose)
    const closeButtons = screen.getAllByLabelText(/Schließen/i)
    fireEvent.click(closeButtons[0])
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("calls onClose when sticky close button at bottom is clicked", () => {
    const onClose = vi.fn()
    renderSheet(makePlace(), onClose)
    fireEvent.click(screen.getByText(/Schließen/))
    expect(onClose).toHaveBeenCalled()
  })

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn()
    const { container } = renderSheet(makePlace(), onClose)
    const backdrop = container.querySelector(".fixed.inset-0") as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledOnce()
  })
})

// ─── Copy link ───────────────────────────────────────────────────────────────

describe("PlaceDebugSheet copy link", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  // In jsdom navigator.share is unavailable, so shareOrCopy falls back to the
  // clipboard — same observable behaviour as before. The button is now labelled
  // "Teilen" (native share sheet on mobile, clipboard copy on desktop).
  it("copies a URL containing selectLat, selectLon, selectName, cat", async () => {
    renderSheet()
    fireEvent.click(screen.getByLabelText(/Teilen/i))
    await vi.waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("selectLat=52.52"),
      ),
    )
    const url = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain("selectLon=13.405")
    expect(url).toContain("selectName=Caf%C3%A9+Sonnenschein")
    expect(url).toContain("cat=cafe")
  })

  it("shows 'Link kopiert' feedback after copying", async () => {
    renderSheet()
    fireEvent.click(screen.getByLabelText(/Teilen/i))
    await vi.waitFor(() => expect(screen.getByText("Link kopiert")).toBeInTheDocument())
  })
})

// ─── Accessibility section ────────────────────────────────────────────────────

describe("PlaceDebugSheet accessibility section", () => {
  it("displays entrance value", () => {
    renderSheet()
    expect(screen.getByText("Eingang")).toBeInTheDocument()
    expect(screen.getByText("Ja")).toBeInTheDocument()
  })

  it("shows confidence percentage in the section heading", () => {
    renderSheet()
    expect(screen.getByText(/75%/)).toBeInTheDocument()
  })

  it("shows seating row only when seating data is present", () => {
    renderSheet()
    expect(screen.queryByText("Sitzplätze")).toBeNull()

    renderSheet(makePlace({
      accessibility: {
        entrance: { value: "yes", confidence: 0.75, conflict: false, sources: [], details: {} },
        toilet:   { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
        parking:  { value: "no", confidence: 0.75, conflict: false, sources: [], details: {} },
        seating:  { value: "yes", confidence: 0.75, conflict: false, sources: [], details: {} },
      },
    }))
    expect(screen.getAllByText("Sitzplätze")[0]).toBeInTheDocument()
  })
})

// ─── External links ───────────────────────────────────────────────────────────

describe("PlaceDebugSheet external links", () => {
  it("renders a Wheelmap.org link", () => {
    renderSheet()
    const link = screen.getByText("Wheelmap.org").closest("a") as HTMLAnchorElement
    expect(link.href).toContain("wheelmap.org")
  })

  it("renders an OSM link when place has an OSM source record", () => {
    renderSheet()
    const osmLink = screen.getByText("node/12345678").closest("a") as HTMLAnchorElement
    expect(osmLink.href).toContain("openstreetmap.org")
    expect(osmLink.href).toContain("node/12345678")
  })

  it("renders a Google Maps link", () => {
    renderSheet()
    // "Google Maps" appears as both row label and link text — target the <a> directly
    const gmLink = screen.getByRole("link", { name: "Google Maps" })
    expect((gmLink as HTMLAnchorElement).href).toContain("google.com/maps")
  })

  it("renders Ginto link when gintoUrl is present", () => {
    renderSheet(makePlace({ gintoUrl: "https://ginto.guide/places/abc" }))
    const gintoLink = screen.getByText("Ginto.guide").closest("a") as HTMLAnchorElement
    expect(gintoLink.href).toBe("https://ginto.guide/places/abc")
  })

  it("does not render Ginto link when gintoUrl is absent", () => {
    renderSheet(makePlace({ gintoUrl: undefined }))
    expect(screen.queryByText("Ginto.guide")).toBeNull()
  })

  it("shows Reisen für Alle badge when place has RfA source record", () => {
    renderSheet(makePlace({
      sourceRecords: [
        { sourceId: "osm", externalId: "node/1", fetchedAt: "2024-01-01T00:00:00Z", raw: null, metadata: {} },
        { sourceId: "reisen_fuer_alle", externalId: "rfa-123", fetchedAt: "2024-01-01T00:00:00Z", raw: null, metadata: {} },
      ],
    }))
    expect(screen.getByText("Zertifizierter Eintrag")).toBeInTheDocument()
  })
})

// ─── Raw data toggle ──────────────────────────────────────────────────────────

describe("PlaceDebugSheet raw data toggle", () => {
  it("raw data is hidden by default", () => {
    renderSheet()
    expect(screen.queryByText(/node\/12345678/)).not.toBeNull() // external links section has it
    // the raw JSON block (pre) should not be visible initially
    expect(screen.queryByText("Rohdaten anzeigen")).toBeInTheDocument()
  })

  it("shows raw data section after clicking toggle", () => {
    renderSheet()
    fireEvent.click(screen.getByText("Rohdaten anzeigen"))
    expect(screen.getByText("Rohdaten ausblenden")).toBeInTheDocument()
  })

  it("hides raw data again after second click", () => {
    renderSheet()
    fireEvent.click(screen.getByText("Rohdaten anzeigen"))
    fireEvent.click(screen.getByText("Rohdaten ausblenden"))
    expect(screen.getByText("Rohdaten anzeigen")).toBeInTheDocument()
  })
})

// ─── Optional fields ─────────────────────────────────────────────────────────

describe("PlaceDebugSheet optional fields", () => {
  it("shows phone link when place has phone", () => {
    renderSheet(makePlace({ phone: "+49 30 12345" }))
    const tel = screen.getByText("+49 30 12345").closest("a") as HTMLAnchorElement
    expect(tel.href).toBe("tel:+49 30 12345")
  })

  it("shows website link when place has website", () => {
    renderSheet(makePlace({ website: "https://example.com" }))
    const link = screen.getByText("example.com").closest("a") as HTMLAnchorElement
    expect(link.href).toBe("https://example.com/")
  })

  it("does not show Angebot section when no offer data is present", () => {
    renderSheet()
    expect(screen.queryByText("Angebot")).toBeNull()
  })
})
