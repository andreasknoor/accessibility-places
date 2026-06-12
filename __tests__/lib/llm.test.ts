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

  it("preserves (CC) country-code suffix appended by geocode suggest", () => {
    // "Basel (CH)" is the display label from the autocomplete — the (CC) must
    // survive so Nominatim can use it for disambiguation.
    expect(extractLocationFallback("Kneipen in Basel (CH)")).toBe("Basel (CH)")
  })

  it("preserves (AT) and (DE) country codes too", () => {
    expect(extractLocationFallback("Cafés in Wien (AT)")).toBe("Wien (AT)")
    expect(extractLocationFallback("Hotels in München (DE)")).toBe("München (DE)")
  })

  it("handles query with only city + country code (no 'in')", () => {
    // Fallback path: no "in", but country code should still be reattached.
    expect(extractLocationFallback("Basel (CH)")).toContain("(CH)")
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

  it("extracts Basel (CH) as locationQuery from 'Kneipen in Basel (CH)' (server log regression)", () => {
    // geocode/suggest appends (CC) country codes; this caused "Location not found: Kneipen Basel"
    const r = parseQuery("Kneipen in Basel (CH)")
    expect(r.locationQuery).toBe("Basel (CH)")
    expect(r.categories).toContain("pub")
  })

  // ── All-categories default (chips optional, issue #24 step 3) ──────────────

  it("'in <city>' (no category part) returns all categories", () => {
    const r = parseQuery("in Berlin")
    expect(r.categories.length).toBe(16)
    expect(r.locationQuery).toBe("Berlin")
  })

  it("does not infer categories from the location part: city 'Essen' is not a restaurant hint", () => {
    const r = parseQuery("in Essen")
    expect(r.categories.length).toBe(16)
    expect(r.locationQuery).toBe("Essen")
  })

  it("category before 'in' stays scoped even when the city name is a hint ('Cafés in Essen')", () => {
    const r = parseQuery("Cafés in Essen")
    expect(r.categories).toContain("cafe")
    expect(r.categories).not.toContain("restaurant")
  })

  it("plain city name without 'in' geocodes as location", () => {
    const r = parseQuery("Berlin")
    expect(r.locationQuery).toBe("Berlin")
    expect(r.categories.length).toBe(16)
  })

  it("free text with category term and 'in' scopes correctly ('Sushi in Hamburg')", () => {
    const r = parseQuery("Sushi in Hamburg")
    expect(r.categories).toContain("restaurant")
    expect(r.locationQuery).toBe("Hamburg")
  })
})

// ─── Expanded category hints (issue #24 step 3) ──────────────────────────────

describe("inferCategories — expanded hints", () => {
  it("maps Sushi and Pizzeria to restaurant", () => {
    expect(inferCategories("Sushi")).toContain("restaurant")
    expect(inferCategories("Pizzeria Napoli")).toContain("restaurant")
  })

  it("maps Eiscafé to ice_cream (compound word not covered by 'eis' word boundary)", () => {
    expect(inferCategories("Eiscafé")).toContain("ice_cream")
  })

  it("maps Stadtbibliothek to library (compound word)", () => {
    expect(inferCategories("Stadtbibliothek")).toContain("library")
  })

  it("maps Brauhaus to pub and Tierpark to attraction", () => {
    expect(inferCategories("Brauhaus")).toContain("pub")
    expect(inferCategories("Tierpark")).toContain("attraction")
  })

  it("maps Musical to theater and Currywurst to fast_food", () => {
    expect(inferCategories("Musical")).toContain("theater")
    expect(inferCategories("Currywurst")).toContain("fast_food")
  })
})
