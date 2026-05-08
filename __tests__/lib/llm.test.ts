// @vitest-environment node
import { describe, it, expect } from "vitest"
import { extractLocationFallback, extractQuotedName, inferCategories, parseQuery } from "@/lib/llm"

// ─── extractLocationFallback ──────────────────────────────────────────────────

describe("extractLocationFallback", () => {
  it("extracts city after 'in'", () => {
    expect(extractLocationFallback("Finde Restaurants in Spandau")).toBe("Spandau")
  })

  it("extracts district with 'in <City District>'", () => {
    expect(extractLocationFallback("Rollstuhlgerechte Cafés in Berlin Mitte")).toBe("Berlin Mitte")
  })

  it("extracts English location after 'in'", () => {
    expect(extractLocationFallback("Restaurants in Hamburg Altona")).toBe("Hamburg Altona")
  })

  it("falls back to capitalised words at end when no 'in' present", () => {
    const result = extractLocationFallback("Barrierefreie Museen München")
    expect(result).toContain("München")
  })

  it("stops at 'mit' connector", () => {
    const result = extractLocationFallback("Restaurants in Wien mit Rollstuhltoilette")
    expect(result).toBe("Wien")
  })
})

// ─── extractQuotedName ───────────────────────────────────────────────────────

describe("extractQuotedName", () => {
  it("extracts straight double-quoted name", () => {
    expect(extractQuotedName('Suche nach "Georgbräu" in Berlin')).toBe("Georgbräu")
  })

  it("extracts straight single-quoted name", () => {
    expect(extractQuotedName("Restaurant 'Zur Eiche' in Hamburg")).toBe("Zur Eiche")
  })

  it("extracts German typographic „…“ pair", () => {
    expect(extractQuotedName("Cafe „et cetera“ in Potsdam")).toBe("et cetera")
  })

  it("extracts curly “…” pair", () => {
    expect(extractQuotedName("the “Brauhaus” in Berlin")).toBe("Brauhaus")
  })

  it("extracts French «…» guillemets", () => {
    expect(extractQuotedName("le «Bistro» à Berlin")).toBe("Bistro")
  })

  it("returns empty string when no quotes present", () => {
    expect(extractQuotedName("Restaurants in Berlin Mitte")).toBe("")
  })

  it("returns first match when multiple quoted strings", () => {
    expect(extractQuotedName('"Foo" and "Bar"')).toBe("Foo")
  })

  it("trims whitespace inside quotes", () => {
    expect(extractQuotedName('"  spaced  "')).toBe("spaced")
  })

  it("returns empty string for empty quoted content", () => {
    expect(extractQuotedName('Restaurants in ""')).toBe("")
  })
})

// ─── inferCategories ─────────────────────────────────────────────────────────

describe("inferCategories", () => {
  it("infers restaurant for 'restaurant'", () => {
    expect(inferCategories("Rollstuhlgerechte Restaurants")).toContain("restaurant")
  })

  it("infers cafe for 'cafe'", () => {
    expect(inferCategories("café in Berlin")).toContain("cafe")
  })

  it("does not conflate cafe with restaurant", () => {
    const cats = inferCategories("café in Berlin")
    expect(cats).not.toContain("restaurant")
  })

  it("infers hotel for 'hotel'", () => {
    expect(inferCategories("Hotel mit Rampe")).toContain("hotel")
  })

  it("infers museum for 'museum'", () => {
    expect(inferCategories("Barrierefreies Museum")).toContain("museum")
  })

  it("infers pub for 'kneipe'", () => {
    expect(inferCategories("Kneipe in Hamburg")).toContain("pub")
  })

  it("infers biergarten for 'biergarten'", () => {
    expect(inferCategories("Biergarten in München")).toContain("biergarten")
  })

  it("infers cinema for 'kino'", () => {
    expect(inferCategories("Kino in München")).toContain("cinema")
  })

  it("infers hostel for 'hostel'", () => {
    expect(inferCategories("Günstiges Hostel in Hamburg")).toContain("hostel")
  })

  it("infers multiple categories", () => {
    const cats = inferCategories("Hotels und Restaurants in Berlin")
    expect(cats).toContain("restaurant")
    expect(cats).toContain("hotel")
  })

  it("returns all categories when no hint found", () => {
    const cats = inferCategories("barrierefreie Orte in Berlin")
    expect(cats).toContain("restaurant")
    expect(cats).toContain("hotel")
    expect(cats).toContain("museum")
  })

  it("infers restaurant for 'gastronomie'", () => {
    expect(inferCategories("Gastronomie Spandau")).toContain("restaurant")
  })

  it("infers hotel for 'unterkunft'", () => {
    expect(inferCategories("Unterkunft Wien")).toContain("hotel")
  })
})

// ─── parseQuery (deterministic, sync) ────────────────────────────────────────

describe("parseQuery", () => {
  it("extracts location from standard chip+location query", () => {
    const r = parseQuery("Restaurants in Berlin Mitte")
    expect(r.locationQuery).toBe("Berlin Mitte")
    expect(r.categories).toContain("restaurant")
  })

  it("handles Photon-style display name with comma", () => {
    const r = parseQuery("Restaurants in Schöneberg, Berlin")
    expect(r.locationQuery).toBe("Schöneberg, Berlin")
  })

  it("returns all categories when no chip label matches", () => {
    const r = parseQuery("Orte in Wien")
    expect(r.categories.length).toBeGreaterThan(5)
  })

  it("preserves category from chip label through to categories array", () => {
    expect(parseQuery("Museen in München").categories).toContain("museum")
    expect(parseQuery("Kinos in Hamburg").categories).toContain("cinema")
    expect(parseQuery("Hotels in Wien").categories).toContain("hotel")
  })
})
