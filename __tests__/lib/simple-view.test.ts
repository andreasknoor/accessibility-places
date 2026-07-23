// @vitest-environment node
import { describe, it, expect } from "vitest"
import { criterionSentence, CRITERION_DOT_CLASS } from "@/lib/simple-view"
import de from "@/lib/i18n/de"
import en from "@/lib/i18n/en"
import type { A11yValue } from "@/lib/types"

const VALUES: A11yValue[] = ["yes", "limited", "no", "unknown"]
const KEYS = ["entrance", "toilet", "parking"] as const

describe("criterionSentence", () => {
  for (const t of [de, en]) {
    describe(`locale "${t === de ? "de" : "en"}"`, () => {
      for (const key of KEYS) {
        for (const value of VALUES) {
          it(`returns a non-empty, distinct sentence for ${key}/${value}`, () => {
            const sentence = criterionSentence(t, key, value)
            expect(sentence).toBeTruthy()
            expect(typeof sentence).toBe("string")
          })
        }
      }

      it("returns 4 distinct sentences per criterion (no accidental duplicate mapping)", () => {
        for (const key of KEYS) {
          const sentences = VALUES.map((v) => criterionSentence(t, key, v))
          expect(new Set(sentences).size).toBe(VALUES.length)
        }
      })
    })
  }

  it("de and en produce different text for the same input (sanity check against a copy-paste mistake)", () => {
    for (const key of KEYS) {
      for (const value of VALUES) {
        expect(criterionSentence(de, key, value)).not.toBe(criterionSentence(en, key, value))
      }
    }
  })
})

describe("CRITERION_DOT_CLASS", () => {
  it("has exactly one entry per A11yValue", () => {
    expect(Object.keys(CRITERION_DOT_CLASS).sort()).toEqual([...VALUES].sort())
  })

  it("every value is a Tailwind bg-* class", () => {
    for (const cls of Object.values(CRITERION_DOT_CLASS)) {
      expect(cls).toMatch(/^bg-\w+-\d+$/)
    }
  })

  it("assigns a distinct color to each value", () => {
    expect(new Set(Object.values(CRITERION_DOT_CLASS)).size).toBe(VALUES.length)
  })
})
