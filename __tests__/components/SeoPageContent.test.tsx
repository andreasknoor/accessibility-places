import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import SeoPageContent from "@/components/seo/SeoPageContent"
import { buildAttribute } from "@/lib/matching/merge"
import { CITIES, SEO_CATEGORY_TO_CHIP_IDX, SEO_CATEGORY_LABEL, SEO_CATEGORY_SLUGS } from "@/lib/cities"
import type { Place } from "@/lib/types"

const BERLIN = CITIES.find((c) => c.slug === "berlin")!

// All 320 city/category combinations — used in tests that don't exercise filtering
const ALL_VALID = new Set(
  CITIES.flatMap((c) => Object.keys(SEO_CATEGORY_SLUGS).map((cat) => `${c.slug}/${cat}`)),
)

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "Café Test",
    category: "cafe",
    address: { street: "Hauptstraße", houseNumber: "1", postalCode: "10115", city: "Berlin", country: "DE" },
    coordinates: { lat: 52.52, lon: 13.405 },
    accessibility: {
      entrance: buildAttribute("osm", "yes",     "yes",     {}),
      toilet:   buildAttribute("osm", "limited", "limited", {}),
      parking:  buildAttribute("osm", "no",      "no",      {}),
    },
    overallConfidence: 0.82,
    primarySource: "osm",
    sourceRecords: [],
    ...overrides,
  }
}

describe("SeoPageContent — confidence badge", () => {
  it("shows percentage and level label (DE)", () => {
    render(
      <SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[makePlace({ overallConfidence: 0.82 })]} validPaths={ALL_VALID} />,
    )
    expect(screen.getByText(/82%\s*·\s*Verlässlich/)).toBeInTheDocument()
  })

  it("shows percentage and level label (EN)", () => {
    render(
      <SeoPageContent locale="en" city={BERLIN} categorySlug="restaurant" places={[makePlace({ overallConfidence: 0.82 })]} validPaths={ALL_VALID} />,
    )
    expect(screen.getByText(/82%\s*·\s*Reliable/)).toBeInTheDocument()
  })

  it("uses medium label for mid-range confidence", () => {
    render(
      <SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[makePlace({ overallConfidence: 0.55 })]} validPaths={ALL_VALID} />,
    )
    expect(screen.getByText(/55%\s*·\s*Mittel/)).toBeInTheDocument()
  })

  it("uses low label for low confidence", () => {
    render(
      <SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[makePlace({ overallConfidence: 0.2 })]} validPaths={ALL_VALID} />,
    )
    expect(screen.getByText(/20%\s*·\s*Unsicher/)).toBeInTheDocument()
  })
})

describe("SeoPageContent — related categories", () => {
  const chipSlugs    = Object.keys(SEO_CATEGORY_TO_CHIP_IDX)
  const nonChipSlugs = Object.keys(SEO_CATEGORY_LABEL).filter((s) => !(s in SEO_CATEGORY_TO_CHIP_IDX))

  it("shows all chip-backed categories except the current one", () => {
    render(
      <SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[]} validPaths={ALL_VALID} />,
    )
    for (const slug of chipSlugs.filter((s) => s !== "restaurant")) {
      const label = SEO_CATEGORY_LABEL[slug].de
      expect(screen.getByRole("link", { name: label }), `missing chip category: ${slug}`).toBeInTheDocument()
    }
  })

  it("does not show non-chip categories", () => {
    render(
      <SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[]} validPaths={ALL_VALID} />,
    )
    for (const slug of nonChipSlugs) {
      const label = SEO_CATEGORY_LABEL[slug].de
      expect(screen.queryByRole("link", { name: label }), `unexpected non-chip category: ${slug}`).toBeNull()
    }
  })

  it("hides a related category link when that city/category is not in validPaths", () => {
    const limited = new Set(
      Object.keys(SEO_CATEGORY_SLUGS)
        .filter((s) => s !== "biergarten")
        .map((s) => `berlin/${s}`),
    )
    render(
      <SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[]} validPaths={limited} />,
    )
    expect(screen.queryByRole("link", { name: SEO_CATEGORY_LABEL["biergarten"].de })).toBeNull()
  })
})

describe("SeoPageContent — related cities", () => {
  it("hides a related-city link when that city/category is not in validPaths", () => {
    // Only Berlin and Hamburg are valid for biergarten
    const limited = new Set(["berlin/biergarten", "hamburg/biergarten"])
    render(
      <SeoPageContent locale="de" city={BERLIN} categorySlug="biergarten" places={[]} validPaths={limited} />,
    )
    // Hamburg should appear
    expect(screen.getByRole("link", { name: "Hamburg" })).toBeInTheDocument()
    // München should not appear (not in validPaths)
    expect(screen.queryByRole("link", { name: "München" })).toBeNull()
  })
})

describe("SeoPageContent — empty state", () => {
  it("shows no-results text when places is empty", () => {
    render(
      <SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[]} validPaths={ALL_VALID} />,
    )
    expect(screen.getByText("Aktuell sind keine Einträge verfügbar.")).toBeInTheDocument()
  })
})
