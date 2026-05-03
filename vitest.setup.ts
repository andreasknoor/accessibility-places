import "@testing-library/jest-dom"

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
