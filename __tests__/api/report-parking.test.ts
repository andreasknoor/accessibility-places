// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/report-parking/route"

// This endpoint is unauthenticated and publishes to a PUBLIC repository under
// the token owner's own GitHub identity, so everything that reaches the issue
// body is attacker-controlled content published as us. These tests pin the
// neutralisation of that content — see the comments in the route.

function makeReq(body: unknown, ip = "203.0.113.1"): NextRequest {
  return new NextRequest("http://localhost/api/report-parking", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body:    JSON.stringify(body),
  })
}

// Captures the outgoing GitHub API call so we can assert on the issue body.
function stubGitHub() {
  const spy = vi.fn().mockResolvedValue({
    ok:   true,
    json: async () => ({ number: 1 }),
  })
  vi.stubGlobal("fetch", spy)
  return spy
}

function issuePayload(spy: ReturnType<typeof stubGitHub>): { title: string; body: string } {
  return JSON.parse(spy.mock.calls[0][1].body as string)
}

const VALID = { lat: 52.52, lon: 13.405 }

describe("POST /api/report-parking", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    process.env.GITHUB_REPORT_TOKEN = "test-token"
  })

  it("rejects coordinates outside the valid range", async () => {
    const res = await POST(makeReq({ lat: 999, lon: 13.405 }, "203.0.113.10"))
    expect(res.status).toBe(400)
  })

  it("rejects a non-numeric coordinate", async () => {
    const res = await POST(makeReq({ lat: "52.52", lon: 13.405 }, "203.0.113.11"))
    expect(res.status).toBe(400)
  })

  // F2: nearestPlaceName is arbitrary client input rendered as GitHub
  // Markdown. Wrapping it in an inline code span stops @mentions from
  // notifying real accounts, #123 from cross-linking, and images/HTML from
  // rendering — all of which would appear to originate from the token owner.
  it("neutralises Markdown in nearestPlaceName by wrapping it in a code span", async () => {
    const spy = stubGitHub()
    await POST(makeReq(
      { ...VALID, nearestPlaceName: "@octocat #1 <img src=x> [l](http://e.tld)" },
      "203.0.113.12",
    ))
    const { body } = issuePayload(spy)
    const line = body.split("\n").find((l) => l.startsWith("**Nächste Venue:**"))!
    // The whole value sits inside a single inline code span.
    expect(line).toContain("`@octocat #1 <img src=x> [l](http://e.tld)`")
    // And no bare mention survives outside one.
    expect(line.replace(/`[^`]*`/g, "")).not.toContain("@octocat")
  })

  it("strips backticks and newlines so the code span cannot be broken out of", async () => {
    const spy = stubGitHub()
    await POST(makeReq(
      { ...VALID, nearestPlaceName: "a`b\n\n@everyone" },
      "203.0.113.13",
    ))
    const { body } = issuePayload(spy)
    const line = body.split("\n").find((l) => l.startsWith("**Nächste Venue:**"))!
    expect(line).toBe("**Nächste Venue:** `a b @everyone`")
  })

  it("caps the length of nearestPlaceName", async () => {
    const spy = stubGitHub()
    await POST(makeReq({ ...VALID, nearestPlaceName: "x".repeat(5000) }, "203.0.113.14"))
    const { body } = issuePayload(spy)
    expect(body.length).toBeLessThan(1000)
  })

  // F2: osmId is interpolated straight into two openstreetmap.org links.
  // Anything that is not a well-formed OSM object id is dropped, so the route
  // falls back to the coordinate-based URL instead of emitting a crafted link.
  it("drops a malformed osmId instead of putting it in a link", async () => {
    const spy = stubGitHub()
    await POST(makeReq(
      { ...VALID, osmId: "../../evil?x=1" },
      "203.0.113.15",
    ))
    const { body } = issuePayload(spy)
    expect(body).not.toContain("evil")
    expect(body).toContain("**OSM-Karte:**")   // coordinate fallback, not object link
  })

  it("accepts a well-formed osmId", async () => {
    const spy = stubGitHub()
    await POST(makeReq({ ...VALID, osmId: "node/12345" }, "203.0.113.16"))
    const { body } = issuePayload(spy)
    expect(body).toContain("https://www.openstreetmap.org/node/12345")
    expect(body).toContain("https://www.openstreetmap.org/edit?node=12345")
  })

  // F3: without Redis the limiter degrades to the in-memory bucket rather
  // than failing open — a bounded fallback is the point, since this path has
  // an external side effect. Same IP, more than the per-minute allowance.
  it("rate-limits repeated reports from the same IP", async () => {
    stubGitHub()
    const ip = "203.0.113.99"
    const codes: number[] = []
    for (let i = 0; i < 8; i++) {
      codes.push((await POST(makeReq(VALID, ip))).status)
    }
    expect(codes).toContain(429)
  })
})
