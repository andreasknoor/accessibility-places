// @vitest-environment node
import { describe, it, expect } from "vitest"
import type { ErrorEvent } from "@sentry/nextjs"
import { REDACTED, scrubBreadcrumb, scrubEvent, scrubQuery } from "@/lib/sentry-scrub"

describe("scrubQuery", () => {
  it("redacts the accessibility.cloud appToken but keeps other params", () => {
    expect(scrubQuery("?appToken=633d2f77b80c&latitude=52.52&radius=2000"))
      .toBe(`?appToken=${REDACTED}&latitude=52.52&radius=2000`)
  })
  it("redacts tokens in full URLs and bare query strings", () => {
    expect(scrubQuery("https://accessible-places.org/api/health?token=s3cret&photon=1"))
      .toBe(`https://accessible-places.org/api/health?token=${REDACTED}&photon=1`)
    expect(scrubQuery("name=Philharmonie&token=abc")).toBe(`name=Philharmonie&token=${REDACTED}`)
  })
  it("covers common key names, case-insensitively", () => {
    for (const k of ["api_key", "apiKey", "KEY", "access_token", "secret", "password", "sig", "uid"]) {
      expect(scrubQuery(`?${k}=x&q=1`)).toBe(`?${k}=${REDACTED}&q=1`)
    }
  })
  it("leaves harmless URLs untouched", () => {
    const url = "https://photon.komoot.io/api/?q=Berlin&limit=1&lang=de&layer=city"
    expect(scrubQuery(url)).toBe(url)
  })
})

describe("scrubBreadcrumb / scrubEvent", () => {
  it("scrubs the fetch-breadcrumb shape GlitchTip showed", () => {
    const crumb = scrubBreadcrumb({
      category: "http",
      data: {
        url:           "https://accessibility-cloud-v2.freetls.fastly.net/place-infos.json",
        "http.query":  "?appToken=633d2f77&latitude=52.52",
        "http.method": "GET",
        status_code:   200,
      },
    })
    expect(crumb.data!["http.query"]).toBe(`?appToken=${REDACTED}&latitude=52.52`)
    expect(crumb.data!.status_code).toBe(200)
  })

  it("scrubs request URL, query string and attached breadcrumbs", () => {
    const event = scrubEvent({
      type: undefined,
      request: { url: "https://accessible-places.org/api/v1/places/lookup?name=X&token=t0k3n", query_string: "name=X&token=t0k3n" },
      breadcrumbs: [{ message: "GET /api/stats?token=abc" }],
    } as ErrorEvent)
    expect(event.request!.url).toBe(`https://accessible-places.org/api/v1/places/lookup?name=X&token=${REDACTED}`)
    expect(event.request!.query_string).toBe(`name=X&token=${REDACTED}`)
    expect(event.breadcrumbs![0].message).toBe(`GET /api/stats?token=${REDACTED}`)
  })

  it("handles object and tuple query_string forms", () => {
    const a = scrubEvent({ type: undefined, request: { query_string: { token: "x", q: "y" } } } as unknown as ErrorEvent)
    expect(a.request!.query_string).toEqual({ token: REDACTED, q: "y" })
    const b = scrubEvent({ type: undefined, request: { query_string: [["appToken", "x"], ["q", "y"]] } } as unknown as ErrorEvent)
    expect(b.request!.query_string).toEqual([["appToken", REDACTED], ["q", "y"]])
  })
})
