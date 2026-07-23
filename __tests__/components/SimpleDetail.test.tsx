import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { LocaleProvider } from "@/lib/i18n"
import SimpleDetail from "@/components/simple/SimpleDetail"
import { buildAttribute } from "@/lib/matching/merge"
import type { Place } from "@/lib/types"

vi.mock("@/lib/native/navigation", () => ({
  startDefaultNavigation: vi.fn(),
  startNavigationWithApp: vi.fn(),
  shouldShowChooser: () => false,
}))
// Requires a Next.js App Router context (useRouter/usePathname) that isn't
// mounted in these unit tests — same mock HomeClient.test.tsx already uses.
vi.mock("@/components/LanguageSwitcher", () => ({ default: () => null }))

function renderWithProvider(ui: React.ReactElement) {
  return render(<LocaleProvider initialLocale="de">{ui}</LocaleProvider>)
}

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "Restaurant Zur Post",
    category: "restaurant",
    address: { street: "Hohenzollernring", houseNumber: "8", postalCode: "50672", city: "Köln", country: "DE" },
    coordinates: { lat: 50.94, lon: 6.94 },
    accessibility: {
      entrance: buildAttribute("osm", "yes",     "yes",     {}),
      toilet:   buildAttribute("osm", "limited", "limited", {}),
      parking:  buildAttribute("osm", "no",      "no",      {}),
    },
    overallConfidence: 0.75,
    primarySource: "osm",
    sourceRecords: [{ sourceId: "osm", externalId: "2", fetchedAt: "", raw: {} }],
    ...overrides,
  }
}

describe("SimpleDetail", () => {
  it("renders name, address, and distance", () => {
    renderWithProvider(<SimpleDetail place={makePlace()} distanceM={410} onBack={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.getByText("Restaurant Zur Post")).toBeInTheDocument()
    expect(screen.getByText(/Hohenzollernring 8 Köln/)).toBeInTheDocument()
    expect(screen.getByText("410 m entfernt")).toBeInTheDocument()
  })

  it("renders all three criteria as plain sentences matching their values", () => {
    renderWithProvider(<SimpleDetail place={makePlace()} onBack={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.getByText("Eingang stufenlos erreichbar")).toBeInTheDocument()
    expect(screen.getByText("WC eingeschränkt nutzbar")).toBeInTheDocument()
    expect(screen.getByText("Kein barrierefreier Parkplatz")).toBeInTheDocument()
  })

  it("shows a call link only when a phone number is present", () => {
    const { rerender } = renderWithProvider(<SimpleDetail place={makePlace()} onBack={vi.fn()} onOpenSettings={vi.fn()} />)
    expect(screen.queryByText("Anrufen")).not.toBeInTheDocument()
    rerender(
      <LocaleProvider initialLocale="de">
        <SimpleDetail place={makePlace({ phone: "+49123456789" })} onBack={vi.fn()} onOpenSettings={vi.fn()} />
      </LocaleProvider>,
    )
    const callLink = screen.getByText("Anrufen").closest("a")
    expect(callLink).toHaveAttribute("href", "tel:+49123456789")
  })

  it("shows a website link only when a website is present", () => {
    renderWithProvider(<SimpleDetail place={makePlace({ website: "https://example.com" })} onBack={vi.fn()} onOpenSettings={vi.fn()} />)
    const websiteLink = screen.getByText("Website besuchen").closest("a")
    expect(websiteLink).toHaveAttribute("href", "https://example.com")
  })

  it("calls onBack when the back button is clicked", () => {
    const onBack = vi.fn()
    renderWithProvider(<SimpleDetail place={makePlace()} onBack={onBack} onOpenSettings={vi.fn()} />)
    fireEvent.click(screen.getByText("Zurück"))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it("calls onOpenSettings when the settings icon is clicked — the full-UI return path must stay reachable from the detail screen too", () => {
    const onOpenSettings = vi.fn()
    renderWithProvider(<SimpleDetail place={makePlace()} onBack={vi.fn()} onOpenSettings={onOpenSettings} />)
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen" }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  // Same trigger (placeMayNotBeAccessible: entrance/toilet "no"/"unknown") and
  // wording as PlaceCard/PlaceDebugSheet's shared NotAccessibleWarningBox —
  // Simple View's reduced detail screen must not silently drop this warning.
  describe("possibly-not-accessible warning", () => {
    it("is hidden when neither entrance nor toilet is flagged (default fixture: yes/limited)", () => {
      renderWithProvider(<SimpleDetail place={makePlace()} onBack={vi.fn()} onOpenSettings={vi.fn()} />)
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    })

    it("shows the warning when entrance is 'no'", () => {
      renderWithProvider(
        <SimpleDetail
          place={makePlace({ accessibility: { ...makePlace().accessibility, entrance: buildAttribute("osm", "no", "no", {}) } })}
          onBack={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      )
      expect(screen.getByRole("alert")).toHaveTextContent("Achtung: Evtl. nicht barrierefrei.")
    })

    it("shows the warning when toilet is 'unknown'", () => {
      renderWithProvider(
        <SimpleDetail
          place={makePlace({ accessibility: { ...makePlace().accessibility, toilet: buildAttribute("osm", "unknown", "unknown", {}) } })}
          onBack={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      )
      expect(screen.getByRole("alert")).toBeInTheDocument()
    })

    // Deliberately excluded from the trigger (see placeMayNotBeAccessible) —
    // parking has much sparser data and would fire far too often.
    it("does not fire on a flagged parking value alone", () => {
      renderWithProvider(
        <SimpleDetail
          place={makePlace({ accessibility: { ...makePlace().accessibility, parking: buildAttribute("osm", "unknown", "unknown", {}) } })}
          onBack={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      )
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    })
  })
})
