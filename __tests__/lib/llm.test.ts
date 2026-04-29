// @vitest-environment node
import { describe, it, expect } from "vitest"
import { extractLocationFallback, inferCategories } from "@/lib/llm"

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

  it("infers bar for 'kneipe'", () => {
    expect(inferCategories("Kneipe in Hamburg")).toContain("bar")
  })

  it("infers theater for 'kino'", () => {
    expect(inferCategories("Kino in München")).toContain("theater")
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
