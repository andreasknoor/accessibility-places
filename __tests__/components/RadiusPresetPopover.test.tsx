import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import RadiusPresetPopover from "@/components/filters/RadiusPresetPopover"
import { RADIUS_PRESETS_KM, AMENITY_RADIUS_PRESETS_KM } from "@/lib/search-ui"

// The trigger button's own text can equal a preset's label (e.g. the current
// radius's preset, once the popover is open) — only the trigger carries an
// aria-label, so filter on that to always resolve the preset-list button,
// never the trigger, regardless of which radius a given test uses.
function presetButton(text: string): HTMLElement {
  const matches = screen.getAllByText(text, { selector: "button" })
  const preset = matches.find((el) => !el.hasAttribute("aria-label"))
  if (!preset) throw new Error(`No preset button found for "${text}"`)
  return preset
}

describe("RadiusPresetPopover — non-interactive fallback", () => {
  it("renders a plain label with no button/popover when onChange is absent", () => {
    render(
      <RadiusPresetPopover
        radiusKm={5}
        label="5 km"
        ariaLabel="5 km – change search radius"
        triggerClassName="trigger"
      />,
    )
    expect(screen.getByText("5 km")).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()
  })
})

describe("RadiusPresetPopover — venue domain (default presets)", () => {
  function renderVenue(radiusKm = 5, onChange = vi.fn()) {
    render(
      <RadiusPresetPopover
        radiusKm={radiusKm}
        onChange={onChange}
        label={`${radiusKm} km`}
        ariaLabel={`${radiusKm} km – change search radius`}
        triggerClassName="trigger"
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`${radiusKm} km`) }))
    return onChange
  }

  it("opens the popover on trigger click and shows every venue preset formatted in km", () => {
    renderVenue()
    for (const km of RADIUS_PRESETS_KM) {
      expect(presetButton(`${km} km`)).toBeInTheDocument()
    }
  })

  it("never renders a metres-formatted preset in the venue domain (no cross-domain leakage)", () => {
    renderVenue()
    expect(screen.queryByText(/^\d+ m$/)).toBeNull()
  })

  it("calls onChange with the clicked preset's km value", () => {
    const onChange = renderVenue()
    fireEvent.click(presetButton("10 km"))
    expect(onChange).toHaveBeenCalledWith(10)
  })

  it("does not call onChange when the already-active preset is clicked again", () => {
    const onChange = renderVenue(5)
    fireEvent.click(presetButton("5 km"))
    expect(onChange).not.toHaveBeenCalled()
  })

  it("marks the current radius's preset as active, and other presets as inactive", () => {
    renderVenue(5)
    expect(presetButton("5 km").className).toMatch(/bg-primary/)
    expect(presetButton("10 km").className).not.toMatch(/bg-primary\b/)
  })
})

describe("RadiusPresetPopover — amenity domain (explicit presets prop)", () => {
  function renderAmenity(radiusKm: number, onChange = vi.fn()) {
    const label = radiusKm < 1 ? `${Math.round(radiusKm * 1000)} m` : `${radiusKm} km`
    render(
      <RadiusPresetPopover
        radiusKm={radiusKm}
        onChange={onChange}
        presets={AMENITY_RADIUS_PRESETS_KM}
        label={label}
        ariaLabel={`${label} – change search radius`}
        triggerClassName="trigger"
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: new RegExp(label.replace(".", "\\.")) }))
    return onChange
  }

  it("renders sub-km amenity presets in metres, not as fractional km", () => {
    renderAmenity(0.5)
    expect(presetButton("100 m")).toBeInTheDocument()
    expect(presetButton("250 m")).toBeInTheDocument()
    expect(presetButton("500 m")).toBeInTheDocument()
    expect(screen.queryByText("0.25 km")).toBeNull()
    expect(screen.queryByText("0.1 km")).toBeNull()
  })

  it("renders the >=1km amenity presets in km (mixed-unit list)", () => {
    renderAmenity(0.5)
    expect(presetButton("1 km")).toBeInTheDocument()
    expect(presetButton("4 km")).toBeInTheDocument()
    expect(presetButton("5 km")).toBeInTheDocument()
  })

  it("calls onChange (the amenity handler) with the clicked preset's km value, including sub-km presets", () => {
    const onChange = renderAmenity(0.5)
    fireEvent.click(presetButton("250 m"))
    expect(onChange).toHaveBeenCalledWith(0.25)
  })

  it("highlights the persisted default (4km) as active when it is the current radius", () => {
    renderAmenity(4)
    expect(presetButton("4 km").className).toMatch(/bg-primary/)
    expect(presetButton("5 km").className).not.toMatch(/bg-primary\b/)
  })

  it("does not call onChange when the already-active sub-km preset is clicked again", () => {
    const onChange = renderAmenity(0.25)
    fireEvent.click(presetButton("250 m"))
    expect(onChange).not.toHaveBeenCalled()
  })
})
