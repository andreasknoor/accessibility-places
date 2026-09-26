import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { LocaleProvider } from "@/lib/i18n"
import NavigateButton from "@/components/ui/navigate-button"

const mockGetPlatform = vi.fn<() => string>()
vi.mock("@/lib/analytics", () => ({ getPlatform: () => mockGetPlatform(), track: vi.fn() }))

const startDefaultNavigation = vi.fn()
const startNavigationWithApp = vi.fn()
vi.mock("@/lib/native/navigation", () => ({
  startDefaultNavigation: (...args: unknown[]) => startDefaultNavigation(...args),
  startNavigationWithApp: (...args: unknown[]) => startNavigationWithApp(...args),
  // Real behaviour, not a stub — these tests exercise the Android-vs-other
  // branching itself, so shouldShowChooser must actually react to the
  // mocked platform the same way the real implementation does.
  shouldShowChooser: (platform: string) => platform === "android",
}))

function renderButton(variant: "labeled" | "action" | "tile" = "labeled", emphasis?: "primary" | "secondary") {
  return render(
    <LocaleProvider initialLocale="de">
      <NavigateButton coords={{ lat: 52.52, lon: 13.405 }} variant={variant} emphasis={emphasis} />
    </LocaleProvider>,
  )
}

beforeEach(() => {
  mockGetPlatform.mockReturnValue("web")
  startDefaultNavigation.mockClear()
  startNavigationWithApp.mockClear()
})

describe("NavigateButton — non-Android platforms (no chooser)", () => {
  it("fires startDefaultNavigation directly on web, no popover", () => {
    mockGetPlatform.mockReturnValue("web")
    renderButton()
    fireEvent.click(screen.getByRole("button", { name: /^Route/ }))
    expect(startDefaultNavigation).toHaveBeenCalledWith({ lat: 52.52, lon: 13.405 })
    expect(screen.queryByText("Navigieren mit")).not.toBeInTheDocument()
  })

  it("fires startDefaultNavigation directly on iOS, no popover", () => {
    mockGetPlatform.mockReturnValue("ios")
    renderButton()
    fireEvent.click(screen.getByRole("button", { name: /^Route/ }))
    expect(startDefaultNavigation).toHaveBeenCalledWith({ lat: 52.52, lon: 13.405 })
    expect(screen.queryByText("Navigieren mit")).not.toBeInTheDocument()
  })
})

describe("NavigateButton — Android (reduced-scope chooser)", () => {
  beforeEach(() => mockGetPlatform.mockReturnValue("android"))

  it("opens a chooser popover instead of navigating immediately", () => {
    renderButton()
    fireEvent.click(screen.getByRole("button", { name: /^Route/ }))
    expect(startDefaultNavigation).not.toHaveBeenCalled()
    expect(screen.getByText("Navigieren mit")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Google Maps" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Andere Navigations-App" })).toBeInTheDocument()
  })

  it("'Google Maps' option fires startNavigationWithApp('google', coords)", () => {
    renderButton()
    fireEvent.click(screen.getByRole("button", { name: /^Route/ }))
    fireEvent.click(screen.getByRole("button", { name: "Google Maps" }))
    expect(startNavigationWithApp).toHaveBeenCalledWith("google", { lat: 52.52, lon: 13.405 })
  })

  it("'Andere Navigations-App' option fires startNavigationWithApp('geo', coords)", () => {
    renderButton()
    fireEvent.click(screen.getByRole("button", { name: /^Route/ }))
    fireEvent.click(screen.getByRole("button", { name: "Andere Navigations-App" }))
    expect(startNavigationWithApp).toHaveBeenCalledWith("geo", { lat: 52.52, lon: 13.405 })
  })
})

describe("NavigateButton — variants", () => {
  it("every variant shows the same short label 'Route' plus the external-app arrow", () => {
    for (const v of ["labeled", "action", "tile"] as const) {
      const { unmount } = renderButton(v)
      expect(screen.getByText("Route")).toBeInTheDocument()
      expect(screen.getByRole("button").querySelectorAll("svg")).toHaveLength(2) // compass + ↗
      unmount()
    }
  })

  // WCAG 2.5.3 (label in name): the accessible name starts with the visible
  // label, so speech-input users can say "Route".
  it("every variant's accessible name says it opens another app", () => {
    for (const v of ["labeled", "action", "tile"] as const) {
      const { unmount } = renderButton(v)
      expect(screen.getByRole("button", { name: "Route (öffnet eine andere App)" })).toBeInTheDocument()
      unmount()
    }
  })

  it("'action' is secondary (not filled blue) unless emphasis='primary' is requested", () => {
    const { unmount } = renderButton("action")
    expect(screen.getByRole("button").className).not.toMatch(/(^|\s)bg-primary(\s|$)/)
    unmount()
    renderButton("action", "primary")
    expect(screen.getByRole("button").className).toMatch(/(^|\s)bg-primary(\s|$)/)
  })
})

describe("NavigateButton — click does not bubble to an ancestor's own click handler", () => {
  it("stops propagation so a card's outer 'open details' handler doesn't also fire", () => {
    const outerClick = vi.fn()
    render(
      <LocaleProvider initialLocale="de">
        <div onClick={outerClick}>
          <NavigateButton coords={{ lat: 52.52, lon: 13.405 }} variant="action" />
        </div>
      </LocaleProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: /^Route/ }))
    expect(outerClick).not.toHaveBeenCalled()
    expect(startDefaultNavigation).toHaveBeenCalled()
  })
})
