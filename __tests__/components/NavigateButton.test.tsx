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
}))

function renderButton(variant: "sticky" | "icon" | "labeled" = "sticky") {
  return render(
    <LocaleProvider initialLocale="de">
      <NavigateButton coords={{ lat: 52.52, lon: 13.405 }} variant={variant} />
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
    fireEvent.click(screen.getByRole("button", { name: "Navigation starten" }))
    expect(startDefaultNavigation).toHaveBeenCalledWith({ lat: 52.52, lon: 13.405 })
    expect(screen.queryByText("Navigieren mit")).not.toBeInTheDocument()
  })

  it("fires startDefaultNavigation directly on iOS, no popover", () => {
    mockGetPlatform.mockReturnValue("ios")
    renderButton()
    fireEvent.click(screen.getByRole("button", { name: "Navigation starten" }))
    expect(startDefaultNavigation).toHaveBeenCalledWith({ lat: 52.52, lon: 13.405 })
    expect(screen.queryByText("Navigieren mit")).not.toBeInTheDocument()
  })
})

describe("NavigateButton — Android (reduced-scope chooser)", () => {
  beforeEach(() => mockGetPlatform.mockReturnValue("android"))

  it("opens a chooser popover instead of navigating immediately", () => {
    renderButton()
    fireEvent.click(screen.getByRole("button", { name: "Navigation starten" }))
    expect(startDefaultNavigation).not.toHaveBeenCalled()
    expect(screen.getByText("Navigieren mit")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Google Maps" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Andere Navigations-App" })).toBeInTheDocument()
  })

  it("'Google Maps' option fires startNavigationWithApp('google', coords)", () => {
    renderButton()
    fireEvent.click(screen.getByRole("button", { name: "Navigation starten" }))
    fireEvent.click(screen.getByRole("button", { name: "Google Maps" }))
    expect(startNavigationWithApp).toHaveBeenCalledWith("google", { lat: 52.52, lon: 13.405 })
  })

  it("'Andere Navigations-App' option fires startNavigationWithApp('geo', coords)", () => {
    renderButton()
    fireEvent.click(screen.getByRole("button", { name: "Navigation starten" }))
    fireEvent.click(screen.getByRole("button", { name: "Andere Navigations-App" }))
    expect(startNavigationWithApp).toHaveBeenCalledWith("geo", { lat: 52.52, lon: 13.405 })
  })
})

describe("NavigateButton — variants", () => {
  it("'icon' variant renders an icon-only button with an accessible name but no visible label text", () => {
    renderButton("icon")
    const button = screen.getByRole("button", { name: "Navigation starten" })
    expect(button).toBeInTheDocument()
    expect(button.textContent?.trim()).toBe("")
  })

  it("'labeled' and 'sticky' variants render visible label text", () => {
    const { unmount } = renderButton("labeled")
    expect(screen.getByText("Navigation starten")).toBeInTheDocument()
    unmount()
    renderButton("sticky")
    expect(screen.getByText("Navigation starten")).toBeInTheDocument()
  })
})

describe("NavigateButton — click does not bubble to an ancestor's own click handler", () => {
  it("stops propagation so a card's outer 'open details' handler doesn't also fire", () => {
    const outerClick = vi.fn()
    render(
      <LocaleProvider initialLocale="de">
        <div onClick={outerClick}>
          <NavigateButton coords={{ lat: 52.52, lon: 13.405 }} variant="icon" />
        </div>
      </LocaleProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Navigation starten" }))
    expect(outerClick).not.toHaveBeenCalled()
    expect(startDefaultNavigation).toHaveBeenCalled()
  })
})
