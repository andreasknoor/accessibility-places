// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockLimit = vi.fn()

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    limit = mockLimit
    static slidingWindow(tokens: number, window: string) {
      return { tokens, window }
    }
  }
  return { Ratelimit }
})

const mockGetRedis = vi.fn()
vi.mock("@/lib/stats", () => ({ getRedis: mockGetRedis }))

const mockCaptureMessage = vi.fn()
vi.mock("@sentry/nextjs", () => ({ captureMessage: mockCaptureMessage }))

// The module computes its Ratelimit instances once at import time from
// getRedis()'s return value, so each scenario needs a fresh import after
// setting the mock — reusing one import across "Redis configured" vs.
// "unconfigured" cases would test stale state.
async function loadModule() {
  vi.resetModules()
  return import("@/lib/search-rate-limit")
}

describe("search-rate-limit — Redis unconfigured (getRedis() → null)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRedis.mockReturnValue(null)
  })

  it("isRateLimited fails OPEN when Redis is unavailable", async () => {
    const { isRateLimited } = await loadModule()
    expect(await isRateLimited("1.2.3.4")).toBe(false)
  })

  it("isGooglePlacesRateLimited fails CLOSED when Redis is unavailable and Google was requested", async () => {
    const { isGooglePlacesRateLimited } = await loadModule()
    expect(await isGooglePlacesRateLimited("1.2.3.4", true)).toBe(true)
  })

  it("reports the no-Redis case to GlitchTip at info level", async () => {
    const { isGooglePlacesRateLimited } = await loadModule()
    await isGooglePlacesRateLimited("1.2.3.4", true)
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("no Redis"),
      expect.objectContaining({ level: "info", tags: expect.objectContaining({ scope: "google-no-redis", ip: "1.2.3.4" }) }),
    )
  })

  it("isGooglePlacesRateLimited returns false immediately when Google wasn't requested, even with no Redis", async () => {
    const { isGooglePlacesRateLimited } = await loadModule()
    expect(await isGooglePlacesRateLimited("1.2.3.4", false)).toBe(false)
  })
})

describe("search-rate-limit — Redis configured", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRedis.mockReturnValue({}) // truthy stand-in Redis client
  })

  it("isRateLimited allows when the limiter reports success", async () => {
    mockLimit.mockResolvedValue({ success: true })
    const { isRateLimited } = await loadModule()
    expect(await isRateLimited("1.2.3.4")).toBe(false)
  })

  it("isRateLimited blocks when the limiter reports failure", async () => {
    mockLimit.mockResolvedValue({ success: false })
    const { isRateLimited } = await loadModule()
    expect(await isRateLimited("1.2.3.4")).toBe(true)
  })

  it("isRateLimited fails OPEN on a transient Redis error", async () => {
    mockLimit.mockRejectedValue(new Error("upstash unreachable"))
    const { isRateLimited } = await loadModule()
    expect(await isRateLimited("1.2.3.4")).toBe(false)
  })

  it("isGooglePlacesRateLimited allows when the per-IP, hourly and daily checks all pass", async () => {
    mockLimit.mockResolvedValue({ success: true })
    const { isGooglePlacesRateLimited } = await loadModule()
    expect(await isGooglePlacesRateLimited("1.2.3.4", true)).toBe(false)
    expect(mockLimit).toHaveBeenCalledTimes(3)
  })

  it("blocks on the per-IP limit without touching either global counter, and reports it", async () => {
    mockLimit.mockResolvedValueOnce({ success: false }) // per-IP fails
    const { isGooglePlacesRateLimited } = await loadModule()
    expect(await isGooglePlacesRateLimited("1.2.3.4", true)).toBe(true)
    expect(mockLimit).toHaveBeenCalledTimes(1)
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("google-ip"),
      expect.objectContaining({ level: "warning", tags: expect.objectContaining({ scope: "google-ip", ip: "1.2.3.4" }) }),
    )
  })

  it("blocks on the global hourly cap without consuming a daily-counter slot, and reports it", async () => {
    mockLimit
      .mockResolvedValueOnce({ success: true })  // per-IP ok
      .mockResolvedValueOnce({ success: false }) // hourly fails
    const { isGooglePlacesRateLimited } = await loadModule()
    expect(await isGooglePlacesRateLimited("1.2.3.4", true)).toBe(true)
    expect(mockLimit).toHaveBeenCalledTimes(2)
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("google-global-hourly"),
      expect.objectContaining({ level: "warning", tags: expect.objectContaining({ scope: "google-global-hourly" }) }),
    )
  })

  it("blocks on the global daily cap, and reports it", async () => {
    mockLimit
      .mockResolvedValueOnce({ success: true })  // per-IP ok
      .mockResolvedValueOnce({ success: true })  // hourly ok
      .mockResolvedValueOnce({ success: false }) // daily fails
    const { isGooglePlacesRateLimited } = await loadModule()
    expect(await isGooglePlacesRateLimited("1.2.3.4", true)).toBe(true)
    expect(mockLimit).toHaveBeenCalledTimes(3)
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("google-global-daily"),
      expect.objectContaining({ level: "warning", tags: expect.objectContaining({ scope: "google-global-daily" }) }),
    )
  })

  it("isGooglePlacesRateLimited fails CLOSED on a transient Redis error, without reporting to GlitchTip", async () => {
    mockLimit.mockRejectedValue(new Error("upstash unreachable"))
    const { isGooglePlacesRateLimited } = await loadModule()
    expect(await isGooglePlacesRateLimited("1.2.3.4", true)).toBe(true)
    expect(mockCaptureMessage).not.toHaveBeenCalled()
  })

  it("does not report anything to GlitchTip when all checks pass", async () => {
    mockLimit.mockResolvedValue({ success: true })
    const { isGooglePlacesRateLimited } = await loadModule()
    expect(await isGooglePlacesRateLimited("1.2.3.4", true)).toBe(false)
    expect(mockCaptureMessage).not.toHaveBeenCalled()
  })

  it("isGooglePlacesRateLimited returns false immediately when not requested, without calling limit at all", async () => {
    const { isGooglePlacesRateLimited } = await loadModule()
    expect(await isGooglePlacesRateLimited("1.2.3.4", false)).toBe(false)
    expect(mockLimit).not.toHaveBeenCalled()
  })
})
