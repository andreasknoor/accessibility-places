// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/stats", () => ({
  trackCall:     vi.fn(),
  trackError:    vi.fn(),
  trackDuration: vi.fn(),
  getRedis:      vi.fn(() => null),
}))
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }))

import { trackCall, trackDuration, trackError } from "@/lib/stats"
import * as Sentry from "@sentry/nextjs"
import { recordPhotonFailure, recordPhotonSuccess, resetPhotonMonitorForTests } from "@/lib/photon-monitor"
import { GET as suggestGET } from "@/app/api/geocode/unified-suggest/route"
import { photonSearch } from "@/lib/public-api/photon"

let ip = 0
const suggestReq = (q: string) =>
  new NextRequest(`http://localhost/api/geocode/unified-suggest?q=${encodeURIComponent(q)}`, {
    headers: { "x-forwarded-for": `10.9.0.${++ip}` },
  })

beforeEach(() => {
  vi.clearAllMocks()
  resetPhotonMonitorForTests()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => vi.unstubAllGlobals())

describe("recordPhoton*", () => {
  it("success counts a call and its latency, no error", () => {
    recordPhotonSuccess(120)
    expect(trackCall).toHaveBeenCalledWith("photon")
    expect(trackDuration).toHaveBeenCalledWith("photon", 120)
    expect(trackError).not.toHaveBeenCalled()
    expect(Sentry.captureMessage).not.toHaveBeenCalled()
  })

  it("failure counts call + error and reports to GlitchTip", () => {
    recordPhotonFailure("suggest", "HTTP 502", 40)
    expect(trackCall).toHaveBeenCalledWith("photon")
    expect(trackError).toHaveBeenCalledWith("photon")
    expect(Sentry.captureMessage).toHaveBeenCalledWith("Photon geocoder failed: HTTP 502", expect.objectContaining({
      level: "warning",
      tags:  { area: "photon", caller: "suggest" },
    }))
  })

  it("throttles GlitchTip reports but still counts every error", () => {
    recordPhotonFailure("suggest", "timeout", 3000)
    recordPhotonFailure("suggest", "timeout", 3000)
    recordPhotonFailure("health", "timeout", 3000)
    expect(trackError).toHaveBeenCalledTimes(3)
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1)
  })
})

describe("call sites", () => {
  it("unified-suggest records a Photon outage but still answers 200 with []", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad gateway", { status: 502 })))
    const res = await suggestGET(suggestReq("Berlin"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
    expect(trackError).toHaveBeenCalledWith("photon") // both parallel Photon calls failed
    expect(vi.mocked(trackError).mock.calls.length).toBe(2)
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1)
  })

  it("unified-suggest records success and lets the CDN cache the answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ features: [] }), { status: 200, headers: { "Content-Type": "application/json" } })))
    const res = await suggestGET(suggestReq("Berlin"))
    expect(vi.mocked(trackCall).mock.calls.filter(([s]) => s === "photon")).toHaveLength(2)
    expect(trackError).not.toHaveBeenCalled()
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=86400, stale-while-revalidate=604800")
  })

  it("unified-suggest never caches an answer with a failed Photon call", async () => {
    let n = 0
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => (++n === 1
      ? new Response(JSON.stringify({ features: [] }), { status: 200, headers: { "Content-Type": "application/json" } })
      : new Response("timeout", { status: 504 }))))
    const res = await suggestGET(suggestReq("Berlin"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  it("public API photonSearch records the failure and still throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))
    await expect(photonSearch("Philharmonie Berlin")).rejects.toThrow("Photon failed: network down")
    expect(trackError).toHaveBeenCalledWith("photon")
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "Photon geocoder failed: network down",
      expect.objectContaining({ tags: { area: "photon", caller: "public-api" } }),
    )
  })
})
