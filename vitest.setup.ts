import "@testing-library/jest-dom"

// Radix UI Slider uses ResizeObserver — mock it for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
