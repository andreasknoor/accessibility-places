// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  CITIES,
  CITY_MAP,
  SEO_CATEGORY_SLUGS,
  SEO_CATEGORY_TO_SLUG,
  SEO_CATEGORY_TO_CHIP_IDX,
  SEO_CATEGORY_LABEL,
} from "@/lib/cities"

describe("CITIES", () => {
  it("has no duplicate slugs", () => {
    const slugs = CITIES.map((c) => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it("CITY_MAP contains all cities", () => {
    for (const city of CITIES) {
      expect(CITY_MAP.get(city.slug)).toBe(city)
    }
  })
})

describe("SEO_CATEGORY_TO_SLUG", () => {
  it("is the exact inverse of SEO_CATEGORY_SLUGS", () => {
    for (const [slug, cat] of Object.entries(SEO_CATEGORY_SLUGS)) {
      expect(SEO_CATEGORY_TO_SLUG[cat]).toBe(slug)
    }
  })
})

describe("SEO_CATEGORY_TO_CHIP_IDX", () => {
  it("only references slugs that exist in SEO_CATEGORY_SLUGS", () => {
    for (const slug of Object.keys(SEO_CATEGORY_TO_CHIP_IDX)) {
      expect(SEO_CATEGORY_SLUGS).toHaveProperty(slug)
    }
  })

  it("has no duplicate chip indices", () => {
    const indices = Object.values(SEO_CATEGORY_TO_CHIP_IDX).filter((v) => v !== undefined)
    expect(new Set(indices).size).toBe(indices.length)
  })
})

describe("SEO_CATEGORY_LABEL", () => {
  it("has a label for every slug in SEO_CATEGORY_SLUGS", () => {
    for (const slug of Object.keys(SEO_CATEGORY_SLUGS)) {
      expect(SEO_CATEGORY_LABEL[slug]).toBeDefined()
    }
  })

  it("every label has both de and en strings", () => {
    for (const [slug, labels] of Object.entries(SEO_CATEGORY_LABEL)) {
      expect(typeof labels.de, `${slug}.de`).toBe("string")
      expect(typeof labels.en, `${slug}.en`).toBe("string")
      expect(labels.de.length, `${slug}.de non-empty`).toBeGreaterThan(0)
      expect(labels.en.length, `${slug}.en non-empty`).toBeGreaterThan(0)
    }
  })
})
