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

// v13/docs/plans/reliability-tiers.md: the old confidence-based circle-
// exclamation icon (aria-label only, no visible text) was replaced by a
// visible plain-language Nachsatz — the reliability tier now renders as
// text under the header row, computed by the caller (A11yAttribute) via
// lib/reliability's criterionTier and passed in as `reliabilityNote`.
describe("CriterionBox — reliability Nachsatz", () => {
  it("renders the given reliability note as visible text under the header", () => {
    renderBox({ reliabilityNote: "Nur eine schwache Angabe" })
    expect(screen.getByText("Nur eine schwache Angabe")).toBeInTheDocument()
  })

  it("renders nothing extra when no reliability note is given", () => {
    const { container } = renderBox()
    expect(container.querySelector(".text-\\[11px\\]")).not.toBeInTheDocument()
  })
})
