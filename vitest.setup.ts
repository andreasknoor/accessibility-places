// Give tests a realistic two-endpoint Overpass config (a private server first,
// then the public mirror) so the OSM adapter's parallel-race / fallback logic
// stays exercised even though the production *default* is a single public
// mirror. Must be set before lib/config is imported (setup runs before the test
// module). The private entry is intentionally NOT in PUBLIC_OVERPASS_ENDPOINTS so
// region-aware endpoint tests can verify it is dropped outside DACH.
process.env.OVERPASS_ENDPOINTS =
  "https://overpass.private.test/api/interpreter,https://overpass-api.de/api/interpreter"

import "@testing-library/jest-dom"

// Accessibility (WCAG) testing — register the axe matcher so a11y test files can
// call `expect(await axe(container)).toHaveNoViolations()`. jsdom has no layout
// engine, so axe here catches the *structural* subset (names, roles, labels,
// attributes) — NOT contrast/reflow/focus-visibility, which need a real browser
// and human/AT verification (see docs/wcag-accessibility-plan.md). Phase 0.
import { expect } from "vitest"
import * as axeMatchers from "vitest-axe/matchers"
expect.extend(axeMatchers)

// Radix UI Slider uses ResizeObserver — mock it for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// ConfidenceBadge uses useIsMobile which calls window.matchMedia — mock it for jsdom.
// Guard with typeof check because node-environment tests also load this setup file.
if (typeof window !== "undefined") {
  // ChatPanel reads localStorage to show the first-visit pulse only once.
  const store: Record<string, string> = {}
  Object.defineProperty(window, "localStorage", {
    writable: true,
    value: {
      getItem:    (k: string) => store[k] ?? null,
      setItem:    (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
      clear:      () => { Object.keys(store).forEach((k) => delete store[k]) },
    },
  })

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches:             false,
      media:               query,
      onchange:            null,
      addListener:         () => {},
      removeListener:      () => {},
      addEventListener:    () => {},
      removeEventListener: () => {},
      dispatchEvent:       () => false,
    }),
  })
}
