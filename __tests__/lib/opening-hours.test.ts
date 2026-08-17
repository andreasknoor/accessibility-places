// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  extractRawOpeningHours,
  extractParsableOpeningHours,
  computeOpeningStatus,
  timeZoneForPlace,
  wallClockAt,
} from "@/lib/opening-hours"
import type { Place, SourceRecord } from "@/lib/types"
import { emptyAttribute } from "@/lib/matching/merge"

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    sourceId:   "osm",
    externalId: "node/1",
    fetchedAt:  new Date().toISOString(),
    ...overrides,
  }
}

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "Test Place",
    category: "restaurant",
    address: { street: "Hauptstr.", houseNumber: "1", postalCode: "10115", city: "Berlin", country: "DE" },
    coordinates: { lat: 52.52, lon: 13.405 },
    accessibility: {
      entrance: emptyAttribute(),
      toilet:   emptyAttribute(),
      parking:  emptyAttribute(),
    },
    overallConfidence: 0,
    primarySource: "osm",
    sourceRecords: [],
    ...overrides,
  }
}

function osmPlace(openingHours: string, overrides: Partial<Place> = {}): Place {
  return makePlace({ sourceRecords: [makeRecord({ metadata: { opening_hours: openingHours } })], ...overrides })
}

const GOOGLE_PROSE = ["Monday: 9:00 AM – 6:00 PM", "Tuesday: 9:00 AM – 6:00 PM", "Sunday: Closed"]

describe("extractRawOpeningHours (display)", () => {
  it("reads the OSM opening_hours tag", () => {
    expect(extractRawOpeningHours(osmPlace("Mo-Fr 09:00-18:00"))).toBe("Mo-Fr 09:00-18:00")
  })

  it("falls back to Google's weekday descriptions for display", () => {
    const place = makePlace({
      sourceRecords: [makeRecord({ sourceId: "google_places", metadata: { regularOpeningHours: { weekdayDescriptions: GOOGLE_PROSE } } })],
    })
    expect(extractRawOpeningHours(place)).toBe(GOOGLE_PROSE.join("\n"))
  })

  it("returns null when neither source has hours", () => {
    expect(extractRawOpeningHours(makePlace({ sourceRecords: [makeRecord({ metadata: { name: "x" } })] }))).toBeNull()
  })

  it("treats OSM's literal 'unknown' as absent", () => {
    expect(extractRawOpeningHours(osmPlace("unknown"))).toBeNull()
  })
})

describe("extractParsableOpeningHours (status)", () => {
  it("reads OSM syntax", () => {
    expect(extractParsableOpeningHours(osmPlace("Mo-Fr 09:00-18:00"))).toBe("Mo-Fr 09:00-18:00")
  })

  // Regression: Google's prose is NOT opening_hours syntax, but the library
  // parses it leniently and then answers confidently wrong (measured: a place
  // open Mo 09:00-18:00 reported CLOSED at Mo 10:00). It must never reach the
  // parser — showing nothing is correct, showing "Geschlossen" is not.
  it("never returns Google's prose descriptions", () => {
    const place = makePlace({
      sourceRecords: [makeRecord({ sourceId: "google_places", metadata: { regularOpeningHours: { weekdayDescriptions: GOOGLE_PROSE } } })],
    })
    expect(extractParsableOpeningHours(place)).toBeNull()
  })

  it("a Google-only place therefore yields no status at all", async () => {
    const place = makePlace({
      sourceRecords: [makeRecord({ sourceId: "google_places", metadata: { regularOpeningHours: { weekdayDescriptions: GOOGLE_PROSE } } })],
    })
    const hours = extractParsableOpeningHours(place)
    expect(hours).toBeNull()
    // and even if the prose were forced through, it must not claim "closed"
    // on a day/time its own text says is open — guarded by the extractor above.
    const forced = await computeOpeningStatus(GOOGLE_PROSE.join("\n"), place, new Date("2026-08-17T10:00:00+02:00"))
    expect(forced?.state).not.toBe("open") // documents the library's lenient misparse
  })
})

describe("timeZoneForPlace", () => {
  it("maps an explicit country code", () => {
    expect(timeZoneForPlace(makePlace({ address: { ...makePlace().address, country: "AT" } }))).toBe("Europe/Vienna")
  })

  it("falls back to coordinates when addr:country is missing (common in OSM)", () => {
    const p = makePlace({ address: { ...makePlace().address, country: undefined }, coordinates: { lat: 52.52, lon: 13.405 } })
    expect(timeZoneForPlace(p)).toBe("Europe/Berlin")
  })

  it("splits the US by longitude", () => {
    const ny = makePlace({ address: { ...makePlace().address, country: "US" }, coordinates: { lat: 40.71, lon: -74.0 } })
    const la = makePlace({ address: { ...makePlace().address, country: "US" }, coordinates: { lat: 34.05, lon: -118.24 } })
    expect(timeZoneForPlace(ny)).toBe("America/New_York")
    expect(timeZoneForPlace(la)).toBe("America/Los_Angeles")
  })

  it("returns null outside every supported region, so no status is guessed", () => {
    const tokyo = makePlace({ address: { ...makePlace().address, country: undefined }, coordinates: { lat: 35.68, lon: 139.69 } })
    expect(timeZoneForPlace(tokyo)).toBeNull()
  })
})

describe("wallClockAt", () => {
  it("shifts an instant into the target zone's wall clock", () => {
    // 22:00 in Berlin is 16:00 in New York on this date.
    const instant = new Date("2026-08-17T22:00:00+02:00")
    const ny = wallClockAt(instant, "America/New_York")
    expect(ny.getHours()).toBe(16)
  })
})

describe("computeOpeningStatus", () => {
  it("returns null for an empty string", async () => {
    expect(await computeOpeningStatus("   ", makePlace())).toBeNull()
  })

  it("reports open inside an active window", async () => {
    const status = await computeOpeningStatus("Mo-Fr 09:00-18:00", makePlace(), new Date("2026-08-17T10:00:00+02:00"))
    expect(status?.state).toBe("open")
  })

  it("reports closing_soon within 30 minutes of closing", async () => {
    const status = await computeOpeningStatus("Mo-Fr 09:00-18:00", makePlace(), new Date("2026-08-17T17:45:00+02:00"))
    expect(status?.state).toBe("closing_soon")
  })

  it("reports closed outside the window, with the next opening time", async () => {
    const status = await computeOpeningStatus("Mo-Fr 09:00-18:00", makePlace(), new Date("2026-08-17T20:00:00+02:00"))
    expect(status?.state).toBe("closed")
    if (status?.state === "closed") expect(status.opensAt?.getHours()).toBe(9)
  })

  // The exact value from the user-reported place (OSM way/265501835,
  // "Karls Erlebnis-Dorf Elstal"): a bare time range = every day.
  it("handles a weekday-less daily range (OSM way/265501835)", async () => {
    const open  = await computeOpeningStatus("08:00-19:00", makePlace(), new Date("2026-08-17T10:00:00+02:00"))
    const shut  = await computeOpeningStatus("08:00-19:00", makePlace(), new Date("2026-08-17T20:00:00+02:00"))
    expect(open?.state).toBe("open")
    expect(shut?.state).toBe("closed")
  })

  it("returns null for hard syntax errors rather than guessing", async () => {
    expect(await computeOpeningStatus("this is not syntax at all §§§", makePlace())).toBeNull()
  })

  it("returns null when the library flags the rule as ambiguous (getUnknown)", async () => {
    const status = await computeOpeningStatus("Mo-Fr 09:00-18:00 unknown", makePlace(), new Date("2026-08-17T10:00:00+02:00"))
    expect(status).toBeNull()
  })

  it("returns null when the time zone can't be determined, instead of using the viewer's", async () => {
    const tokyo = makePlace({ address: { ...makePlace().address, country: undefined }, coordinates: { lat: 35.68, lon: 139.69 } })
    expect(await computeOpeningStatus("Mo-Fr 09:00-18:00", tokyo, new Date("2026-08-17T10:00:00+02:00"))).toBeNull()
  })

  // Regression for the timezone bug: evaluated in the VENUE's zone, not the
  // viewer's. A New York venue open 09:00-17:00 is open at 16:00 New York
  // time, which is 22:00 in Berlin — the old code reported it closed.
  it("evaluates in the venue's time zone, not the device's", async () => {
    const ny = makePlace({ address: { ...makePlace().address, country: "US" }, coordinates: { lat: 40.71, lon: -74.0 } })
    const status = await computeOpeningStatus("Mo-Fr 09:00-17:00", ny, new Date("2026-08-17T22:00:00+02:00"))
    expect(status?.state).toBe("open")
  })

  // Regression: getNextChange() on this value walks forward computing Easter
  // dates and blocks the main thread for ~70s before throwing, unless the
  // search is bounded by maxdate. Vitest's default 5s timeout is the assertion.
  it("does not hang on a PH-only rule (measured ~70s without the maxdate bound)", async () => {
    const status = await computeOpeningStatus("PH off", makePlace(), new Date("2026-08-17T10:00:00+02:00"))
    expect(status?.state).toBe("closed")
  })

  it("treats 24/7 as open with no closing time", async () => {
    const status = await computeOpeningStatus("24/7", makePlace(), new Date("2026-08-17T03:00:00+02:00"))
    expect(status?.state).toBe("open")
    if (status?.state === "open") expect(status.closesAt).toBeUndefined()
  })
})
