import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import CriterionIcon from "@/components/simple/CriterionIcon"
import type { A11yValue } from "@/lib/types"

const VALUES: A11yValue[] = ["yes", "limited", "no", "unknown"]

describe("CriterionIcon", () => {
  it("renders a distinct SVG markup per value (not colour-only)", () => {
    const markups = VALUES.map((v) => {
      const { container } = render(<CriterionIcon value={v} />)
      return container.querySelector("svg")?.innerHTML
    })
    expect(new Set(markups).size).toBe(VALUES.length)
  })

  it("is decorative (aria-hidden), never the row's only accessible label", () => {
    const { container } = render(<CriterionIcon value="yes" />)
    expect(container.firstElementChild).toHaveAttribute("aria-hidden")
  })

  for (const value of VALUES) {
    it(`renders an svg for "${value}"`, () => {
      const { container } = render(<CriterionIcon value={value} />)
      expect(container.querySelector("svg")).toBeInTheDocument()
    })
  }
})
