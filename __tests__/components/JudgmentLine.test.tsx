import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { LocaleProvider } from "@/lib/i18n"
import JudgmentLine from "@/components/results/JudgmentLine"
import { buildAttribute, emptyAttribute } from "@/lib/matching/merge"
import type { JudgmentFilters } from "@/lib/reliability"
import type { Place } from "@/lib/types"

// 2026-08-02: the headline now names the count of active filter criteria
// ("deine 2 Kriterien"), and — only when onOpenFilters is given (the
// Info-Sheet's usage, never the result card's own) — renders that count as
// a real, clickable link to the filter view.

function renderWithProvider(ui: React.ReactElement) {
  return render(<LocaleProvider initialLocale="de">{ui}</LocaleProvider>)
}

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "Test Place",
    category: "restaurant",
    address: { street: "", houseNumber: "", postalCode: "", city: "Berlin", country: "DE" },
    coordinates: { lat: 52.52, lon: 13.405 },
    accessibility: {
      entrance: buildAttribute("osm", "yes", "yes", {}),
      toilet:   buildAttribute("osm", "yes", "yes", {}),
      parking:  emptyAttribute(),
    },
    overallConfidence: 0.75,
    primarySource: "osm",
    sourceRecords: [],
    ...overrides,
  }
}

const TWO_ACTIVE: JudgmentFilters = { entrance: true, toilet: true, parking: false, seating: false, acceptUnknown: false }
const ONE_ACTIVE: JudgmentFilters = { entrance: true, toilet: false, parking: false, seating: false, acceptUnknown: false }

describe("JudgmentLine — criteria count", () => {
  it("names the count for two active criteria", () => {
    renderWithProvider(<JudgmentLine place={makePlace()} filters={TWO_ACTIVE} />)
    expect(screen.getByText("deine 2 Kriterien")).toBeInTheDocument()
  })

  it("uses the singular form for exactly one active criterion", () => {
    renderWithProvider(<JudgmentLine place={makePlace()} filters={ONE_ACTIVE} />)
    expect(screen.getByText("dein Kriterium")).toBeInTheDocument()
  })

  it("names the count in the fail headline too", () => {
    const place = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "no", "no", {}),
        toilet:   buildAttribute("osm", "yes", "yes", {}),
        parking:  emptyAttribute(),
      },
    })
    renderWithProvider(<JudgmentLine place={place} filters={TWO_ACTIVE} />)
    expect(screen.getByText("deine 2 Kriterien")).toBeInTheDocument()
    expect(screen.getByText("Betrifft: Eingang.")).toBeInTheDocument()
  })

  it("does not count against 'unverified', which has its own non-criteria wording", () => {
    const place = makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   emptyAttribute(),
        parking:  emptyAttribute(),
      },
    })
    renderWithProvider(<JudgmentLine place={place} filters={{ ...TWO_ACTIVE, acceptUnknown: true }} />)
    expect(screen.getByText("Nicht gesichert")).toBeInTheDocument()
    expect(screen.queryByText(/Kriterien|Kriterium/)).not.toBeInTheDocument()
  })
})

describe("JudgmentLine — 'Kriterien' popover (only when onOpenFilters is given)", () => {
  it("renders the criteria text as plain, non-interactive text when onOpenFilters is absent", () => {
    renderWithProvider(<JudgmentLine place={makePlace()} filters={TWO_ACTIVE} />)
    expect(screen.queryByRole("button", { name: "Aktive Kriterien anzeigen" })).not.toBeInTheDocument()
    expect(screen.getByText("deine 2 Kriterien")).toBeInTheDocument()
  })

  it("renders a real, labelled trigger that does NOT call onOpenFilters directly (opens a popover instead)", () => {
    const onOpenFilters = vi.fn()
    renderWithProvider(<JudgmentLine place={makePlace()} filters={TWO_ACTIVE} onOpenFilters={onOpenFilters} />)
    const trigger = screen.getByRole("button", { name: "Aktive Kriterien anzeigen" })
    expect(trigger).toHaveTextContent("deine 2 Kriterien")
    fireEvent.click(trigger)
    expect(onOpenFilters).not.toHaveBeenCalled()
  })

  it("names the active criteria inside the popover", () => {
    renderWithProvider(<JudgmentLine place={makePlace()} filters={TWO_ACTIVE} onOpenFilters={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Aktive Kriterien anzeigen" }))
    expect(screen.getByText("Deine aktiven Kriterien")).toBeInTheDocument()
    expect(screen.getByText("Eingang")).toBeInTheDocument()
    expect(screen.getByText("Toilette")).toBeInTheDocument()
    expect(screen.queryByText("Parkplatz")).not.toBeInTheDocument()
  })

  it("only calls onOpenFilters via the popover's own 'Filter bearbeiten' button", () => {
    const onOpenFilters = vi.fn()
    renderWithProvider(<JudgmentLine place={makePlace()} filters={TWO_ACTIVE} onOpenFilters={onOpenFilters} />)
    fireEvent.click(screen.getByRole("button", { name: "Aktive Kriterien anzeigen" }))
    fireEvent.click(screen.getByRole("button", { name: "Filter bearbeiten" }))
    expect(onOpenFilters).toHaveBeenCalledOnce()
  })

  it("stops propagation so opening the trigger doesn't also fire a parent's own click handler", () => {
    const onOpenFilters = vi.fn()
    const onParentClick = vi.fn()
    renderWithProvider(
      <div onClick={onParentClick}>
        <JudgmentLine place={makePlace()} filters={TWO_ACTIVE} onOpenFilters={onOpenFilters} />
      </div>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Aktive Kriterien anzeigen" }))
    expect(onParentClick).not.toHaveBeenCalled()
  })
})

describe("JudgmentLine — no active criteria", () => {
  it("shows the neutral 'no criteria active' text, uninfluenced by onOpenFilters", () => {
    const onOpenFilters = vi.fn()
    renderWithProvider(
      <JudgmentLine
        place={makePlace()}
        filters={{ entrance: false, toilet: false, parking: false, seating: false, acceptUnknown: false }}
        onOpenFilters={onOpenFilters}
      />,
    )
    expect(screen.getByText("Keine Kriterien aktiv")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Aktive Kriterien anzeigen" })).not.toBeInTheDocument()
  })
})

// Regression: the filter-rail/mobile-tab badges count onlyVerified as one of
// the ticked boxes; the headline used to compute its own count from
// CRITERION_KEYS only and silently forgot it — "3" in the badge, "deine 2
// Kriterien" in the headline, for the exact same filter selection.
describe("JudgmentLine — onlyVerified counts toward the headline", () => {
  it("includes onlyVerified in the count alongside two real criteria", () => {
    renderWithProvider(
      <JudgmentLine place={makePlace()} filters={{ ...TWO_ACTIVE, onlyVerified: true }} />,
    )
    expect(screen.getByText("deine 3 Kriterien")).toBeInTheDocument()
  })

  it("counts onlyVerified alone with the singular form", () => {
    renderWithProvider(
      <JudgmentLine
        place={makePlace()}
        filters={{ entrance: false, toilet: false, parking: false, seating: false, acceptUnknown: false, onlyVerified: true }}
      />,
    )
    expect(screen.getByText("dein Kriterium")).toBeInTheDocument()
  })

  it("lists 'Nur manuell verifizierte Orte' in the popover alongside the real criteria", () => {
    renderWithProvider(
      <JudgmentLine place={makePlace()} filters={{ ...TWO_ACTIVE, onlyVerified: true }} onOpenFilters={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Aktive Kriterien anzeigen" }))
    expect(screen.getByText("Nur manuell verifizierte Orte")).toBeInTheDocument()
  })

  it("fails the judgement (not just the count) when onlyVerified has no verified source, even if the real criteria pass", () => {
    renderWithProvider(
      <JudgmentLine place={makePlace()} filters={{ ...TWO_ACTIVE, onlyVerified: true }} />,
    )
    // makePlace()'s fixture entrance/toilet are "yes" but carry no
    // verifiedRecently source, so onlyVerified must fail the whole judgement.
    expect(screen.getByText("deine 3 Kriterien")).toBeInTheDocument()
    expect(screen.getByText(/nicht$/)).toBeInTheDocument()
    expect(screen.getByText(/Verifizierung/)).toBeInTheDocument()
  })
})
