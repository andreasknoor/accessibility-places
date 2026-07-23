// WCAG accessibility baseline — Phase 0 (see docs/wcag-accessibility-plan.md).
//
// Runs axe-core against rendered components to catch the STRUCTURAL subset of
// WCAG issues (accessible names, roles, ARIA validity, labels). This is a
// regression net, NOT a conformance guarantee:
//   • jsdom has no layout/paint → contrast (1.4.3), reflow (1.4.10) and focus
//     visibility (2.4.7) are NOT checked here. Those need a real browser + human
//     / assistive-technology testing.
//   • axe covers only ~30–40% of success criteria even in a real browser.
//
// As more components are made accessible (Phase 1+), add them here so violations
// can never silently regress.
import { describe, it, expect, vi } from "vitest"
import { render, fireEvent, screen } from "@testing-library/react"
import { axe } from "vitest-axe"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LocaleProvider } from "@/lib/i18n"
import ConfidenceBadge from "@/components/results/ConfidenceBadge"
import PlaceCard from "@/components/results/PlaceCard"
import FilterPanel from "@/components/filters/FilterPanel"
import ResultsList from "@/components/results/ResultsList"
import SettingsSheet from "@/components/settings/SettingsSheet"
import SimpleLayout from "@/components/simple/SimpleLayout"
import SimpleDetail from "@/components/simple/SimpleDetail"
import SimplePlaceCard from "@/components/simple/SimplePlaceCard"
import { DEFAULT_APP_SETTINGS } from "@/lib/settings"
import { buildAttribute } from "@/lib/matching/merge"
import type { Place, SearchFilters, ActiveSources } from "@/lib/types"

// Same mocks SimpleLayout/SimpleDetail/SimplePlaceCard's own unit tests use —
// LanguageSwitcher needs a Next.js App Router context (useRouter/usePathname)
// that isn't mounted here; the native modules touch Capacitor plugins that
// don't exist in jsdom.
vi.mock("@/components/LanguageSwitcher", () => ({ default: () => null }))
vi.mock("@/lib/native/navigation", () => ({
  startDefaultNavigation: vi.fn(),
  startNavigationWithApp: vi.fn(),
  shouldShowChooser: () => false,
}))
vi.mock("@/lib/native/haptics", () => ({ hapticLight: vi.fn(), hapticMedium: vi.fn() }))
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), getPlatform: () => "web" }))

const FILTERS: SearchFilters = {
  entrance: true, toilet: true, parking: true, parkingNearby: true, seating: false,
  onlyVerified: false, acceptUnknown: false, alwaysShowParking: false, alwaysShowToilets: false,
}
const SOURCES: ActiveSources = {
  accessibility_cloud: true, osm: true, reisen_fuer_alle: true, ginto: true, acceslibre: true, google_places: true,
}

function renderWithProviders(ui: React.ReactElement) {
  return render(<LocaleProvider><TooltipProvider>{ui}</TooltipProvider></LocaleProvider>)
}

// Pins the locale to "de" (rather than the auto-detected default the plain
// helper above leaves to the runtime's own navigator.language) — the Simple*
// component tests below assert on specific German button text after a click,
// which needs a stable, known locale rather than whatever jsdom happens to
// report.
function renderSimple(ui: React.ReactElement) {
  return render(<LocaleProvider initialLocale="de"><TooltipProvider>{ui}</TooltipProvider></LocaleProvider>)
}

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "Café Barrierefrei",
    category: "restaurant",
    address: { street: "Hauptstraße", houseNumber: "5", postalCode: "10115", city: "Berlin", country: "DE" },
    coordinates: { lat: 52.52, lon: 13.405 },
    website: "https://example.com",
    phone: "+49301234567",
    accessibility: {
      entrance: buildAttribute("osm", "yes",     "yes",     {}),
      toilet:   buildAttribute("osm", "limited", "limited", {}),
      parking:  buildAttribute("osm", "no",      "no",      {}),
    },
    overallConfidence: 0.72,
    primarySource: "osm",
    sourceRecords: [{ sourceId: "osm", externalId: "1", fetchedAt: "", raw: {} }],
    ...overrides,
  }
}

describe("a11y baseline — ConfidenceBadge", () => {
  it("has no structural axe violations", async () => {
    const { container } = renderWithProviders(<ConfidenceBadge confidence={0.85} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe("a11y baseline — PlaceCard", () => {
  it("has no structural axe violations", async () => {
    const { container } = renderWithProviders(<PlaceCard place={makePlace()} onClick={() => {}} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe("a11y baseline — FilterPanel", () => {
  it("has no structural axe violations", async () => {
    const { container } = renderWithProviders(
      <FilterPanel filters={FILTERS} sources={SOURCES} radiusKm={5}
        onFilters={() => {}} onSources={() => {}} onRadius={() => {}} />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe("a11y baseline — ResultsList", () => {
  it("has no structural axe violations (with results)", async () => {
    const { container } = renderWithProviders(
      <ResultsList places={[makePlace()]} filters={FILTERS} onSelect={() => {}}
        isLoading={false} hasSearched radiusKm={5} />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe("a11y baseline — SettingsSheet (open)", () => {
  it("has no structural axe violations", async () => {
    renderWithProviders(<SettingsSheet settings={DEFAULT_APP_SETTINGS} onUpdate={() => {}} />)
    fireEvent.click(screen.getByRole("button"))
    // Panel is portaled to document.body — scan the whole document.
    expect(await axe(document.body)).toHaveNoViolations()
  })
})

describe("a11y baseline — SimplePlaceCard", () => {
  it("has no structural axe violations", async () => {
    const { container } = renderSimple(
      <SimplePlaceCard place={makePlace()} distanceM={240} onOpen={() => {}} onShowOnMap={() => {}} />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe("a11y baseline — SimpleDetail", () => {
  it("has no structural axe violations", async () => {
    const { container } = renderSimple(
      <SimpleDetail place={makePlace()} distanceM={240} onBack={() => {}} onOpenSettings={() => {}} />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  // The warning box and confidence badge are conditional/data-driven — cover
  // the state where both render, not just the default fixture.
  it("has no structural axe violations with the confidence badge and not-accessible warning both showing", async () => {
    const { container } = renderSimple(
      <SimpleDetail
        place={makePlace({
          accessibility: {
            entrance: buildAttribute("osm", "no", "no", {}),
            toilet:   buildAttribute("osm", "unknown", "unknown", {}),
            parking:  buildAttribute("osm", "unknown", "unknown", {}),
          },
          overallConfidence: 0.25,
        })}
        onBack={() => {}}
        onOpenSettings={() => {}}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe("a11y baseline — SimpleLayout", () => {
  it("has no structural axe violations (start screen)", async () => {
    const { container } = renderSimple(
      <SimpleLayout
        places={[]}
        isLoading={false}
        onSelect={() => {}}
        onSimpleNearbySearch={() => {}}
        onPlaceSearch={() => {}}
        onAmenitySearch={() => {}}
        settings={DEFAULT_APP_SETTINGS}
        onUpdateSettings={() => {}}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it("has no structural axe violations (category/amenity tiles screen)", async () => {
    const { container } = renderSimple(
      <SimpleLayout
        places={[]}
        isLoading={false}
        onSelect={() => {}}
        onSimpleNearbySearch={() => {}}
        onPlaceSearch={() => {}}
        onAmenitySearch={() => {}}
        settings={DEFAULT_APP_SETTINGS}
        onUpdateSettings={() => {}}
      />,
    )
    fireEvent.click(screen.getByText("In meiner Nähe suchen"))
    expect(await axe(container)).toHaveNoViolations()
  })

  it("has no structural axe violations (venue-search screen)", async () => {
    const { container } = renderSimple(
      <SimpleLayout
        places={[]}
        isLoading={false}
        onSelect={() => {}}
        onSimpleNearbySearch={() => {}}
        onPlaceSearch={() => {}}
        onAmenitySearch={() => {}}
        settings={DEFAULT_APP_SETTINGS}
        onUpdateSettings={() => {}}
      />,
    )
    fireEvent.click(screen.getByText("Einen konkreten Ort prüfen"))
    expect(await axe(container)).toHaveNoViolations()
  })
})
