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

  it("drops recognised category words from the no-'in' fallback (matrix finding)", () => {
    expect(extractLocationFallback("Arzt Frankenthal")).toBe("Frankenthal")
    expect(extractLocationFallback("Hotels Berlin")).toBe("Berlin")
  })

  it("strips multi-word category hints ('Fast Food Berlin' must not become 'Food Berlin')", () => {
    expect(extractLocationFallback("Fast Food Berlin")).toBe("Berlin")
    expect(extractLocationFallback("Fast Food in Hamburg")).toBe("Hamburg")
  })

  it("multi-word hint + category-word city: the ambiguous city survives ('Fast Food Essen')", () => {
    // Phrase-flagged tokens (certainly categorial) are dropped before
    // word-flagged ones (possibly a city) — review finding, 2026-07-04.
    expect(extractLocationFallback("Fast Food Essen")).toBe("Essen")
  })

  it("keeps postal codes as location tokens (PLZ disambiguation)", () => {
    expect(extractLocationFallback("67433 Neustadt")).toBe("67433 Neustadt")
    expect(extractLocationFallback("Restaurants in 67433 Neustadt")).toBe("67433 Neustadt")
    expect(extractLocationFallback("Arzt 67433 Neustadt")).toBe("67433 Neustadt")
  })

  it("keeps a bare city name even when it doubles as a category word", () => {
    expect(extractLocationFallback("Essen")).toBe("Essen")
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

  // Plurals of short (≤3 char) hints must still match — chip labels like "Pubs"
  // and "Bars" are plural. The optional trailing "s" must not re-open the
  // "barrierefrei" false positive that the end word-boundary guards against.
  it("matches plurals of short hints (pub/bar/zoo)", () => {
    expect(inferCategories("Pubs")).toEqual(["pub"])
    expect(inferCategories("Bars")).toEqual(["bar"])
    expect(inferCategories("Zoos in Berlin")).toEqual(["zoo"])
  })

  it("does not let the plural-s re-trigger the 'barrierefrei' false positive", () => {
    // "barrierefrei" alone hits no hint → all-categories fallback (which includes
    // "bar"); combine with a real category so a spurious "bar" match would show.
    expect(inferCategories("barrierefreie Restaurants")).toEqual(["restaurant"])
    expect(inferCategories("Restaurant mit Bart")).toEqual(["restaurant"])
  })

  it("matches the English plural 'Pharmacies'", () => {
    expect(inferCategories("Pharmacies")).toEqual(["pharmacy"])
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
    expect(r.categories.length).toBe(27)
    expect(r.locationQuery).toBe("Berlin")
  })

  it("does not infer categories from the location part: city 'Essen' is not a restaurant hint", () => {
    const r = parseQuery("in Essen")
    expect(r.categories.length).toBe(27)
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
    expect(r.categories.length).toBe(27)
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

  it("maps Eiscafé to cafe (ice cream merged into cafe; compound word not covered by 'eis' word boundary)", () => {
    expect(inferCategories("Eiscafé")).toContain("cafe")
  })

  it("maps Stadtbibliothek to library (compound word)", () => {
    expect(inferCategories("Stadtbibliothek")).toContain("library")
  })

  it("maps Brauhaus to pub and Tierpark to zoo", () => {
    expect(inferCategories("Brauhaus")).toContain("pub")
    expect(inferCategories("Tierpark")).toContain("zoo")
    expect(inferCategories("Tierpark")).not.toContain("attraction")
  })

  it("maps Musical to theater and Currywurst to fast_food", () => {
    expect(inferCategories("Musical")).toContain("theater")
    expect(inferCategories("Currywurst")).toContain("fast_food")
  })
})

// ─── Query-shape matrix (Ebene 1 of the free-text matrix tests) ──────────────
//
// parseQuery over the exact query shapes the client produces (chip prefix,
// "in <ort>" all-categories form, raw text, restore paths). Documents for each
// shape WHICH string goes to Nominatim and WHICH categories are searched —
// the composition layer where the "Arztpraxen in Artz in Frankenthal" class
// of bugs lives.

describe("parseQuery — client query shapes", () => {
  const ALL = 27 // all-categories fallback size

  it.each([
    // [query, expected locationQuery, expected categories ("all" = fallback)]
    ["Restaurants in Frankenthal",        "Frankenthal",             ["restaurant"]],
    ["Arzt in Frankenthal",               "Frankenthal",             ["doctors"]],
    ["Artz in Frankenthal",               "Frankenthal",             "all"],        // typo → no hint
    ["in Frankenthal",                    "Frankenthal",             "all"],
    ["Frankenthal",                       "Frankenthal",             "all"],
    ["in Berlin Mitte",                   "Berlin Mitte",            "all"],
    ["Arzt in Berlin Mitte",              "Berlin Mitte",            ["doctors"]],
    // Ort mit "in" im Namen — KNOWN QUIRK: the in-regex is case-insensitive,
    // so the raw form loses the town and geocodes only "der Oberpfalz".
    // Documented current behaviour, not the desired one.
    ["Weiden in der Oberpfalz",           "der Oberpfalz",           "all"],
    ["in Weiden in der Oberpfalz",        "Weiden in der Oberpfalz", "all"],
    ["Arzt in Weiden in der Oberpfalz",   "Weiden in der Oberpfalz", ["doctors"]],
    // City that doubles as a category word: raw form triggers the hint (known
    // quirk — the UI avoids it by sending "in <ort>" for known-pure locations).
    ["in Essen",                          "Essen",                   "all"],
    ["Essen",                             "Essen",                   ["restaurant"]],
    // Regression shapes from the Frankenthal bug (pre-v9.30 buildQuery nesting
    // and the poisoned-restore form): the full free text becomes the location.
    ["Arzt Frankenthal",                  "Frankenthal",             ["doctors"]],  // ohne "in" — Kategorienwort wird gestrippt
    ["Fast Food Berlin",                  "Berlin",                  ["fast_food"]], // Mehrwort-Hint wird als Paar gestrippt
    ["Fast Food Essen",                   "Essen",                   ["restaurant", "fast_food"]], // Kategorienwort-Stadt ueberlebt die Phrase
    // PLZ-Disambiguierung: die Postleitzahl muss die Ortssuche erreichen.
    ["67433 Neustadt",                    "67433 Neustadt",          "all"],
    ["Restaurants in 67433 Neustadt",     "67433 Neustadt",          ["restaurant"]],
    ["Arzt 67433 Neustadt",               "67433 Neustadt",          ["doctors"]],
    ["8004 Zürich",                       "8004 Zürich",             "all"],        // 4-stellige CH-PLZ
    ["Arzt in 5020 Salzburg",             "5020 Salzburg",           ["doctors"]],  // 4-stellige AT-PLZ
    ["Arztpraxen in Artz in Frankenthal", "Artz in Frankenthal",     ["doctors"]],
    ["in Artz in Frankenthal",            "Artz in Frankenthal",     "all"],
  ])("%s → location %j", (query, expectedLoc, expectedCats) => {
    const parsed = parseQuery(query)
    expect(parsed.locationQuery).toBe(expectedLoc)
    if (expectedCats === "all") expect(parsed.categories).toHaveLength(ALL)
    else expect(parsed.categories).toEqual(expectedCats)
  })
})
