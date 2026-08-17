import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import PlaceDebugSheet from "@/components/results/PlaceDebugSheet"
import type { Place, SearchFilters } from "@/lib/types"

vi.mock("@/lib/tally", () => ({ openTallyPopup: vi.fn() }))
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), getPlatform: () => "web" }))
vi.mock("@/lib/native/navigation", () => ({
  startDefaultNavigation: vi.fn(),
  startNavigationWithApp: vi.fn(),
  shouldShowChooser: () => false,
}))
vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>()
  return { ...actual, TALLY_DATA_ERROR_FORMS: { de: "testFormDe", en: "testFormEn" } }
})

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

  it("is a labelled modal dialog and moves focus inside on open (WCAG 2.4.3)", () => {
    renderSheet()
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(dialog).toHaveAttribute("aria-labelledby", "place-sheet-title")
    // Focus moved into the dialog rather than staying behind it.
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it("closes on Escape (WCAG 2.1.2)", () => {
    const onClose = vi.fn()
    renderSheet(makePlace(), onClose)
    fireEvent.keyDown(document, { key: "Escape" })
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

  // v13/docs/plans/reliability-tiers.md decision 1b: the section title no
  // longer shows a percentage — it's a neutral "Verlässlichkeit" heading; the
  // tier lives per-criterion (ReliabilityBars below), and the table (2026-08-03
  // redesign) is the section's only content — no separate expandable chip/
  // evidence-sum breakdown anymore (ConfidenceBadge.tsx/ScoreContent removed:
  // it duplicated exactly what the table's own row already says).
  it("shows a neutral section heading, no percentage", () => {
    renderSheet()
    expect(screen.getByText("Verlässlichkeit")).toBeInTheDocument()
    expect(screen.queryByText(/75%/)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Verlässlichkeit" })).not.toBeInTheDocument()
  })

  // ReliabilityBars renders the tier as an accessible name (role="img"
  // aria-label), not as visible text — three fill bars are the visual, the
  // tier word is still what a screen reader announces.
  it("shows a per-criterion reliability tier for known values, not for unknown (v13: neutral 4-tier)", () => {
    // Fixture: entrance yes @0.75 (OSM alone) → "gut"; toilet unknown → no
    // tier; a lone weak source (Google @0.35) on toilet → "gering".
    renderSheet(makePlace({
      accessibility: {
        entrance: { value: "yes", confidence: 0.75, conflict: false, sources: [{ sourceId: "osm", value: "yes", rawValue: "yes", reliabilityWeight: 0.75 }], details: {} },
        toilet:   { value: "yes", confidence: 0.35, conflict: false, sources: [{ sourceId: "google_places", value: "yes", rawValue: "true", reliabilityWeight: 0.35 }], details: {} },
        parking:  { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
      },
    }))
    expect(screen.getByRole("img", { name: "gut" })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "gering" })).toBeInTheDocument()
  })

  it("shows no reliability tier when every criterion is unknown", () => {
    renderSheet(makePlace({
      accessibility: {
        entrance: { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
        toilet:   { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
        parking:  { value: "unknown", confidence: 0, conflict: false, sources: [], details: {} },
      },
    }))
    expect(screen.queryByRole("img", { name: "sehr hoch" })).toBeNull()
    expect(screen.queryByRole("img", { name: "gut" })).toBeNull()
    expect(screen.queryByRole("img", { name: "gering" })).toBeNull()
  })

  // 2026-08-03 table redesign, Fix #1: which criteria count toward the
  // judgement headline's "deine N Kriterien" is no longer only implicit —
  // the table marks each row that's part of the active filters.
  describe("'Gefiltert' column", () => {
    const FILTERS: SearchFilters = {
      entrance: true, toilet: false, parking: false, parkingNearby: true, seating: false,
      onlyVerified: false, acceptUnknown: false, alwaysShowParking: false, alwaysShowToilets: false, openNowOnly: false,
    }

    it("marks a row that is part of the active filters", () => {
      render(<PlaceDebugSheet place={makePlace()} onClose={vi.fn()} filters={FILTERS} />)
      expect(screen.getAllByLabelText("Gehört zu deinen Filtern").length).toBeGreaterThan(0)
    })

    it("marks a row that is NOT part of the active filters as info-only", () => {
      render(<PlaceDebugSheet place={makePlace()} onClose={vi.fn()} filters={FILTERS} />)
      // toilet/parking are both inactive filters in FILTERS above
      expect(screen.getAllByLabelText("Nur zur Info gezeigt").length).toBeGreaterThan(0)
    })

    it("marks every row as info-only when no filters prop is given", () => {
      renderSheet()
      expect(screen.queryByLabelText("Gehört zu deinen Filtern")).not.toBeInTheDocument()
      expect(screen.getAllByLabelText("Nur zur Info gezeigt").length).toBeGreaterThan(0)
    })
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

// ─── Report data error ────────────────────────────────────────────────────────

describe("PlaceDebugSheet report data error", () => {
  it("closes the sheet and opens the Tally popup prefilled with the place deep link", async () => {
    const { openTallyPopup } = await import("@/lib/tally")
    const onClose = vi.fn()
    // toilet is "unknown" (no "no" on entrance/toilet) → contribute mode, see
    // the "contextual label" describe block below.
    renderSheet(makePlace(), onClose)

    fireEvent.click(screen.getByText("Info ergänzen"))
    expect(onClose).toHaveBeenCalledOnce()

    await vi.waitFor(() => expect(openTallyPopup).toHaveBeenCalledOnce())
    const [formId, hiddenFields] = (openTallyPopup as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, string>]
    expect(formId).toBe("testFormDe")
    expect(hiddenFields.deeplink).toContain("selectLat=52.52")
    expect(hiddenFields.deeplink).toContain("selectName=Caf%C3%A9+Sonnenschein")
    expect(hiddenFields.placeName).toBe("Café Sonnenschein")
    expect(hiddenFields.category).toBe("cafe")
    expect(hiddenFields.entrance).toBe("yes")
    expect(hiddenFields.toilet).toBe("unknown")
    expect(hiddenFields.parking).toBe("no")
    expect(hiddenFields.sources).toBe("osm")
    expect(hiddenFields.osmUrl).toBe("https://www.openstreetmap.org/node/12345678")
  })
})

// ─── Report button contextual label ───────────────────────────────────────────

describe("PlaceDebugSheet report button contextual label", () => {
  it("shows 'Datenfehler melden' when both entrance and toilet are known (no 'no', no 'unknown')", () => {
    renderSheet(makePlace({
      accessibility: {
        entrance: { value: "yes", confidence: 0.75, conflict: false, sources: [], details: {} },
        toilet:   { value: "yes", confidence: 0.75, conflict: false, sources: [], details: {} },
        parking:  { value: "no",  confidence: 0.75, conflict: false, sources: [], details: {} },
      },
    }))
    expect(screen.getByText("Datenfehler melden")).toBeInTheDocument()
    expect(screen.queryByText("Info ergänzen")).not.toBeInTheDocument()
  })

  it("shows 'Info ergänzen' when a criterion is unknown and none is 'no'", () => {
    renderSheet(makePlace({
      accessibility: {
        entrance: { value: "yes",     confidence: 0.75, conflict: false, sources: [], details: {} },
        toilet:   { value: "unknown", confidence: 0,    conflict: false, sources: [], details: {} },
        parking:  { value: "yes",     confidence: 0.75, conflict: false, sources: [], details: {} },
      },
    }))
    expect(screen.getByText("Info ergänzen")).toBeInTheDocument()
    expect(screen.queryByText("Datenfehler melden")).not.toBeInTheDocument()
  })

  it("prefers 'Datenfehler melden' over 'Info ergänzen' when both a 'no' and an 'unknown' are present", () => {
    renderSheet(makePlace({
      accessibility: {
        entrance: { value: "no",      confidence: 0.75, conflict: false, sources: [], details: {} },
        toilet:   { value: "unknown", confidence: 0,    conflict: false, sources: [], details: {} },
        parking:  { value: "yes",     confidence: 0.75, conflict: false, sources: [], details: {} },
      },
    }))
    expect(screen.getByText("Datenfehler melden")).toBeInTheDocument()
    expect(screen.queryByText("Info ergänzen")).not.toBeInTheDocument()
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

// ─── Navigate button (docs/plans/native-navigate-here.md, Placement 3) ───────

describe("PlaceDebugSheet navigate button", () => {
  it("renders a sticky 'Navigation starten' button in the footer, above the close button", async () => {
    const { startDefaultNavigation } = await import("@/lib/native/navigation")
    renderSheet()
    const navigateBtn = screen.getByRole("button", { name: "Navigation starten" })
    expect(navigateBtn).toBeInTheDocument()
    fireEvent.click(navigateBtn)
    expect(startDefaultNavigation).toHaveBeenCalledWith({ lat: 52.52, lon: 13.405 })
  })
})

// ─── Judgement line "Kriterien" link (2026-08-02) ──────────────────────────
// The Info-Sheet is the ONLY surface where this link is real — see
// JudgmentLine.tsx's own comment on why the result card never gets one.

describe("PlaceDebugSheet judgement line", () => {
  const FILTERS: SearchFilters = {
    entrance: true, toilet: true, parking: false, parkingNearby: true, seating: false,
    onlyVerified: false, acceptUnknown: false, alwaysShowParking: false, alwaysShowToilets: false, openNowOnly: false,
  }

  it("renders the criteria count as a popover trigger when onOpenFilters is given, calling it only via 'Filter bearbeiten'", () => {
    const onOpenFilters = vi.fn()
    render(<PlaceDebugSheet place={makePlace()} onClose={vi.fn()} filters={FILTERS} onOpenFilters={onOpenFilters} />)
    fireEvent.click(screen.getByRole("button", { name: "Aktive Kriterien anzeigen" }))
    expect(onOpenFilters).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Filter bearbeiten" }))
    expect(onOpenFilters).toHaveBeenCalledOnce()
  })

  // Regression (2026-08-03): onOpenFilters alone only flips state behind the
  // sheet (setActiveTab("filter") on mobile, setFilterCollapsed(false) on
  // desktop) — this sheet is a fixed full-screen overlay on top of it, so
  // without also closing it, the switch happened invisibly and "Filter
  // bearbeiten" looked like it did nothing.
  it("also closes the sheet when 'Filter bearbeiten' is clicked", () => {
    const onClose = vi.fn()
    render(<PlaceDebugSheet place={makePlace()} onClose={onClose} filters={FILTERS} onOpenFilters={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Aktive Kriterien anzeigen" }))
    fireEvent.click(screen.getByRole("button", { name: "Filter bearbeiten" }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("renders the criteria count as plain text when onOpenFilters is absent", () => {
    render(<PlaceDebugSheet place={makePlace()} onClose={vi.fn()} filters={FILTERS} />)
    expect(screen.queryByRole("button", { name: "Aktive Kriterien anzeigen" })).not.toBeInTheDocument()
    expect(screen.getByText("deine 2 Kriterien")).toBeInTheDocument()
  })
})
