import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { LocaleProvider } from "@/lib/i18n"
import CriterionGlyph from "@/components/place/CriterionGlyph"
import CriterionItem from "@/components/place/CriterionItem"
import QuickstartVerdict from "@/components/place/QuickstartVerdict"
import JudgmentLine from "@/components/results/JudgmentLine"
import { buildAttribute, emptyAttribute } from "@/lib/matching/merge"
import { glyphSvgString } from "@/lib/amenities/glyph-svg"
import { RESTROOM_GLYPH } from "@/lib/amenities/badge-scene"
import de from "@/lib/i18n/de"
import en from "@/lib/i18n/en"
import { quickstartHeadline, quickstartJudgmentFilters } from "@/lib/simple-view"
import type { Place } from "@/lib/types"

// Shared building blocks of the unified place UI
// (see CLAUDE.md, "Unified place UI").

function r(ui: React.ReactElement, locale: "de" | "en" = "de") {
  return render(<LocaleProvider initialLocale={locale}>{ui}</LocaleProvider>)
}

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "Café Test",
    category: "cafe",
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

describe("CriterionGlyph", () => {
  it("renders the restroom pictogram (not the text 'WC') for the toilet criterion", () => {
    const { container } = r(<CriterionGlyph kind="toilet" value="yes" />)
    expect(container.textContent).not.toContain("WC")
    // pictogram paths + status-badge svg
    expect(container.querySelectorAll("svg").length).toBe(2)
  })

  it("is decorative — hidden from assistive technology", () => {
    const { container } = r(<CriterionGlyph kind="entrance" value="no" />)
    expect(container.firstElementChild).toHaveAttribute("aria-hidden")
  })

  it("renders no status badge when no value is given", () => {
    const { container } = r(<CriterionGlyph kind="seating" />)
    expect(container.querySelectorAll("svg").length).toBe(1)
  })
})

describe("glyphSvgString", () => {
  it("renders every fill of the spec with currentColor", () => {
    const svg = glyphSvgString(RESTROOM_GLYPH, 16)
    expect(svg).toContain('width="16"')
    expect(svg).toContain('fill="currentColor"')
    expect(svg.match(/<path /g)?.length).toBe(RESTROOM_GLYPH.fills.length)
  })
})

describe("CriterionItem", () => {
  it("compact: shows the criterion name with the value word below — no 'WC = WC' duplication", () => {
    const attr = buildAttribute("osm", "yes", "yes", {})
    r(<CriterionItem kind="toilet" attr={attr} variant="compact" />)
    expect(screen.getByText("Toilette")).toBeInTheDocument()
    expect(screen.getByText("Ja")).toBeInTheDocument()
    expect(screen.queryByText("WC")).not.toBeInTheDocument()
  })

  it("compact: uses the English criterion name in English", () => {
    const attr = buildAttribute("osm", "limited", "limited", {})
    r(<CriterionItem kind="toilet" attr={attr} variant="compact" />, "en")
    expect(screen.getByText("Toilet")).toBeInTheDocument()
    expect(screen.getByText("Limited")).toBeInTheDocument()
  })

  it("compact: words nearby-only parking with its distance", () => {
    const attr = buildAttribute("osm", "yes", "yes", { nearbyOnly: true, nearbyParkingDistanceM: 120 })
    r(<CriterionItem kind="parking" attr={attr} variant="compact" />)
    expect(screen.getByText("Ja, in der Nähe (120 m)")).toBeInTheDocument()
  })

  it("compact: flags a weak ('gering') reliability tier, stays silent otherwise", () => {
    const weak = buildAttribute("google_places", "yes", "yes", {})
    const { unmount } = r(<CriterionItem kind="toilet" attr={weak} variant="compact" />)
    expect(screen.getByText("Verlässlichkeit gering")).toBeInTheDocument()
    unmount()
    r(<CriterionItem kind="toilet" attr={buildAttribute("osm", "yes", "yes", {})} variant="compact" />)
    expect(screen.queryByText(/Verlässlichkeit/)).not.toBeInTheDocument()
  })

  it("sentence: renders the Quickstart plain-language sentence", () => {
    r(<CriterionItem kind="entrance" attr={buildAttribute("osm", "yes", "yes", {})} variant="sentence" />)
    expect(screen.getByText("Eingang stufenlos erreichbar")).toBeInTheDocument()
  })
})

describe("Quickstart verdict helpers", () => {
  it("require the toilet only for the toilet-required categories", () => {
    expect(quickstartJudgmentFilters("cafe").toilet).toBe(true)
    expect(quickstartJudgmentFilters("doctors").toilet).toBe(false)
    expect(quickstartJudgmentFilters("doctors").entrance).toBe(true)
  })

  it("word each status with the fixed Quickstart headlines", () => {
    expect(quickstartHeadline(de, "pass")).toBe("Barrierefrei nutzbar")
    expect(quickstartHeadline(de, "pass_limited")).toBe("Barrierefrei nutzbar – mit Einschränkung")
    expect(quickstartHeadline(de, "fail")).toBe("Nicht barrierefrei")
    expect(quickstartHeadline(en, "unverified")).toBe("No confirmed data")
  })

  it("QuickstartVerdict renders the headline for the place", () => {
    r(<QuickstartVerdict place={makePlace()} />)
    expect(screen.getByText("Barrierefrei nutzbar")).toBeInTheDocument()
  })

  it("QuickstartVerdict fails a place whose required toilet is unknown (preset has acceptUnknown: false)", () => {
    r(<QuickstartVerdict place={makePlace({ accessibility: { entrance: buildAttribute("osm", "yes", "yes", {}), toilet: emptyAttribute(), parking: emptyAttribute() } })} />)
    expect(screen.getByText("Nicht barrierefrei")).toBeInTheDocument()
  })
})

describe("JudgmentLine — hideNoteOnPass", () => {
  const filters = { entrance: true, toilet: true, parking: false, seating: false, acceptUnknown: false }

  it("drops the redundant pass note when asked", () => {
    r(<JudgmentLine place={makePlace()} filters={filters} hideNoteOnPass />)
    expect(screen.queryByText("Alle geprüften Kriterien uneingeschränkt.")).not.toBeInTheDocument()
  })

  it("keeps the note when it carries information (caveat)", () => {
    const place = makePlace({ accessibility: { entrance: buildAttribute("osm", "limited", "limited", {}), toilet: buildAttribute("osm", "yes", "yes", {}), parking: emptyAttribute() } })
    r(<JudgmentLine place={place} filters={filters} hideNoteOnPass />)
    expect(screen.getByText("Mit Einschränkung: Eingang.")).toBeInTheDocument()
  })
})
