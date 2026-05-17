// @vitest-environment node
//
// ISR safety: fetchPlacesForSeoPage must never call trackCall or trackError.
// If it does, Next.js detects the no-store Upstash fetch and demotes the
// static ISR page to dynamic at runtime — crashing all /[city]/[category] routes.
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/stats", () => ({
  trackCall:  vi.fn(),
  trackError: vi.fn(),
  getStats:   vi.fn().mockResolvedValue({}),
}))

import { fetchPlacesForSeoPage } from "@/lib/seo-search"
import { trackCall, trackError } from "@/lib/stats"

const BERLIN = { lat: 52.52, lon: 13.405 } as const

describe("fetchPlacesForSeoPage — ISR safety (no stats side-effects)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("does not call trackCall or trackError when adapters succeed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:   true,
      json: async () => ({ elements: [] }),
    }))

    await fetchPlacesForSeoPage(BERLIN.lat, BERLIN.lon, "restaurant")

    expect(trackCall).not.toHaveBeenCalled()
    expect(trackError).not.toHaveBeenCalled()
  })

  it("does not call trackCall or trackError when an adapter fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")))

    await fetchPlacesForSeoPage(BERLIN.lat, BERLIN.lon, "restaurant")

    expect(trackCall).not.toHaveBeenCalled()
    expect(trackError).not.toHaveBeenCalled()
  })
})
