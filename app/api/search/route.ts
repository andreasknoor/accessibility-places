import { NextRequest } from "next/server"
import type { SearchParams, SearchResult, SourceId, FilterDebug, A11yValue, Place } from "@/lib/types"
import { startAdapterTasks }            from "@/lib/adapters"
import { trackCall, trackError, trackDuration } from "@/lib/stats"
import { findMatch, filterByNameHint }  from "@/lib/matching/match"
import { mergePlaces, passesFilters, finalisePlaceConfidence, computeFilteredConfidence, countLimited } from "@/lib/matching/merge"
import { fetchOsmDisabledParking, type NearbyParkingFeature } from "@/lib/adapters/osm"
import { enrichWithNearbyParking, haversineMeters, NEARBY_PARKING_DISPLAY_RADIUS_M } from "@/lib/matching/nearby-parking"
import { parseQuery } from "@/lib/llm"
import { NOMINATIM_ENDPOINT, RADIUS_MIN_KM, RADIUS_MAX_KM, PUBLIC_OVERPASS_ENDPOINTS } from "@/lib/config"
import * as Sentry from "@sentry/nextjs"

// Adapter errors come back from safeRun as plain strings (the original Error is
// stringified there). At this API boundary we classify them: transient HTTP or
// network failures are expected operating noise (tracked as Upstash stats only),
// while anything else — e.g. a changed upstream API contract — is reported to
// GlitchTip as an unexpected error (#3). Captures live here, never inside
// safeRun/adapters, to keep those side-effect-free for ISR.
function isExpectedAdapterError(errStr: string): boolean {
  return /\b[45]\d\d\b/.test(errStr)                                               // HTTP status, e.g. "API error: 503", "returned 429"
      || /timeout|abort|fetch failed|network|ECONN|ENOTFOUND|socket|terminated/i.test(errStr)
}

// ─── In-memory rate limiters (sliding-window, per IP) ───────────────────────
// NOTE: these reset on each serverless cold start. For multi-instance
// deployments a shared store (Redis/Upstash) would be required.

const RATE_LIMIT_WINDOW_MS      = 60_000  // 1 minute
const RATE_LIMIT_MAX_REQUESTS   = 10      // general: max 10 searches/min per IP
const RATE_LIMIT_GP_MAX         = 3       // Google Places: max 3 searches/min per IP
                                          // (each search fans out to N category calls)

const ipWindows   = new Map<string, number[]>()
const ipGpWindows = new Map<string, number[]>()

function slidingCount(map: Map<string, number[]>, ip: string, push = true): number {
  const now    = Date.now()
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  const times  = (map.get(ip) ?? []).filter((t) => t > cutoff)
  if (push) times.push(now)
  if (times.length === 0) map.delete(ip)
  else map.set(ip, times)
  return times.length
}

function isRateLimited(ip: string): boolean {
  return slidingCount(ipWindows, ip) > RATE_LIMIT_MAX_REQUESTS
}

function isGooglePlacesRateLimited(ip: string, requested: boolean): boolean {
  if (!requested) return false
  return slidingCount(ipGpWindows, ip) > RATE_LIMIT_GP_MAX
}

// ─── Internal geocoding ──────────────────────────────────────────────────────

async function geocode(
  locationQuery: string,
  signal: AbortSignal,
): Promise<{ lat: number; lon: number; label: string } | null> {
  const url = `${NOMINATIM_ENDPOINT}/search?q=${encodeURIComponent(locationQuery)}&format=json&limit=1&countrycodes=de,at,ch`
  try {
    trackCall("nominatim")
    const res = await fetch(url, {
      headers: { "User-Agent": "AccessiblePlaces/1.0 (contact@accessible-places.org)" },
      signal:  AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
    })
    if (!res.ok) {
      trackError("nominatim")
      return null
    }
    const data = await res.json()
    if (!data[0]) return null  // "not found" is a valid response, not an error
    return {
      lat:   parseFloat(data[0].lat),
      lon:   parseFloat(data[0].lon),
      label: data[0].display_name,
    }
  } catch {
    trackError("nominatim")
    return null
  }
}

// ─── Strip raw + narrow metadata before sending to client ────────────────────
//
// Adapters store the full upstream object in `metadata` for debugging. In production
// we whitelist only the fields PlaceDebugSheet actually renders — keeps phone numbers,
// third-party IDs, full address blocks, and similar data off the wire.

const METADATA_WHITELIST: Partial<Record<SourceId, readonly string[]>> = {
  osm: [
    "opening_hours", "email", "contact:email", "cuisine", "stars", "tourism:stars",
    "takeaway", "delivery", "internet_access", "dog", "dogs",
    "wheelchair:description", "wheelchair:description:de",
    "image", "wikimedia_commons", "wikidata",
  ],
  google_places: [
    "regularOpeningHours", "rating", "userRatingCount", "priceLevel", "photos",
  ],
  // accessibility_cloud, reisen_fuer_alle, ginto: no fields currently read from
  // metadata in the UI; default to {} in prod so nothing leaks.
}

function pickMetadata(sourceId: SourceId, metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== "object") return undefined
  const keys = METADATA_WHITELIST[sourceId]
  if (!keys) return {}
  const src = metadata as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of keys) if (k in src) out[k] = src[k]
  return out
}

function stripRaw(places: Place[]): Place[] {
  if (process.env.NODE_ENV === "development") return places
  return places.map((p) => ({
    ...p,
    sourceRecords: p.sourceRecords.map(({ raw: _raw, metadata, sourceId, ...rest }) => ({
      ...rest,
      sourceId,
      metadata: pickMetadata(sourceId, metadata),
    })),
  }))
}

// ─── Streaming NDJSON event types ───────────────────────────────────────────

type StreamEvent =
  | { type: "source"; sourceId: SourceId; status: "ok" | "error"; count?: number; error?: string; durationMs: number }
  | { type: "result"; payload: SearchResult }
  | { type: "fatal";  error: string }

// ─── Route handler (NDJSON streaming) ──────────────────────────────────────

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown"
  const t0 = Date.now()

  let rawBody: Record<string, unknown>
  try {
    rawBody = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status:  400,
      headers: { "Content-Type": "application/json" },
    })
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  // Counted only after the request body parses, so malformed POSTs cannot burn a quota slot.
  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: "Too many requests. Please wait a minute." }), {
      status:  429,
      headers: { "Content-Type": "application/json", "Retry-After": "60" },
    })
  }

  // ── Input validation ──────────────────────────────────────────────────────
  const { userQuery, radiusKm: rawRadius, filters: rawFilters, sources: rawSources, locale, coordinates: rawCoords, nameHint: rawNameHint, placeSearch: rawPlaceSearch } = rawBody
  const placeSearch = rawPlaceSearch === true

  const coordinates = (() => {
    if (!rawCoords || typeof rawCoords !== "object") return undefined
    const c = rawCoords as Record<string, unknown>
    const lat = typeof c.lat === "number" ? c.lat : undefined
    const lon = typeof c.lon === "number" ? c.lon : undefined
    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return undefined
    return { lat, lon }
  })()

  // placeSearch mode supplies coordinates directly and uses nameHint as the query — allow empty userQuery
  if (typeof userQuery !== "string" || (userQuery.trim().length === 0 && !(placeSearch && coordinates))) {
    return new Response(JSON.stringify({ error: "userQuery must be a non-empty string" }), {
      status:  400,
      headers: { "Content-Type": "application/json" },
    })
  }
  if (userQuery.length > 500) {
    return new Response(JSON.stringify({ error: "userQuery too long (max 500 characters)" }), {
      status:  400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const nameHint = typeof rawNameHint === "string" ? rawNameHint.trim().slice(0, 100) : ""

  const PLACE_SEARCH_RADIUS_KM = 0.5
  const radiusKm = placeSearch
    ? PLACE_SEARCH_RADIUS_KM
    : typeof rawRadius === "number"
      ? Math.max(RADIUS_MIN_KM, Math.min(RADIUS_MAX_KM, rawRadius))
      : 5

  const rawF = rawFilters && typeof rawFilters === "object" ? rawFilters as Record<string, unknown> : {}
  const filters: SearchParams["filters"] = {
    entrance:          Boolean(rawF.entrance),
    toilet:            Boolean(rawF.toilet),
    parking:           Boolean(rawF.parking),
    // Default `true` when the client doesn't send the key: legacy clients
    // (and any caller not yet aware of parkingNearby) get the previous
    // behaviour — parking filter accepts nearby-only enrichment.
    parkingNearby:     rawF.parkingNearby === undefined ? true : Boolean(rawF.parkingNearby),
    seating:           Boolean(rawF.seating),
    onlyVerified:      Boolean(rawF.onlyVerified),
    acceptUnknown:     Boolean(rawF.acceptUnknown),
    alwaysShowParking: false,
  }

  const req_s = rawSources && typeof rawSources === "object" ? rawSources as Record<string, unknown> : {}
  const sources: SearchParams["sources"] = {
    accessibility_cloud: Boolean(req_s.accessibility_cloud) && Boolean(process.env.ACCESSIBILITY_CLOUD_API_KEY),
    osm:                 Boolean(req_s.osm),
    reisen_fuer_alle:    Boolean(req_s.reisen_fuer_alle)    && Boolean(process.env.REISEN_FUER_ALLE_API_KEY),
    ginto:               Boolean(req_s.ginto)               && Boolean(process.env.GINTO_API_KEY),
    google_places:       Boolean(req_s.google_places)       && Boolean(process.env.GOOGLE_PLACES_API_KEY),
  }

  const gpRateLimited = isGooglePlacesRateLimited(ip, sources.google_places)
  if (gpRateLimited) {
    sources.google_places = false
  }

  const encoder = new TextEncoder()

  // ── AbortController — cancel all in-flight work if client disconnects ─────
  const abortController = new AbortController()
  const { signal } = abortController

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: StreamEvent) => {
        if (signal.aborted) return
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"))
      }

      // Flush queued Sentry events before closing the stream. On Vercel
      // Fluid/serverless the instance can be frozen the moment the response
      // ends, dropping any captured-but-not-yet-transmitted events (#1/#2/#3).
      // flush() is a cheap no-op when nothing is queued, so the happy path is
      // unaffected; telemetry must never block the response, hence the catch.
      const flushAndClose = async () => {
        try { await Sentry.flush(2000) } catch { /* ignore */ }
        controller.close()
      }

      try {
        // ── 1. Parse query (deterministic, no LLM) ───────────────────────────
        const parsed = parseQuery(userQuery)
        if (signal.aborted) { controller.close(); return }

        // ── 2. Resolve location — use GPS coords directly if provided, else geocode ──
        let geo: { lat: number; lon: number; label: string }
        if (coordinates) {
          geo = { lat: coordinates.lat, lon: coordinates.lon, label: userQuery }
        } else {
          const geocoded = await geocode(parsed.locationQuery, signal)
          if (signal.aborted) { controller.close(); return }
          if (!geocoded) {
            emit({ type: "fatal", error: `Location not found: "${parsed.locationQuery}"` })
            controller.close()
            return
          }
          geo = geocoded
        }

        // ── 3. Build per-source params ────────────────────────────────────────
        const params: SearchParams = {
          query:      userQuery,
          location:   { lat: geo.lat, lon: geo.lon },
          radiusKm,
          categories: parsed.categories,
          filters,
          sources,
          signal,
          nameHint:    nameHint || undefined,
          placeSearch: placeSearch || undefined,
        }

        // ── 4. Fire all adapters ──────────────────────────────────────────────
        if (gpRateLimited) {
          emit({ type: "source", sourceId: "google_places", status: "error", error: "Rate limited", durationMs: 0 })
        }
        // Set of public Overpass endpoints — labels OSM stats as public vs. the
        // private Hetzner mirror. Defined here so the per-source diagnostics
        // inside `wrapped` (below) can reference it.
        const PUBLIC_OVERPASS = new Set(PUBLIC_OVERPASS_ENDPOINTS)

        const tasks = startAdapterTasks(params)
        const wrapped = tasks.map(({ sourceId, promise }) =>
          promise.then((r) => {
            const event: StreamEvent = r.error
              ? { type: "source", sourceId, status: "error", error: "Source unavailable", durationMs: r.durationMs }
              : { type: "source", sourceId, status: "ok",    count: r.places.length,       durationMs: r.durationMs }
            emit(event)

            // Per-source diagnostics run as each adapter settles — NOT gated
            // behind the slowest one (a hanging source must not also hide the
            // other sources' stats and alerts). Stats live at this API boundary,
            // never inside safeRun, so fetchAllSources stays side-effect-free
            // and safe to call from ISR.
            const statSrc: SourceId = (r.sourceId === "osm" && r.winnerEndpoint)
              ? (PUBLIC_OVERPASS.has(r.winnerEndpoint) ? "osm_public" : "osm_private")
              : r.sourceId
            trackCall(statSrc)
            trackDuration(statSrc, r.durationMs)
            if (r.error) {
              trackError(statSrc)
              // #3: report only *unexpected* adapter failures (e.g. a changed
              // API contract / unexpected response shape). Transient HTTP/network
              // errors stay stats-only to avoid noise.
              if (!isExpectedAdapterError(r.error)) {
                Sentry.captureMessage(`Adapter ${r.sourceId} failed unexpectedly: ${r.error}`, {
                  level: "error",
                  tags:  { area: "adapter", source: r.sourceId, kind: "unexpected" },
                })
              }
            }
            return r
          }),
        )

        // 4a. Kick off the disabled-parking fetch in parallel with the venue
        // adapters so it doesn't add to the visible latency.
        // ENABLE_NEARBY_PARKING defaults to OFF: only the literal string "1"
        // turns it on. Failure of this fetch is non-fatal — main search
        // proceeds and parking values stay as the adapters reported them.
        const nearbyParkingEnabled = process.env.ENABLE_NEARBY_PARKING === "1"
        // Always include the weak "accessible" tier in the parking fetch. It is
        // display-only (never enriches/filters) and gated client-side by the
        // showWeakParking setting. SEO opts out via the function-arg default.
        const nearbyParkingPromise: Promise<NearbyParkingFeature[]> = nearbyParkingEnabled
          ? fetchOsmDisabledParking({ lat: geo.lat, lon: geo.lon }, radiusKm, signal, true).then(
              ({ features, winnerEndpoint, durationMs }) => {
                const parkingSrc = PUBLIC_OVERPASS.has(winnerEndpoint) ? "osm_parking_public" : "osm_parking_private"
                trackCall(parkingSrc)
                trackDuration(parkingSrc, durationMs)
                return features
              },
              () => { trackError("osm_parking"); return [] },
            )
          : Promise.resolve([])

        const adapterResults = await Promise.all(wrapped)
        if (signal.aborted) { controller.close(); return }

        // #2: systemic outage — every active source errored. A single source
        // failing is normal (stats only); all of them failing at once is a real
        // signal worth an alert.
        if (adapterResults.length > 0 && adapterResults.every((r) => r.error)) {
          Sentry.captureMessage("All active search sources failed", {
            level: "error",
            tags:  { area: "search-pipeline", kind: "all-sources-failed", failed: String(adapterResults.length) },
            extra: { errors: adapterResults.map((r) => ({ source: r.sourceId, error: r.error })) },
          })
        }

        // ── 5. Match & merge ─────────────────────────────────────────────────
        const canonical: ReturnType<typeof mergePlaces>[] = []
        for (const result of adapterResults) {
          for (const incoming of result.places) {
            const idx = findMatch(canonical, incoming)
            if (idx >= 0) canonical[idx] = mergePlaces(canonical[idx], incoming)
            else          canonical.push(finalisePlaceConfidence(incoming))
          }
        }

        // 5a. Enrich each merged place with "nearby disabled parking" info
        // when its own parking value is unknown. Done before the category
        // filter (5b) so the upgraded value is in place for confidence and
        // filter steps that follow.
        let parkingFeatures: NearbyParkingFeature[] = []
        if (nearbyParkingEnabled) {
          parkingFeatures = await nearbyParkingPromise
          enrichWithNearbyParking(canonical, parkingFeatures)
        }

        const wheelchairCanonical = canonical.filter((p) => !p.dogPolicyOnly)

        // ── 5b. Category filter ──────────────────────────────────────────────
        // Adapters like A.Cloud have no server-side category filter and return
        // all accessible places in the radius. Post-filter here so a search for
        // "ice_cream" doesn't surface cafés, restaurants, etc.
        const categoryFiltered = params.categories?.length
          ? wheelchairCanonical.filter((p) => params.categories!.includes(p.category))
          : wheelchairCanonical

        // ── 6. Name filter ───────────────────────────────────────────────────
        const nameFiltered = filterByNameHint(categoryFiltered, nameHint)

        // ── 7. Filtered confidence + sort ────────────────────────────────────
        const withScore = nameFiltered.map((p) => ({
          ...p,
          overallConfidence: computeFilteredConfidence(p, filters),
        }))

        const failedBy = { entrance: 0, toilet: 0, parking: 0, seating: 0 }
        const toiletValueCounts: Record<A11yValue, number> = { yes: 0, limited: 0, no: 0, unknown: 0 }
        for (const p of withScore) {
          toiletValueCounts[p.accessibility.toilet.value]++
          const passes = passesFilters(p, filters)
          if (!passes) {
            if (filters.entrance && !["yes","limited"].includes(p.accessibility.entrance.value) && !(p.accessibility.entrance.value === "unknown" && filters.acceptUnknown)) failedBy.entrance++
            if (filters.toilet   && !["yes","limited"].includes(p.accessibility.toilet.value)   && !(p.accessibility.toilet.value   === "unknown" && filters.acceptUnknown)) failedBy.toilet++
            if (filters.parking  && !["yes","limited"].includes(p.accessibility.parking.value)  && !(p.accessibility.parking.value  === "unknown" && filters.acceptUnknown)) failedBy.parking++
            if (filters.seating  && p.accessibility.seating && !["yes","limited"].includes(p.accessibility.seating.value) && !(p.accessibility.seating.value === "unknown" && filters.acceptUnknown)) failedBy.seating++
          }
        }
        const filterDebug: FilterDebug = {
          total:  withScore.length,
          passed: withScore.filter((p) => passesFilters(p, filters)).length,
          failedBy,
          toiletValueCounts,
        }

        const sortPlaces = (a: Place & { overallConfidence: number }, b: Place & { overallConfidence: number }) => {
          const confDiff = b.overallConfidence - a.overallConfidence
          if (Math.abs(confDiff) >= 0.001) return confDiff
          return countLimited(a, filters) - countLimited(b, filters)
        }
        const filtered = nameHint
          ? [...withScore].sort(sortPlaces)
          : withScore.filter((p) => passesFilters(p, filters)).sort(sortPlaces)

        // ── 8. Stats ─────────────────────────────────────────────────────────
        const sourceStats = {} as Record<SourceId, number>
        for (const r of adapterResults) sourceStats[r.sourceId] = r.places.length

        emit({
          type: "result",
          payload: {
            places:        stripRaw(filtered),
            durationMs:    Date.now() - t0,
            nameHint:      nameHint || undefined,
            sourceStats,
            location:      { lat: geo.lat, lon: geo.lon },
            locationLabel: geo.label,
            filterDebug,
            // Parking markers sent to the client. Two tiers:
            //  • "disabled" (strong): only spots within NEARBY_PARKING_DISPLAY_RADIUS_M
            //    of a result whose parking was auto-enriched (nearbyOnly: true) —
            //    anchored to displayed venues, as before.
            //  • "accessible" (weak): ALL fetched accessible-tier lots in the area,
            //    independent of any anchor (variant 2). Needed so the tier shows in
            //    Parkplatz-Modus too, where there are no venue anchors.
            // The client's showWeakParking setting controls visibility of the weak
            // tier; the server always sends the same set (mirrors alwaysShowParking).
            parkingSpots:  (() => {
              const nearbyOnlyPlaces = filtered.filter((p) => {
                const det = p.accessibility.parking.details as { nearbyOnly?: boolean } | undefined
                return det?.nearbyOnly === true
              })
              const disabledSpots = parkingFeatures.filter((f) =>
                f.tier !== "accessible" &&
                nearbyOnlyPlaces.some((p) => haversineMeters(p.coordinates, f) <= NEARBY_PARKING_DISPLAY_RADIUS_M)
              )
              const accessibleSpots = parkingFeatures.filter((f) => f.tier === "accessible")
              return [...disabledSpots, ...accessibleSpots]
                .map((f) => ({
                  lat:      f.lat,
                  lon:      f.lon,
                  tier:     f.tier,
                  ...(f.capacity != null ? { capacity: f.capacity } : {}),
                  ...(f.fee      != null ? { fee:      f.fee }      : {}),
                  ...(f.maxstay  != null ? { maxstay:  f.maxstay }  : {}),
                  ...(f.access   != null ? { access:   f.access }   : {}),
                  ...(f.osmId    != null ? { osmId:    f.osmId }    : {}),
                }))
            })(),
          },
        })
        // Flush before close: #2/#3 captures may have fired during this run.
        await flushAndClose()
      } catch (err) {
        if (signal.aborted) { controller.close(); return }
        console.error("[search] unhandled error:", err)
        // #1: a genuine pipeline crash (not a handled adapter failure) — always
        // report to GlitchTip with the real stack.
        Sentry.captureException(err, { level: "error", tags: { area: "search-pipeline", kind: "unhandled" } })
        emit({ type: "fatal", error: "An unexpected error occurred. Please try again." })
        await flushAndClose()
      }
    },

    cancel() {
      abortController.abort()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type":      "application/x-ndjson; charset=utf-8",
      "Cache-Control":     "no-store",
      "X-Accel-Buffering": "no",
    },
  })
}
