import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import ExternalMark from "@/components/ui/external-mark"

describe("ExternalMark", () => {
  it("renders a decorative arrow plus the screen-reader suffix inside the link's name", () => {
    render(<a href="https://example.com">Website<ExternalMark srLabel="(öffnet im Browser)" /></a>)
    const link = screen.getByRole("link", { name: "Website (öffnet im Browser)" })
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
  })

  it("renders only the arrow when no label is given (icon-only links carry it in aria-label)", () => {
    const { container } = render(<ExternalMark badge />)
    expect(container.querySelector("svg")).toHaveClass("absolute")
    expect(container.textContent).toBe("")
  })
})
