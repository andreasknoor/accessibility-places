// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const evalMock = vi.fn().mockResolvedValue(1)
vi.mock("@upstash/redis", () => ({
  Redis: class { eval = evalMock },
}))

describe("stats write path batching", () => {
  beforeEach(() => {
    evalMock.mockClear()
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "t"
  })

  it("coalesces call + error + duration of one source into a single EVAL", async () => {
    const { trackCall, trackError, trackDuration } = await import("@/lib/stats")
    trackCall("osm")
    trackError("osm")
    trackDuration("osm", 120)
    trackDuration("osm", 80)
    await Promise.resolve()
    expect(evalMock).toHaveBeenCalledTimes(1)
    const [, keys, args] = evalMock.mock.calls[0]
    expect(keys[0]).toMatch(/^stats:h:calls:osm:\d{4}-\d{2}-\d{2}T\d{2}$/)
    expect(keys[2]).toMatch(/^stats:h:dur:sum:osm:/)
    expect(args.slice(1)).toEqual([1, 1, 120, 80])
  })

  it("uses one EVAL per source", async () => {
    const { trackCall, trackDuration } = await import("@/lib/stats")
    trackCall("osm"); trackDuration("osm", 10)
    trackCall("ginto"); trackDuration("ginto", 20)
    await Promise.resolve()
    expect(evalMock).toHaveBeenCalledTimes(2)
  })

  it("sends no duration args when only a counter is recorded", async () => {
    const { trackCall } = await import("@/lib/stats")
    trackCall("nominatim")
    await Promise.resolve()
    expect(evalMock.mock.calls[0][2].slice(1)).toEqual([1, 0])
  })
})
