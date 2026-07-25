// @vitest-environment jsdom
//
// Language selection on first start, and the <html lang> attribute that goes
// with it. Both were previously wrong for every non-German visitor on "/":
// the locale was resolved in a PASSIVE effect (so a German first frame
// painted before it flipped), and the root layout's hardcoded lang="de" was
// only ever corrected on /en/* routes — leaving English text inside a
// document declared as German, which screen readers use to pick pronunciation
// (WCAG 2.2 SC 3.1.1).

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { LocaleProvider, useTranslations } from "@/lib/i18n"

function Probe() {
  // `chat.thinking` differs per locale and is a plain string in both.
  return <span data-testid="probe">{useTranslations().chat.thinking}</span>
}

function setBrowserLanguage(lang: string) {
  Object.defineProperty(window.navigator, "language", { value: lang, configurable: true })
}

function setPath(pathname: string, search = "") {
  window.history.replaceState({}, "", pathname + search)
}

const DE = "de" as const
const EN = "en" as const

beforeEach(() => {
  localStorage.clear()
  document.documentElement.lang = DE  // what the root layout server-renders
  setPath("/")
})

afterEach(() => {
  setBrowserLanguage("de-DE")
  setPath("/")
})

describe("LocaleProvider — first-start language selection", () => {
  it("falls back to the browser language when nothing is stored", () => {
    setBrowserLanguage("en-GB")
    render(<LocaleProvider><Probe /></LocaleProvider>)
    expect(screen.getByTestId("probe").textContent).toBe("Searching …")
  })

  it("treats any non-German browser language as English, not just en-*", () => {
    setBrowserLanguage("fr-FR")
    render(<LocaleProvider><Probe /></LocaleProvider>)
    expect(screen.getByTestId("probe").textContent).toBe("Searching …")
  })

  it("matches German regional variants on the two-letter prefix", () => {
    setBrowserLanguage("de-AT")
    render(<LocaleProvider><Probe /></LocaleProvider>)
    expect(screen.getByTestId("probe").textContent).toBe("Suche läuft …")
  })

  it("a stored choice beats the browser language", () => {
    setBrowserLanguage("en-GB")
    localStorage.setItem("locale", DE)
    render(<LocaleProvider><Probe /></LocaleProvider>)
    expect(screen.getByTestId("probe").textContent).toBe("Suche läuft …")
  })

  it("a ?lang= parameter beats a stored choice, and is persisted", () => {
    setBrowserLanguage("de-DE")
    localStorage.setItem("locale", DE)
    setPath("/", "?lang=en")
    render(<LocaleProvider><Probe /></LocaleProvider>)
    expect(screen.getByTestId("probe").textContent).toBe("Searching …")
    expect(localStorage.getItem("locale")).toBe(EN)
  })

  it("does not persist anything when it only detected the browser language", () => {
    setBrowserLanguage("en-GB")
    render(<LocaleProvider><Probe /></LocaleProvider>)
    expect(localStorage.getItem("locale")).toBeNull()
  })

  it("lets the route win outright — no detection, no storage read", () => {
    setBrowserLanguage("de-DE")
    localStorage.setItem("locale", DE)
    render(<LocaleProvider initialLocale="en"><Probe /></LocaleProvider>)
    expect(screen.getByTestId("probe").textContent).toBe("Searching …")
  })
})

describe("LocaleProvider — <html lang> follows the resolved locale", () => {
  it("corrects the server-rendered 'de' for an English visitor on /", () => {
    setBrowserLanguage("en-GB")
    render(<LocaleProvider><Probe /></LocaleProvider>)
    expect(document.documentElement.lang).toBe(EN)
  })

  it("leaves it at 'de' for a German visitor on /", () => {
    setBrowserLanguage("de-DE")
    render(<LocaleProvider><Probe /></LocaleProvider>)
    expect(document.documentElement.lang).toBe(DE)
  })

  it("a route-controlled provider sets its own locale", () => {
    render(<LocaleProvider initialLocale="en"><Probe /></LocaleProvider>)
    expect(document.documentElement.lang).toBe(EN)
  })

  // The /en/* routes nest their own provider inside the root one. The outer,
  // auto-detecting instance must not overwrite what the inner one set — child
  // effects run before parent effects, so without the path guard the outer one
  // would win and a German-browser visitor to /en/faq would get lang="de" on
  // an English page.
  it("the outer auto-detecting provider keeps its hands off on /en routes", () => {
    setBrowserLanguage("de-DE")
    setPath("/en/faq")
    render(
      <LocaleProvider>
        <LocaleProvider initialLocale="en"><Probe /></LocaleProvider>
      </LocaleProvider>,
    )
    expect(document.documentElement.lang).toBe(EN)
    expect(screen.getByTestId("probe").textContent).toBe("Searching …")
  })
})
