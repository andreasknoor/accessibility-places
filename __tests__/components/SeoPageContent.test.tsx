import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import SeoPageContent from "@/components/seo/SeoPageContent"
import { buildAttribute } from "@/lib/matching/merge"
import { CITIES, SEO_CATEGORY_TO_CHIP_IDX, SEO_CATEGORY_LABEL } from "@/lib/cities"
import type { Place } from "@/lib/types"

// Validity data changes with every cron run — mock it so tests stay stable.
vi.mock("@/lib/seo-validity", () => ({
  hasData: () => true,
  VALID_SEO_PATHS: new Set<string>(),
}))

const BERLIN = CITIES.find((c) => c.slug === "berlin")!

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
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[makePlace({ overallConfidence: 0.82 })]} />)
    expect(screen.getByText(/82%\s*·\s*Verlässlich/)).toBeInTheDocument()
  })

  it("shows percentage and level label (EN)", () => {
    render(<SeoPageContent locale="en" city={BERLIN} categorySlug="restaurant" places={[makePlace({ overallConfidence: 0.82 })]} />)
    expect(screen.getByText(/82%\s*·\s*Reliable/)).toBeInTheDocument()
  })

  it("uses medium label for mid-range confidence", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[makePlace({ overallConfidence: 0.55 })]} />)
    expect(screen.getByText(/55%\s*·\s*Mittel/)).toBeInTheDocument()
  })

  it("uses low label for low confidence", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[makePlace({ overallConfidence: 0.2 })]} />)
    expect(screen.getByText(/20%\s*·\s*Unsicher/)).toBeInTheDocument()
  })
})

describe("SeoPageContent — related categories", () => {
  const chipSlugs    = Object.keys(SEO_CATEGORY_TO_CHIP_IDX)
  const nonChipSlugs = Object.keys(SEO_CATEGORY_LABEL).filter((s) => !(s in SEO_CATEGORY_TO_CHIP_IDX))

  it("shows all chip-backed categories except the current one", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[]} />)
    for (const slug of chipSlugs.filter((s) => s !== "restaurant")) {
      const label = SEO_CATEGORY_LABEL[slug].de
      expect(screen.getByRole("link", { name: label }), `missing chip category: ${slug}`).toBeInTheDocument()
    }
  })

  it("does not show non-chip categories", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[]} />)
    for (const slug of nonChipSlugs) {
      const label = SEO_CATEGORY_LABEL[slug].de
      expect(screen.queryByRole("link", { name: label }), `unexpected non-chip category: ${slug}`).toBeNull()
    }
  })
})

describe("SeoPageContent — related cities", () => {
  it("shows all other cities", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="biergarten" places={[]} />)
    expect(screen.getByRole("link", { name: "Hamburg" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "München" })).toBeInTheDocument()
  })
})

describe("SeoPageContent — empty state", () => {
  it("shows no-results text when places is empty", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[]} />)
    expect(screen.getByText("Aktuell sind keine Einträge verfügbar.")).toBeInTheDocument()
  })
})

// ─── Stats + FAQ helpers ─────────────────────────────────────────────────────

function makePlaces(n: number, overrides: Partial<Place> = {}): Place[] {
  return Array.from({ length: n }, (_, i) =>
    makePlace({ id: `p${i}`, name: `Place ${i}`, ...overrides })
  )
}

describe("SeoPageContent — stats summary", () => {
  it("does not render stats box when places.length <= 3", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={makePlaces(3)} />)
    expect(screen.queryByText(/Kurzübersicht/)).toBeNull()
  })

  it("renders stats box when places.length > 3", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={makePlaces(4)} />)
    expect(screen.getByText(/Kurzübersicht/)).toBeInTheDocument()
  })

  it("shows correct total count in stats box", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={makePlaces(5)} />)
    // The number "5" appears next to "Einträge"
    const dt = screen.getByText("Einträge")
    expect(dt.nextElementSibling?.textContent).toBe("5")
  })

  it("counts parking correctly in stats box", () => {
    const withParking   = makePlace({ id: "park1", name: "With Parking", accessibility: {
      entrance: buildAttribute("osm", "yes", "yes", {}),
      toilet:   buildAttribute("osm", "yes", "yes", {}),
      parking:  buildAttribute("osm", "yes", "yes", {}),
    }})
    const noParking     = makePlace({ id: "nopar", name: "No Parking" })
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[withParking, noParking, noParking, noParking, noParking]} />)
    const dt = screen.getByText("Mit Parkplatz")
    expect(dt.nextElementSibling?.textContent).toBe("1")
  })

  it("renders summary in English locale", () => {
    render(<SeoPageContent locale="en" city={BERLIN} categorySlug="restaurant" places={makePlaces(4)} />)
    expect(screen.getByText(/Summary/)).toBeInTheDocument()
  })
})

describe("SeoPageContent — mini-FAQ", () => {
  it("always shows count question (Q1) when summary visible", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={makePlaces(4)} />)
    expect(screen.getByText(/Wie viele Restaurants in Berlin sind rollstuhlgerecht/)).toBeInTheDocument()
  })

  it("always shows data-currency question (Q4) when summary visible", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={makePlaces(4)} />)
    expect(screen.getByText("Wie aktuell sind die Barrierefreiheitsdaten?")).toBeInTheDocument()
  })

  it("omits designated-toilet question when none present", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={makePlaces(4)} />)
    expect(screen.queryByText(/ausgewiesenes Rollstuhl-WC/)).toBeNull()
  })

  it("shows designated-toilet question with place names when present", () => {
    const withDesig = makePlace({
      id: "d1", name: "Hotel Barrierefrei",
      overallConfidence: 0.95,
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   buildAttribute("osm", "yes", "yes", { isDesignated: true }),
        parking:  buildAttribute("osm", "no",  "no",  {}),
      },
    })
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="hotel" places={[withDesig, ...makePlaces(4)]} />)
    // The phrase appears in both <dt> (question) and <dd> (answer)
    expect(screen.getAllByText(/ausgewiesenes Rollstuhl-WC/).length).toBeGreaterThan(0)
    // Name appears in the place card h3 AND in the FAQ answer
    expect(screen.getAllByText(/Hotel Barrierefrei/).length).toBeGreaterThan(0)
  })

  it("omits parking question when no parking data", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={makePlaces(4)} />)
    expect(screen.queryByText(/Behindertenparkplatz/)).toBeNull()
  })

  it("shows parking question when parking data present", () => {
    const withParking = makePlace({
      id: "pk1", name: "Parkhaus",
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   buildAttribute("osm", "yes", "yes", {}),
        parking:  buildAttribute("osm", "yes", "yes", {}),
      },
    })
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[withParking, ...makePlaces(4)]} />)
    // The word appears in both <dt> (question) and <dd> (answer)
    expect(screen.getAllByText(/Behindertenparkplatz/).length).toBeGreaterThan(0)
  })

  it("does not render FAQ when places.length <= 3", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={makePlaces(3)} />)
    expect(screen.queryByText(/Häufige Fragen/)).toBeNull()
  })
})

describe("SeoPageContent — FAQPage JSON-LD", () => {
  function getFaqJsonLd(): Record<string, unknown> | undefined {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    const blocks = scripts.map((s) => JSON.parse(s.textContent ?? "{}"))
    return blocks.find((b) => b["@type"] === "FAQPage")
  }

  it("emits FAQPage JSON-LD when places.length > 3", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={makePlaces(4)} />)
    expect(getFaqJsonLd()).toBeDefined()
    expect(getFaqJsonLd()?.["@type"]).toBe("FAQPage")
  })

  it("does not emit FAQPage JSON-LD when places.length <= 3", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={makePlaces(3)} />)
    expect(getFaqJsonLd()).toBeUndefined()
  })

  it("FAQPage mainEntity contains count question", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={makePlaces(4)} />)
    const faq = getFaqJsonLd()
    const entities = faq?.["mainEntity"] as Array<{ name: string }> | undefined
    expect(entities?.some(e => e.name.includes("rollstuhlgerecht"))).toBe(true)
  })

  it("FAQPage answer text contains the count", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={makePlaces(4)} />)
    const faq = getFaqJsonLd()
    const entities = faq?.["mainEntity"] as Array<{ name: string; acceptedAnswer: { text: string } }> | undefined
    const q1 = entities?.[0]
    expect(q1?.acceptedAnswer?.text).toContain("4")
  })
})

// ─── JSON-LD helpers ─────────────────────────────────────────────────────────

function getItemListJsonLd(): Record<string, unknown> | undefined {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
  const blocks = scripts.map((s) => JSON.parse(s.textContent ?? "{}"))
  return blocks.find((b) => b["@type"] === "ItemList")
}

type LdItem = Record<string, unknown>

function getFirstItem(ld: Record<string, unknown>): LdItem | undefined {
  const elements = ld["itemListElement"] as LdItem[] | undefined
  return (elements?.[0]?.["item"]) as LdItem | undefined
}

function getFeature(item: LdItem, name: string) {
  const features = item["amenityFeature"] as Array<{ name: string; value: unknown }> | undefined
  return features?.find((f) => f.name === name)
}

describe("SeoPageContent — JSON-LD amenityFeature", () => {
  it("uses category-specific schema type", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="cafe" places={[makePlace()]} />)
    const item = getFirstItem(getItemListJsonLd()!)
    expect(item?.["@type"]).toBe("CafeOrCoffeeShop")
  })

  it("falls back to LocalBusiness for unknown category slug", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[makePlace()]} />)
    const item = getFirstItem(getItemListJsonLd()!)
    expect(item?.["@type"]).toBe("Restaurant")
  })

  it("includes a url per place", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[makePlace()]} />)
    const item = getFirstItem(getItemListJsonLd()!)
    expect(typeof item?.["url"]).toBe("string")
    expect((item?.["url"] as string)).toContain("selectLat=52.52")
  })

  it("maps entrance=yes to wheelchair-accessible entrance: true", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[makePlace()]} />)
    const item = getFirstItem(getItemListJsonLd()!)!
    expect(getFeature(item, "Wheelchair-accessible entrance")?.value).toBe(true)
  })

  it("maps entrance=no to wheelchair-accessible entrance: false", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "no", "no", {}),
        toilet:   buildAttribute("osm", "yes", "yes", {}),
        parking:  buildAttribute("osm", "no",  "no",  {}),
      },
    })]} />)
    const item = getFirstItem(getItemListJsonLd()!)!
    expect(getFeature(item, "Wheelchair-accessible entrance")?.value).toBe(false)
  })

  it("maps toilet=limited to accessible toilet: true", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[makePlace()]} />)
    const item = getFirstItem(getItemListJsonLd()!)!
    expect(getFeature(item, "Accessible toilet")?.value).toBe(true)
  })

  it("maps parking=no to accessible parking on site: false", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[makePlace()]} />)
    const item = getFirstItem(getItemListJsonLd()!)!
    expect(getFeature(item, "Accessible parking on site")?.value).toBe(false)
  })

  it("includes entrance detail: ramp", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", { hasRamp: true, doorWidthCm: 90 }),
        toilet:   buildAttribute("osm", "yes", "yes", {}),
        parking:  buildAttribute("osm", "no",  "no",  {}),
      },
    })]} />)
    const item = getFirstItem(getItemListJsonLd()!)!
    expect(getFeature(item, "Ramp available")?.value).toBe(true)
    expect(getFeature(item, "Entrance door width")?.value).toBe("90 cm")
  })

  it("includes toilet details: designated + grab bars", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   buildAttribute("osm", "yes", "yes", { isDesignated: true, hasGrabBars: true, turningRadiusCm: 150 }),
        parking:  buildAttribute("osm", "no",  "no",  {}),
      },
    })]} />)
    const item = getFirstItem(getItemListJsonLd()!)!
    expect(getFeature(item, "Designated wheelchair toilet")?.value).toBe(true)
    expect(getFeature(item, "Grab bars")?.value).toBe(true)
    expect(getFeature(item, "Toilet turning radius")?.value).toBe("150 cm")
  })

  it("uses Nearby disabled parking feature when nearbyOnly=true", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[makePlace({
      accessibility: {
        entrance: buildAttribute("osm", "yes", "yes", {}),
        toilet:   buildAttribute("osm", "yes", "yes", {}),
        parking:  buildAttribute("osm", "yes", "yes", { nearbyOnly: true, nearbyParkingDistanceM: 120 }),
      },
    })]} />)
    const item = getFirstItem(getItemListJsonLd()!)!
    expect(getFeature(item, "Nearby disabled parking")?.value).toBe(true)
    expect(getFeature(item, "Distance to nearest disabled parking")?.value).toBe("120 m")
    expect(getFeature(item, "Accessible parking on site")).toBeUndefined()
  })

  it("omits amenityFeature when all values are unknown", () => {
    render(<SeoPageContent locale="de" city={BERLIN} categorySlug="restaurant" places={[makePlace({
      accessibility: {
        entrance: null,
        toilet:   null,
        parking:  buildAttribute("osm", "unknown", "unknown", {}),
      },
    })]} />)
    const item = getFirstItem(getItemListJsonLd()!)!
    expect(item["amenityFeature"]).toBeUndefined()
  })
})
