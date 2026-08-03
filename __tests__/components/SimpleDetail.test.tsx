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
    renderWithProvider(<SimpleDetail place={makePlace()} distanceM={410} onBack={vi.fn()} onOpenSettings={vi.fn()} onSwitchToTurbo={vi.fn()} />)
    expect(screen.getByText("Restaurant Zur Post")).toBeInTheDocument()
    expect(screen.getByText(/Hohenzollernring 8 Köln/)).toBeInTheDocument()
    expect(screen.getByText("410 m entfernt")).toBeInTheDocument()
  })

  it("renders all three criteria as plain sentences matching their values", () => {
    renderWithProvider(<SimpleDetail place={makePlace()} onBack={vi.fn()} onOpenSettings={vi.fn()} onSwitchToTurbo={vi.fn()} />)
    expect(screen.getByText("Eingang stufenlos erreichbar")).toBeInTheDocument()
    expect(screen.getByText("WC eingeschränkt nutzbar")).toBeInTheDocument()
    expect(screen.getByText("Kein barrierefreier Parkplatz")).toBeInTheDocument()
  })

  it("shows a call link only when a phone number is present", () => {
    const { rerender } = renderWithProvider(<SimpleDetail place={makePlace()} onBack={vi.fn()} onOpenSettings={vi.fn()} onSwitchToTurbo={vi.fn()} />)
    expect(screen.queryByText("Anrufen")).not.toBeInTheDocument()
    rerender(
      <LocaleProvider initialLocale="de">
        <SimpleDetail place={makePlace({ phone: "+49123456789" })} onBack={vi.fn()} onOpenSettings={vi.fn()} onSwitchToTurbo={vi.fn()} />
      </LocaleProvider>,
    )
    const callLink = screen.getByText("Anrufen").closest("a")
    expect(callLink).toHaveAttribute("href", "tel:+49123456789")
  })

  it("shows a website link only when a website is present", () => {
    renderWithProvider(<SimpleDetail place={makePlace({ website: "https://example.com" })} onBack={vi.fn()} onOpenSettings={vi.fn()} onSwitchToTurbo={vi.fn()} />)
    const websiteLink = screen.getByText("Website besuchen").closest("a")
    expect(websiteLink).toHaveAttribute("href", "https://example.com")
  })

  it("calls onBack when the back button is clicked", () => {
    const onBack = vi.fn()
    renderWithProvider(<SimpleDetail place={makePlace()} onBack={onBack} onOpenSettings={vi.fn()} onSwitchToTurbo={vi.fn()} />)
    fireEvent.click(screen.getByText("Zurück"))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it("calls onOpenSettings when the settings icon is clicked — the full-UI return path must stay reachable from the detail screen too", () => {
    const onOpenSettings = vi.fn()
    renderWithProvider(<SimpleDetail place={makePlace()} onBack={vi.fn()} onOpenSettings={onOpenSettings} onSwitchToTurbo={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Einstellungen" }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  // Fixed, absolute headline (v13, decision 7) — replaces the old percentage
  // confidence badge. Quickstart's preset is fixed by app design (unlike
  // Turbo's user-chosen filters), so the headline states the judgement
  // outright. Uses category "museum" (not in SIMPLE_TOILET_REQUIRED_CATEGORIES)
  // so the toilet value can't affect this judgement — only entrance does.
  it("shows the fixed 'Barrierefrei nutzbar' headline when entrance passes cleanly", () => {
    renderWithProvider(<SimpleDetail place={makePlace({ category: "museum" })} onBack={vi.fn()} onOpenSettings={vi.fn()} onSwitchToTurbo={vi.fn()} />)
    expect(screen.getByText("Barrierefrei nutzbar")).toBeInTheDocument()
  })

  it("shows the caveat headline when entrance is 'limited'", () => {
    const place = makePlace({ category: "museum" })
    renderWithProvider(
      <SimpleDetail
        place={{ ...place, accessibility: { ...place.accessibility, entrance: buildAttribute("osm", "limited", "limited", {}) } }}
        onBack={vi.fn()} onOpenSettings={vi.fn()} onSwitchToTurbo={vi.fn()}
      />,
    )
    expect(screen.getByText("Barrierefrei nutzbar – mit Einschränkung")).toBeInTheDocument()
  })

  // The separate "Achtung: evtl. nicht barrierefrei" warning box was retired
  // 2026-08-02 (Option 3) — it said almost exactly what the headline above
  // already says. These deep-link-only edge cases (a place that fails
  // Quickstart's own fixed preset can still open, see the component's own
  // comment) now show a neutral, non-possessive headline instead — never
  // "deine Kriterien" wording, since Quickstart's preset isn't user-chosen.
  describe("deep-linked place failing Quickstart's fixed preset", () => {
    it("shows the neutral 'Nicht barrierefrei' headline when entrance is 'no'", () => {
      const place = makePlace({ category: "museum" }) // not toilet-required, isolates entrance
      renderWithProvider(
        <SimpleDetail
          place={{ ...place, accessibility: { ...place.accessibility, entrance: buildAttribute("osm", "no", "no", {}) } }}
          onBack={vi.fn()} onOpenSettings={vi.fn()} onSwitchToTurbo={vi.fn()}
        />,
      )
      expect(screen.getByText("Nicht barrierefrei")).toBeInTheDocument()
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    })

    // Quickstart's fixed preset always has acceptUnknown: false, so an
    // unknown value on a required criterion resolves to "fail" (not
    // "unverified") — evaluatePlaceJudgment only ever produces "unverified"
    // when acceptUnknown is on, which Quickstart never sets. This is the
    // same neutral headline as the entrance="no" case above, just reached
    // via a different criterion.
    it("shows the neutral 'Nicht barrierefrei' headline when a required toilet is merely unknown", () => {
      const place = makePlace({ category: "restaurant" }) // toilet-required category
      renderWithProvider(
        <SimpleDetail
          place={{ ...place, accessibility: { ...place.accessibility, toilet: buildAttribute("osm", "unknown", "unknown", {}) } }}
          onBack={vi.fn()} onOpenSettings={vi.fn()} onSwitchToTurbo={vi.fn()}
        />,
      )
      expect(screen.getByText("Nicht barrierefrei")).toBeInTheDocument()
    })
  })
})
