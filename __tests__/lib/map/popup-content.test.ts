import { describe, it, expect } from "vitest"
import { buildVenuePopupHtml, buildParkingPopupHtml, buildToiletPopupHtml } from "@/lib/map/popup-content"
import { buildAttribute, emptyAttribute } from "@/lib/matching/merge"
import de from "@/lib/i18n/de"
import en from "@/lib/i18n/en"
import type { PlaceJudgment } from "@/lib/reliability"
import type { Place, AmenityFeature } from "@/lib/types"

// Unified place UI (docs/plans/unified-results-detail-popup-redesign.md,
// phase 3): single-state popups with the same verdict wording, criterion
// glyphs and default-action rules as the result cards and detail view.

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "Café Test",
    category: "cafe",
    address: { street: "Hauptstraße", houseNumber: "5", postalCode: "", city: "Berlin", country: "DE" },
    coordinates: { lat: 52.52, lon: 13.405 },
    accessibility: {
      entrance: buildAttribute("osm", "yes", "yes", {}),
      toilet:   emptyAttribute(),
      parking:  emptyAttribute(),
    },
    overallConfidence: 0.75,
    primarySource: "osm",
    sourceRecords: [],
    ...overrides,
  }
}

function makeJudgment(overrides: Partial<PlaceJudgment>): PlaceJudgment {
  return { status: "pass", limited: [], unknown: [], failed: [], verifiedFailed: false, ...overrides }
}

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html")
}

// The single filled-blue button of a popup (its default action).
function primaryButtons(html: string): HTMLButtonElement[] {
  return [...doc(html).querySelectorAll("button")].filter((b) => /background:#2563eb/.test(b.getAttribute("style") ?? ""))
}

describe("buildVenuePopupHtml — header", () => {
  it("tints the header tile like the pin: green pass, amber caveat, neutral otherwise", () => {
    expect(buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: makeJudgment({ status: "pass" }) })).toContain("#dcfce7")
    expect(buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: makeJudgment({ status: "pass_limited", limited: ["toilet"] }) })).toContain("#fef3c7")
    for (const status of ["unverified", "fail", "none"] as const) {
      const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: makeJudgment({ status }) })
      expect(html).toContain("#f1f5f9")
    }
  })

  it("escapes OSM-sourced names (XSS rule)", () => {
    const html = buildVenuePopupHtml(makePlace({ name: `<img src=x onerror=alert(1)>` }), de, { showResults: false, judgment: makeJudgment({}) })
    expect(html).not.toContain("<img src=x")
    expect(html).toContain("&lt;img")
  })

  it("does not cut long names — they are clamped to two lines by CSS", () => {
    const name = "Hausarztpraxis Dr. med. Weber und Kollegen"
    const html = buildVenuePopupHtml(makePlace({ name }), de, { showResults: false, judgment: makeJudgment({}) })
    expect(html).toContain(name)
    expect(html).toContain("-webkit-line-clamp:2")
  })

  it("shows the category but no address", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: makeJudgment({}) })
    expect(html).toContain("Café &amp; Eis")
    expect(html).not.toContain("Hauptstraße")
  })

  it("has no more/less toggle any more", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: makeJudgment({}) })
    expect(html).not.toContain("data-toggle")
    expect(html).not.toContain("Mehr")
  })
})

describe("buildVenuePopupHtml — verdict wording per mode", () => {
  it("Expert: 'Erfüllt deine N Kriterien' with the caveat note", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, mode: "expert", activeCount: 2, judgment: makeJudgment({ status: "pass_limited", limited: ["toilet"] }) })
    expect(html).toContain("Erfüllt deine 2 Kriterien")
    expect(html).toContain("Mit Einschränkung: Toilette.")
    expect(html).not.toContain("Passt mit Vorbehalt")
  })

  it("Expert: 'Nicht gesichert' naming the missing criterion", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, mode: "expert", activeCount: 2, judgment: makeJudgment({ status: "unverified", unknown: ["toilet"] }) })
    expect(html).toContain("Nicht gesichert")
    expect(html).toContain("Zu Toilette liegen keine Angaben vor.")
  })

  it("Expert: fail names what blocks the place", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, mode: "expert", activeCount: 1, judgment: makeJudgment({ status: "fail", failed: ["entrance"] }) })
    expect(html).toContain("Erfüllt dein Kriterium nicht")
    expect(html).toContain("Betrifft: Eingang.")
  })

  it("Expert: neutral text when no criteria are active", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, mode: "expert", activeCount: 0, judgment: makeJudgment({ status: "none" }) })
    expect(html).toContain(de.results.judgmentNone)
  })

  it("Quickstart: the fixed Quickstart headline", () => {
    expect(buildVenuePopupHtml(makePlace(), de, { showResults: false, mode: "quickstart", judgment: makeJudgment({ status: "pass" }) })).toContain("Barrierefrei nutzbar")
    expect(buildVenuePopupHtml(makePlace(), en, { showResults: false, mode: "quickstart", judgment: makeJudgment({ status: "fail" }) })).toContain("Not accessible")
  })
})

describe("buildVenuePopupHtml — criteria and actions", () => {
  it("names the three criteria (glyph + name), with the restroom pictogram instead of the text 'WC' symbol", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: makeJudgment({}) })
    const text = doc(html).body.textContent ?? ""
    expect(text).toContain("Eingang")
    expect(text).toContain("Toilette")
    expect(text).toContain("Parkplatz")
    expect(text).not.toContain("WC")
  })

  it("'Details' is the default (blue) action; Route is secondary and marked as leaving the app", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: true, judgment: makeJudgment({}) })
    const primary = primaryButtons(html)
    expect(primary).toHaveLength(1)
    expect(primary[0].textContent).toContain("Details")
    const route = doc(html).querySelector("[data-navigate]")!
    expect(route.getAttribute("aria-label")).toBe("Route (öffnet eine andere App)")
    expect(route.querySelectorAll("svg")).toHaveLength(2) // compass + ↗
  })

  it("lets both the header and the Details button open the details", () => {
    const html = buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: makeJudgment({}) })
    expect(doc(html).querySelectorAll("[data-show-details]")).toHaveLength(2)
  })

  it("adds the show-in-list icon button only when requested", () => {
    expect(buildVenuePopupHtml(makePlace(), de, { showResults: true, judgment: makeJudgment({}) })).toContain("data-show-id")
    expect(buildVenuePopupHtml(makePlace(), de, { showResults: false, judgment: makeJudgment({}) })).not.toContain("data-show-id")
  })
})

describe("buildParkingPopupHtml", () => {
  const spot = (overrides: Partial<AmenityFeature> = {}): AmenityFeature =>
    ({ amenityType: "parking", lat: 52.52, lon: 13.405, tier: "strong", ...overrides })

  it("makes Route the default action (deliberate exception: no detail view)", () => {
    const primary = primaryButtons(buildParkingPopupHtml(spot(), de, { showResults: false }))
    expect(primary).toHaveLength(1)
    expect(primary[0].hasAttribute("data-navigate")).toBe(true)
  })

  it("states the tier and where it is relative to the nearest place", () => {
    const html = buildParkingPopupHtml(spot({ capacity: 3, fee: "no" }), de, { showResults: false, nearestName: "Café Kranzler", nearestDistM: 80 })
    expect(html).toContain(de.map.parkingSpots(3))
    expect(html).toContain(de.map.parkingReservedLabel)
    expect(html).toContain(de.map.parkingFree)
    expect(html).toContain("80 m · bei Café Kranzler")
  })

  it("offers the report link, with its explicit wording, only for the weak tier", () => {
    expect(buildParkingPopupHtml(spot({ tier: "weak" }), de, { showResults: false })).toContain(de.map.parkingReportButton)
    expect(buildParkingPopupHtml(spot(), de, { showResults: false })).not.toContain("data-report")
  })

  it("escapes an OSM fee value and the nearest place's name", () => {
    const html = buildParkingPopupHtml(spot({ fee: "<b>x</b>" }), de, { showResults: false, nearestName: "<script>" })
    expect(html).not.toContain("<b>x</b>")
    expect(html).not.toContain("<script>")
  })
})

describe("buildToiletPopupHtml", () => {
  function makeSpot(overrides: Partial<AmenityFeature> = {}): AmenityFeature {
    return { amenityType: "toilet", lat: 52.52, lon: 13.405, tier: "strong", ...overrides }
  }
  const REF_NOW = new Date("2026-08-17T10:00:00")

  it("makes Route the default action (deliberate exception) and keeps Wheelmap secondary", () => {
    const html = buildToiletPopupHtml(makeSpot(), de, { showResults: false, locale: "de", wheelmapUrl: "https://wheelmap.org/nodes/1" })
    const primary = primaryButtons(html)
    expect(primary).toHaveLength(1)
    expect(primary[0].hasAttribute("data-navigate")).toBe(true)
    expect(html).toContain("data-wheelmap")
  })

  it("renders nothing extra when no status is supplied (passive layer / not a WC search)", () => {
    const html = buildToiletPopupHtml(makeSpot(), de, { showResults: false, locale: "de" })
    expect(html).not.toContain(de.results.openNow)
  })

  it("shows 'Geöffnet' for an open status", () => {
    const html = buildToiletPopupHtml(makeSpot(), de, { showResults: false, locale: "de", openingStatus: { state: "open", refNow: REF_NOW } })
    expect(html).toContain(de.results.openNow)
  })

  it("shows the closing-soon countdown", () => {
    const closesAt = new Date(REF_NOW.getTime() + 12 * 60_000)
    const html = buildToiletPopupHtml(makeSpot(), de, { showResults: false, locale: "de", openingStatus: { state: "closing_soon", closesAt, refNow: REF_NOW } })
    expect(html).toContain(de.results.openClosingSoon(12))
  })

  it("shows the closed label with the next opening time", () => {
    const opensAt = new Date("2026-08-18T09:00:00")
    const html = buildToiletPopupHtml(makeSpot(), de, { showResults: false, locale: "de", openingStatus: { state: "closed", opensAt, refNow: REF_NOW } })
    expect(html).toContain("morgen 09:00")
  })

  it("falls back to the plain closed label when no next-change time is known", () => {
    const html = buildToiletPopupHtml(makeSpot(), de, { showResults: false, locale: "de", openingStatus: { state: "closed", refNow: REF_NOW } })
    expect(html).toContain(de.results.openClosedPlain)
  })

  it("lists euro key and changing table as feature chips, with the designation", () => {
    const html = buildToiletPopupHtml(makeSpot({ euroKey: true, changingTable: true }), de, { showResults: false, locale: "de" })
    expect(html).toContain(de.map.toiletEuroKey)
    expect(html).toContain(de.map.toiletChangingTable)
    expect(html).toContain(de.map.toiletDesignatedValue)
  })

  it("names and escapes the hosting venue", () => {
    const html = buildToiletPopupHtml(makeSpot({ host: { kind: "venue", name: "<i>Bar</i>" } as AmenityFeature["host"] }), de, { showResults: false, locale: "de" })
    expect(html).toContain("&lt;i&gt;Bar&lt;/i&gt;")
  })
})
