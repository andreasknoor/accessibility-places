// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const { trackUserOpenMock } = vi.hoisted(() => ({
  trackUserOpenMock: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/user-stats", () => ({ trackUserOpen: trackUserOpenMock }))

import { POST } from "@/app/api/ping/route"

const UID = "01234567-89ab-4cde-8f01-23456789abcd"

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/ping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

describe("POST /api/ping", () => {
  beforeEach(() => vi.clearAllMocks())

  it("awaits trackUserOpen with the body fields and returns 204", async () => {
    const res = await POST(makeReq({ userId: UID, platform: "android" }))
    expect(res.status).toBe(204)
    expect(trackUserOpenMock).toHaveBeenCalledWith(UID, "android")
  })

  it("returns 204 for malformed JSON without calling into the tracker with data", async () => {
    const res = await POST(makeReq("{not json"))
    expect(res.status).toBe(204)
    // trackUserOpen still runs (its own validation drops undefined input)
    expect(trackUserOpenMock).toHaveBeenCalledWith(undefined, undefined)
  })

  it("returns 204 for a non-object body", async () => {
    const res = await POST(makeReq(42))
    expect(res.status).toBe(204)
    expect(trackUserOpenMock).toHaveBeenCalledWith(undefined, undefined)
  })
})
