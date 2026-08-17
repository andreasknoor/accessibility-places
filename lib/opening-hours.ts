"use client"

import { useEffect, useState, useMemo, useSyncExternalStore } from "react"
import { DACH_BBOX, INTL_COUNTRIES } from "./config"
import { amenitySpotKey } from "./search-ui"
import type { Place, SourceId, AmenityFeature } from "./types"

// ─── Extraction ─────────────────────────────────────────────────────────────

function getMeta(place: Place, sourceId: SourceId): Record<string, unknown> | null {
  const rec = place.sourceRecords.find((r) => r.sourceId === sourceId)
  if (!rec) return null
  return (rec.metadata ?? rec.raw ?? null) as Record<string, unknown> | null
}

function str(v: unknown): string | null {
  if (v == null || v === "" || v === "unknown") return null
  return String(v)
}

/**
 * Human-readable hours for *display only* (PlaceDebugSheet's raw row).
 * May be OSM's `opening_hours` syntax OR Google's prose weekday list — the
 * two are not interchangeable, which is why status computation uses
 * extractParsableOpeningHours() instead. See its comment.
 */
export function extractRawOpeningHours(place: Place): string | null {
  const osm    = getMeta(place, "osm")
  const google = getMeta(place, "google_places")
  const googleHours = google?.regularOpeningHours as { weekdayDescriptions?: unknown } | undefined
  return (
    str(osm?.opening_hours) ??
    (Array.isArray(googleHours?.weekdayDescriptions)
      ? (googleHours.weekdayDescriptions as string[]).join("\n")
      : null)
  )
}

/**
 * Hours in real `opening_hours` syntax — the ONLY thing safe to evaluate.
 *
 * Deliberately OSM-only. Google Places returns prose ("Monday: 9:00 AM –
 * 6:00 PM"), which opening_hours.js parses *leniently* rather than
 * rejecting: it reports getUnknown()===false (i.e. "I am certain") and then
 * answers getState()===false. Measured: a place open Mo 09:00–18:00 was
 * reported CLOSED at Mo 10:00. Feeding prose to the parser therefore
 * produces confident wrong answers — strictly worse than showing nothing,
 * and with the open-now filter on it silently hid places that were open.
 */
export function extractParsableOpeningHours(place: Place): string | null {
  return str(getMeta(place, "osm")?.opening_hours)
}

/**
 * Same rule as extractParsableOpeningHours, for a WC point feature — no
 * Google-prose fallback exists here (amenity spots are OSM-only), so this
 * is just the guarded tag read. `toilets:opening_hours` was checked live
 * against Berlin OSM data (0 hits across 2062 tagged venue WCs) and is
 * deliberately not read — see the comment on AmenityFeature.openingHours.
 */
export function extractAmenityOpeningHours(spot: AmenityFeature): string | null {
  return str(spot.openingHours)
}

// ─── Time zone ──────────────────────────────────────────────────────────────

// opening_hours.js evaluates a Date through its *local* getters, so a naive
// `new Date()` answers "is it open where the USER is", not "where the PLACE
// is". Measured: a New York venue open 09:00–17:00 viewed from Berlin at
// 22:00 (= 16:00 in New York, open) was reported closed. International mode
// reaches US/GB/FR/NL/ES/IT, so this is not hypothetical.
//
// A full lat/lon→IANA lookup needs a multi-MB shapefile. The supported
// country list is short and (except the US) each maps to a single zone, so a
// table plus a longitude split for the US is both sufficient and honest.
const ZONE_BY_COUNTRY: Record<string, string> = {
  DE: "Europe/Berlin",  AT: "Europe/Vienna",    CH: "Europe/Zurich",
  FR: "Europe/Paris",   NL: "Europe/Amsterdam", ES: "Europe/Madrid",
  IT: "Europe/Rome",    GB: "Europe/London",
}

function usZoneForLongitude(lon: number): string {
  if (lon >= -87.5)  return "America/New_York"
  if (lon >= -102)   return "America/Chicago"
  if (lon >= -115)   return "America/Denver"
  return "America/Los_Angeles"
}

function bboxContains(bbox: readonly [number, number, number, number], lat: number, lon: number): boolean {
  const [minLon, minLat, maxLon, maxLat] = bbox
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat
}

/**
 * IANA zone for a coordinate (+ optional ISO-2 country for a direct hit), or
 * null when it can't be determined confidently. The coordinate fallback
 * reuses the same bboxes that already gate every other geo decision in
 * lib/config.ts — needed because `addr:country` is frequently absent on a
 * Place (documented on Place.address) and an AmenityFeature carries no
 * country at all, only lat/lon.
 */
export function timeZoneForCoords(lat: number, lon: number, countryCode?: string): string | null {
  const code = countryCode?.toUpperCase()
  if (code && ZONE_BY_COUNTRY[code]) return ZONE_BY_COUNTRY[code]
  if (code === "US") return usZoneForLongitude(lon)
  if (bboxContains(DACH_BBOX, lat, lon)) return "Europe/Berlin"
  const intl = INTL_COUNTRIES.find((c) => bboxContains(c.bbox, lat, lon))
  if (intl) return intl.code === "US" ? usZoneForLongitude(lon) : ZONE_BY_COUNTRY[intl.code] ?? null
  return null
}

/** Place-shaped convenience wrapper around timeZoneForCoords. */
export function timeZoneForPlace(place: Pick<Place, "address" | "coordinates">): string | null {
  return timeZoneForCoords(place.coordinates.lat, place.coordinates.lon, place.address.country)
}

/**
 * A Date whose *local* fields equal the wall-clock time at `timeZone`.
 * opening_hours.js reads local getters, so handing it this shifted Date makes
 * it evaluate in the venue's own time. Everything it hands back
 * (getNextChange) is in the same shifted space, so those Dates must likewise
 * be formatted as local time — which is exactly what OpeningStatusChip does.
 */
export function wallClockAt(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(now)
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  // hourCycle h23 can emit "24" for midnight in some ICU builds.
  const hour = num("hour") % 24
  return new Date(num("year"), num("month") - 1, num("day"), hour, num("minute"), num("second"))
}

// ─── Status computation ─────────────────────────────────────────────────────

export type OpeningStatus =
  | { state: "open";         closesAt?: Date; refNow: Date }
  | { state: "closing_soon"; closesAt: Date;  refNow: Date }
  | { state: "closed";       opensAt?: Date;  refNow: Date }

const CLOSING_SOON_MS = 30 * 60 * 1000

// Shared by every renderer of an OpeningStatus: the React chip
// (OpeningStatusChip.tsx) and the hand-built map-popup HTML
// (lib/map/popup-content.ts, which has no access to React/hooks). Both dates
// are in the venue's wall-clock space (see wallClockAt), so they are
// formatted as plain local time here, with no timeZone option — exactly the
// clock reading a person standing at the venue would see.
export function formatOpeningWhen(date: Date, refNow: Date, locale: "de" | "en"): string {
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date)
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOfDay(date) - startOfDay(refNow)) / 86_400_000)
  if (diffDays === 0) return locale === "de" ? `heute ${time}` : `today ${time}`
  if (diffDays === 1) return locale === "de" ? `morgen ${time}` : `tomorrow ${time}`
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date)
  return `${weekday} ${time}`
}

// Clamped at 1 rather than 0 so the label never reads "in 0 Min"; the caller's
// minute ticker re-evaluates the whole status, so this cannot get stuck
// counting down past the actual close (it flips to "closed" instead).
export function closingSoonMinutes(status: Extract<OpeningStatus, { state: "closing_soon" }>): number {
  return Math.max(1, Math.round((status.closesAt.getTime() - status.refNow.getTime()) / 60_000))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpeningHoursCtor = any

// Accepts either a Place-shaped pick (venues carry addr:country when OSM has
// it, worth using for PH resolution) or a bare coordinate (AmenityFeature —
// a parking/WC point never carries an address at all). Both normalise to the
// same {lat, lon, country?} the rest of this function operates on.
type StatusInput = Pick<Place, "address" | "coordinates"> | { lat: number; lon: number; country?: string }

function normalizeStatusInput(input: StatusInput): { lat: number; lon: number; country?: string } {
  if ("coordinates" in input) return { lat: input.coordinates.lat, lon: input.coordinates.lon, country: input.address.country }
  return input
}

/**
 * Synchronous core. Returns null whenever nothing concrete can be said —
 * unparseable syntax, or the library's own getUnknown(). Product decision
 * (issue #14): there is no visible "unknown" state; when we can't say
 * something definite the opening-hours UI is omitted entirely.
 */
export function computeStatusSync(
  OpeningHours: OpeningHoursCtor,
  hoursString: string,
  input: StatusInput,
  now: Date,
): OpeningStatus | null {
  const trimmed = hoursString.trim()
  if (!trimmed) return null
  try {
    const { lat, lon, country } = normalizeStatusInput(input)
    const zone = timeZoneForCoords(lat, lon, country)
    // No confident zone → evaluating in the viewer's zone would be a guess
    // that silently produces a wrong open/closed claim. Say nothing instead.
    if (!zone) return null
    const refNow = wallClockAt(now, zone)

    const code = country?.toLowerCase()
    const nominatim = code
      ? { lat, lon, address: { country_code: code, state: "" } }
      : null

    const oh = new OpeningHours(trimmed, nominatim)
    if (oh.getUnknown(refNow)) return null
    const isOpen = oh.getState(refNow)

    // maxdate is load-bearing, not an optimisation: measured, getNextChange()
    // on some rules (e.g. a bare "PH off" with no resolvable country) walks
    // forward computing Easter dates and only throws after ~70s of
    // synchronous, main-thread-blocking work. Nothing can rescue a hang
    // inside a synchronous call, so the search has to be bounded up front —
    // this turns it into a ~20ms no-op. A year is far beyond anything this
    // UI renders anyway.
    const maxdate = new Date(refNow.getTime() + 365 * 24 * 60 * 60 * 1000)
    const nextChange = oh.getNextChange(refNow, maxdate)

    if (isOpen) {
      if (nextChange && nextChange.getTime() - refNow.getTime() <= CLOSING_SOON_MS) {
        return { state: "closing_soon", closesAt: nextChange, refNow }
      }
      return { state: "open", closesAt: nextChange, refNow }
    }
    return { state: "closed", opensAt: nextChange, refNow }
  } catch {
    return null
  }
}

/** Async convenience wrapper — loads the library, then delegates. */
export async function computeOpeningStatus(
  hoursString: string,
  input: StatusInput,
  now: Date = new Date(),
): Promise<OpeningStatus | null> {
  if (!hoursString.trim()) return null
  const lib = await loadOpeningHoursLib()
  if (!lib) return null
  return computeStatusSync(lib, hoursString, input, now)
}

// ─── Library loading (one module-level singleton) ───────────────────────────

// ~144 KB gzipped (plus i18next), so it is dynamically imported and only
// requested when a place actually carries parseable hours. Cached at module
// level so N result cards share one load and one parse-capable instance.
let libValue: OpeningHoursCtor | null = null
let libPromise: Promise<OpeningHoursCtor | null> | null = null

export function loadOpeningHoursLib(): Promise<OpeningHoursCtor | null> {
  if (!libPromise) {
    libPromise = import("opening_hours")
      .then((m) => { libValue = m.default; return libValue })
      .catch(() => null)
  }
  return libPromise
}

function useOpeningHoursLib(shouldLoad: boolean): OpeningHoursCtor | null {
  // The stored value is a CONSTRUCTOR, i.e. a function — so both the initial
  // value and every update must be wrapped. React treats a bare function
  // passed to useState() as a lazy initialiser and one passed to the setter
  // as an updater, and would therefore *call* OpeningHours(prevState),
  // which throws "The value (first parameter) is not a string" out of React's
  // internals as an uncaught exception.
  const [lib, setLib] = useState<OpeningHoursCtor | null>(() => libValue)
  useEffect(() => {
    if (!shouldLoad || lib) return
    let cancelled = false
    loadOpeningHoursLib().then((l) => { if (!cancelled && l) setLib(() => l) })
    return () => { cancelled = true }
  }, [shouldLoad, lib])
  return lib
}

// ─── Shared minute ticker ───────────────────────────────────────────────────

// "Open now" is only true *now*. Without a ticker the status is frozen at
// mount: a venue stays "Geöffnet" hours after closing, and a "closes in 20
// min" chip sticks at its original number forever. One module-level interval
// serves every subscriber, so 200 result cards cost one timer, not 200.
const TICK_MS = 60_000
const tickListeners = new Set<() => void>()
let tickValue = 0
let tickTimer: ReturnType<typeof setInterval> | null = null

function subscribeTick(cb: () => void): () => void {
  tickListeners.add(cb)
  if (!tickTimer) {
    tickTimer = setInterval(() => {
      tickValue = Date.now()
      tickListeners.forEach((l) => l())
    }, TICK_MS)
  }
  return () => {
    tickListeners.delete(cb)
    if (tickListeners.size === 0 && tickTimer) {
      clearInterval(tickTimer)
      tickTimer = null
    }
  }
}
const getTick = () => tickValue
// Stable across the server render; the real clock only matters once the
// (client-only) library has loaded, at which point nothing is hydrating.
const getServerTick = () => 0

function useMinuteTick(): number {
  return useSyncExternalStore(subscribeTick, getTick, getServerTick)
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

export function useOpeningStatus(place: Place): OpeningStatus | null {
  const hours = extractParsableOpeningHours(place)
  const lib   = useOpeningHoursLib(Boolean(hours))
  const tick  = useMinuteTick()

  return useMemo(() => {
    if (!lib || !hours) return null
    return computeStatusSync(lib, hours, place, new Date())
    // `tick` is deliberately a dependency: it is the signal that "now" moved
    // on and the status must be re-evaluated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib, hours, place.id, tick])
}

/**
 * Drops only *confirmed* closed places. Anything with no parseable hours, or
 * whose status can't be determined, stays visible — the same pass-through
 * `acceptUnknown` already applies to missing accessibility data, and the only
 * viable default given measured coverage (Berlin ⌀76%, Issum ⌀39%).
 *
 * Fully derived (no async state), so it cannot go stale: the previous
 * implementation kept a Set of closed ids in state, which still held the
 * *previous* search's verdicts until a new async pass resolved — and stayed
 * empty for the whole duration of the library download, showing closed
 * places as if the filter were off.
 */
export function useOpenNowFilter(places: Place[], enabled: boolean): Place[] {
  const needsLib = enabled && places.some((p) => extractParsableOpeningHours(p) !== null)
  const lib  = useOpeningHoursLib(needsLib)
  const tick = useMinuteTick()

  return useMemo(() => {
    if (!enabled || !lib) return places
    const now = new Date()
    return places.filter((p) => {
      const hours = extractParsableOpeningHours(p)
      if (!hours) return true
      const status = computeStatusSync(lib, hours, p, now)
      return status?.state !== "closed"
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, enabled, lib, tick])
}

// ─── Hooks (amenity spots — parking/WC point features) ─────────────────────

/**
 * Batch status for a list of amenity spots (currently only WCs carry
 * openingHours; parking never does, so those simply resolve to null).
 * Keyed by amenitySpotKey() so callers can look a status up per spot without
 * re-deriving it — used both by AmenityCard (the chip) and by the two
 * WC-specific behaviours that need the WHOLE list's verdicts at once:
 * useAmenityOpenNowFilter's filtering and SimpleLayout's closed-last sort.
 *
 * Only requests the library when `enabled` and at least one spot actually
 * has hours to evaluate — an amenity search with only standalone-untagged or
 * parking spots never pays for it.
 */
export function useAmenityOpeningStatuses(spots: AmenityFeature[], enabled: boolean): Map<string, OpeningStatus | null> {
  const needsLib = enabled && spots.some((s) => extractAmenityOpeningHours(s) !== null)
  const lib  = useOpeningHoursLib(needsLib)
  const tick = useMinuteTick()

  return useMemo(() => {
    const map = new Map<string, OpeningStatus | null>()
    if (!enabled || !lib) return map
    const now = new Date()
    for (const spot of spots) {
      const hours = extractAmenityOpeningHours(spot)
      map.set(amenitySpotKey(spot), hours ? computeStatusSync(lib, hours, { lat: spot.lat, lon: spot.lon }, now) : null)
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spots, enabled, lib, tick])
}

/**
 * Expert Mode's "Nur jetzt geöffnete Orte" for the WC quick search (per
 * review decision ②): applies to every WC with a computable status —
 * standalone public toilets included, not just venue-hosted ones. A
 * standalone WC's own hours are just as authoritative as a venue's, and
 * restricting to venues only would make the filter a no-op wherever
 * publicToiletsOnly is also active. Same pass-through rule as
 * useOpenNowFilter: only a *confirmed* closed spot is dropped.
 */
export function useAmenityOpenNowFilter(spots: AmenityFeature[], enabled: boolean): AmenityFeature[] {
  const statuses = useAmenityOpeningStatuses(spots, enabled)
  return useMemo(() => {
    if (!enabled || statuses.size === 0) return spots
    return spots.filter((s) => statuses.get(amenitySpotKey(s))?.state !== "closed")
  }, [spots, enabled, statuses])
}
