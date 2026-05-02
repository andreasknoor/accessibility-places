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
