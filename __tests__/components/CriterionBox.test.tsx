import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import CriterionBox from "@/components/results/CriterionBox"
import { LocaleProvider } from "@/lib/i18n"

function renderBox(props: Partial<React.ComponentProps<typeof CriterionBox>> = {}) {
  return render(
    <LocaleProvider initialLocale="de">
      <CriterionBox tone="yes" label="Toilette" value="Ja" {...props} />
    </LocaleProvider>,
  )
}

// Results-list proposal (variant 3a): a small warning icon flags a value
// resting on weak evidence (low confidence) — only for "low", never for
// "medium"/"high"/"unknown". Deliberately not a triangle (that shape already
// means "sources disagree" elsewhere in this component tree).
describe("CriterionBox — low-confidence warning icon", () => {
  it("shows the warning icon when confidence is low", () => {
    renderBox({ confidence: 0.35 })
    expect(screen.getByLabelText("Geringe Verlässlichkeit")).toBeInTheDocument()
  })

  it("does not show it for medium confidence", () => {
    renderBox({ confidence: 0.5 })
    expect(screen.queryByLabelText("Geringe Verlässlichkeit")).toBeNull()
  })

  it("does not show it for high confidence", () => {
    renderBox({ confidence: 0.85 })
    expect(screen.queryByLabelText("Geringe Verlässlichkeit")).toBeNull()
  })

  it("does not show it when confidence is omitted", () => {
    renderBox()
    expect(screen.queryByLabelText("Geringe Verlässlichkeit")).toBeNull()
  })

  it("does not show it for an unknown value even at low confidence", () => {
    renderBox({ tone: "unknown", value: "Unbekannt", confidence: 0 })
    expect(screen.queryByLabelText("Geringe Verlässlichkeit")).toBeNull()
  })
})
