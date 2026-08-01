import { describe, it, expect } from "vitest"
import {
  popupMaxHeight,
  isWithinProgrammaticMoveWindow,
  viewportRadiusKm,
  PROGRAMMATIC_MOVE_WINDOW_MS,
} from "@/lib/map/geometry"

describe("popupMaxHeight", () => {
  it("caps at 55% of map height for a normal-sized map", () => {
    expect(popupMaxHeight(1000)).toBe(550)
  })

  it("floors at 160px even when 55% would be smaller", () => {
    expect(popupMaxHeight(200)).toBe(160)
  })

  it("clamps to the container limit (mapHeight - 40) on a very short map", () => {
    // 55%-of-height cap would be 165 (>=160 floor), but the container only
    // leaves 150px (190 - 40) — the container limit must win.
    expect(popupMaxHeight(190)).toBe(150)
  })

  it("never returns less than 60px even on a tiny split-pane height", () => {
    expect(popupMaxHeight(90)).toBe(60)
  })

  it("returns 60 at the split-pane minimum (SPLIT_PANE_MIN_PX=90)", () => {
    expect(popupMaxHeight(90)).toBe(60)
  })
})

describe("isWithinProgrammaticMoveWindow", () => {
  it("treats a move immediately after a programmatic stamp as programmatic", () => {
    const stamp = 1_000
    expect(isWithinProgrammaticMoveWindow(stamp, stamp)).toBe(true)
  })

  it("treats a move just under the window as programmatic", () => {
    const stamp = 1_000
    expect(isWithinProgrammaticMoveWindow(stamp, stamp + PROGRAMMATIC_MOVE_WINDOW_MS - 1)).toBe(true)
  })

  it("treats a move at or past the window as a genuine user pan", () => {
    const stamp = 1_000
    expect(isWithinProgrammaticMoveWindow(stamp, stamp + PROGRAMMATIC_MOVE_WINDOW_MS)).toBe(false)
    expect(isWithinProgrammaticMoveWindow(stamp, stamp + PROGRAMMATIC_MOVE_WINDOW_MS + 500)).toBe(false)
  })
})

describe("viewportRadiusKm", () => {
  it("returns ~0 for a zero-size viewport", () => {
    const center = { lat: 52.52, lon: 13.405 }
    expect(viewportRadiusKm(center, center)).toBeCloseTo(0, 5)
  })

  it("matches haversine distance for a real corner offset (Berlin, ~1km NE)", () => {
    const center = { lat: 52.52, lon: 13.405 }
    const corner = { lat: 52.529, lon: 13.419 }
    const km = viewportRadiusKm(center, corner)
    // Sanity range rather than an exact literal — real-world great-circle
    // distance for this offset is close to 1.4km.
    expect(km).toBeGreaterThan(1.2)
    expect(km).toBeLessThan(1.5)
  })

  it("is symmetric (order of center/corner doesn't matter)", () => {
    const a = { lat: 48.137, lon: 11.575 }
    const b = { lat: 48.15, lon: 11.6 }
    expect(viewportRadiusKm(a, b)).toBeCloseTo(viewportRadiusKm(b, a), 10)
  })
})
