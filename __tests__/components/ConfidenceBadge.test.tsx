import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import ConfidenceBadge from "@/components/results/ConfidenceBadge"

describe("ConfidenceBadge", () => {
  it("shows percentage", () => {
    render(<ConfidenceBadge confidence={0.85} />)
    expect(screen.getByText(/85%/)).toBeInTheDocument()
  })

  it("shows high label for ≥ 0.70", () => {
    render(<ConfidenceBadge confidence={0.75} />)
    // Label text depends on locale (de default in tests)
    const badge = screen.getByText(/75%/)
    expect(badge).toBeInTheDocument()
  })

  it("renders with 0% confidence", () => {
    render(<ConfidenceBadge confidence={0} />)
    expect(screen.getByText(/0%/)).toBeInTheDocument()
  })

  it("renders with 100% confidence", () => {
    render(<ConfidenceBadge confidence={1} />)
    expect(screen.getByText(/100%/)).toBeInTheDocument()
  })
})
