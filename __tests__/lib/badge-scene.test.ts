import { describe, it, expect } from "vitest"
import { buildBadgeScene, badgeKey, type BadgeSpec } from "@/lib/amenities/badge-scene"

const hasWheelchairPlaque = (spec: BadgeSpec) =>
  buildBadgeScene(spec, 28).ops.some((o) => o.t === "circle")

describe("badge scene", () => {
  it("adds the wheelchair plaque only for the strong tier", () => {
    expect(hasWheelchairPlaque({ kind: "parking", tier: "strong" })).toBe(true)
    expect(hasWheelchairPlaque({ kind: "parking", tier: "weak" })).toBe(false)
    expect(hasWheelchairPlaque({ kind: "toilet", tier: "strong", host: "venue", euroKey: false })).toBe(true)
    expect(hasWheelchairPlaque({ kind: "toilet", tier: "weak", host: "standalone", euroKey: false })).toBe(false)
  })

  it("widens the toilet badge for Euro-key spots", () => {
    const plain = buildBadgeScene({ kind: "toilet", tier: "weak", host: "standalone", euroKey: false }, 28)
    const euro  = buildBadgeScene({ kind: "toilet", tier: "weak", host: "standalone", euroKey: true }, 28)
    expect(euro.w).toBeGreaterThan(plain.w)
    expect(euro.h).toBe(plain.h)
  })

  it("gives every distinct spec its own cache key", () => {
    const specs: BadgeSpec[] = [
      { kind: "parking", tier: "strong" }, { kind: "parking", tier: "weak" },
      { kind: "toilet", tier: "strong", host: "standalone", euroKey: false },
      { kind: "toilet", tier: "weak",   host: "standalone", euroKey: false },
      { kind: "toilet", tier: "weak",   host: "venue",      euroKey: false },
      { kind: "toilet", tier: "weak",   host: "venue",      euroKey: true },
    ]
    expect(new Set(specs.map(badgeKey)).size).toBe(specs.length)
  })
})
