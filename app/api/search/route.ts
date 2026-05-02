import { NextRequest } from "next/server"
import type { SearchParams, SearchResult, SourceId, FilterDebug, A11yValue, Place, SearchFilters } from "@/lib/types"
import { startAdapterTasks }            from "@/lib/adapters"
import { findMatch, filterByNameHint }  from "@/lib/matching/match"
import { mergePlaces, passesFilters, finalisePlaceConfidence, computeFilteredConfidence } from "@/lib/matching/merge"
import { parseQuery } from "@/lib/llm"
import { NOMINATIM_ENDPOINT, RADIUS_MIN_KM, RADIUS_MAX_KM } from "@/lib/config"

// ─── In-memory rate limiter (sliding-window, per IP) ────────────────────────
// NOTE: this resets on each serverless cold start. For multi-instance
// deployments a shared store (Redis/Upstash) would be required.

const RATE_LIMIT_WINDOW_MS   = 60_000  // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10

const ipWindows = new Map<string, number[]>()

function isRateLimited(ip: string): boolean {
  const now    = Date.now()
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  const times  = (ipWindows.get(ip) ?? []).filter((t) => t > cutoff)
  times.push(now)
  ipWindows.set(ip, times)
  return times.length > RATE_LIMIT_MAX_REQUESTS
}

// ─── Internal geocoding ──────────────────────────────────────────────────────

async function geocode(
  locationQuery: string,
  signal: AbortSignal,
): Promise<{ lat: number; lon: number; label: string } | null> {
  const url = `${NOMINATIM_ENDPOINT}/search?q=${encodeURIComponent(locationQuery)}&format=json&limit=1&countrycodes=de,at,ch`
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "AccessibleSpaces/1.0" },
      signal:  AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data[0]) return null
    return {
      lat:   parseFloat(data[0].lat),
      lon:   parseFloat(data[0].lon),
      label: data[0].display_name,
    }
  } catch {
    return null
  }
}

// ─── Strip raw API data from sourceRecords before sending to client ──────────

function stripRaw(places: Place[]): Place[] {
  if (process.env.NODE_ENV === "development") return places
  return places.map((p) => ({
    ...p,
    sourceRecords: p.sourceRecords.map(({ raw: _raw, ...rest }) => rest),
  }))
}

// ─── Streaming NDJSON event types ───────────────────────────────────────────

type StreamEvent =
  | { type: "source-progress"; sourceId: SourceId; attempt: number; of: number }
  | { type: "source"; sourceId: SourceId; status: "ok" | "error"; count?: number; error?: string; durationMs: number }
  | { type: "result"; payload: SearchResult }
  | { type: "fatal";  error: string }

// ─── Route handler (NDJSON streaming) ──────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Rate limiting ─────────────────────────────────────────────────────────
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown"
  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: "Too many requests. Please wait a minute." }), {
      status:  429,
      headers: { "Content-Type": "application/json", "Retry-After": "60" },
    })
  }

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

  // ── Input validation ──────────────────────────────────────────────────────
  const { userQuery, radiusKm: rawRadius, filters: rawFilters, sources: rawSources, locale } = rawBody

  if (typeof userQuery !== "string" || userQuery.trim().length === 0) {
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

  const radiusKm = typeof rawRadius === "number"
    ? Math.max(RADIUS_MIN_KM, Math.min(RADIUS_MAX_KM, rawRadius))
    : 5

  const filters: SearchParams["filters"] = {
    entrance:      Boolean(rawFilters && typeof rawFilters === "object" && (rawFilters as Record<string, unknown>).entrance),
    toilet:        Boolean(rawFilters && typeof rawFilters === "object" && (rawFilters as Record<string, unknown>).toilet),
    parking:       Boolean(rawFilters && typeof rawFilters === "object" && (rawFilters as Record<string, unknown>).parking),
    seating:       Boolean(rawFilters && typeof rawFilters === "object" && (rawFilters as Record<string, unknown>).seating),
    onlyVerified:  Boolean(rawFilters && typeof rawFilters === "object" && (rawFilters as Record<string, unknown>).onlyVerified),
    acceptUnknown: Boolean(rawFilters && typeof rawFilters === "object" && (rawFilters as Record<string, unknown>).acceptUnknown),
  }

  const sources: SearchParams["sources"] = {
    accessibility_cloud: Boolean(rawSources && typeof rawSources === "object" && (rawSources as Record<string, unknown>).accessibility_cloud),
    osm:                 Boolean(rawSources && typeof rawSources === "object" && (rawSources as Record<string, unknown>).osm),
    reisen_fuer_alle:    Boolean(rawSources && typeof rawSources === "object" && (rawSources as Record<string, unknown>).reisen_fuer_alle),
    google_places:       Boolean(rawSources && typeof rawSources === "object" && (rawSources as Record<string, unknown>).google_places),
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

      try {
        // ── 1. Parse query ────────────────────────────────────────────────────
        const parsed = await parseQuery(userQuery)
        if (signal.aborted) { controller.close(); return }

        // ── 2. Geocode the extracted location ────────────────────────────────
        const geo = await geocode(parsed.locationQuery, signal)
        if (signal.aborted) { controller.close(); return }
        if (!geo) {
          emit({ type: "fatal", error: `Location not found: "${parsed.locationQuery}"` })
          controller.close()
          return
        }

        // ── 3. Build per-source params ────────────────────────────────────────
        const PERMISSIVE_FILTERS: SearchFilters = { entrance: false, toilet: false, parking: false, seating: false, onlyVerified: false, acceptUnknown: true }
        const nameHint = parsed.nameHint ?? ""

        const params: SearchParams = {
          query:      userQuery,
          location:   { lat: geo.lat, lon: geo.lon },
          radiusKm,
          categories: parsed.categories,
          filters:    nameHint ? PERMISSIVE_FILTERS : filters,
          sources,
          nameHint:   nameHint || undefined,
          signal,
        }

        // ── 4. Fire all adapters ──────────────────────────────────────────────
        const tasks = startAdapterTasks(params, (sourceId, attempt, of) => {
          emit({ type: "source-progress", sourceId, attempt, of })
        })
        const wrapped = tasks.map(({ sourceId, promise }) =>
          promise.then((r) => {
            const event: StreamEvent = r.error
              ? { type: "source", sourceId, status: "error", error: "Source unavailable", durationMs: r.durationMs }
              : { type: "source", sourceId, status: "ok",    count: r.places.length,       durationMs: r.durationMs }
            emit(event)
            return r
          }),
        )
        const adapterResults = await Promise.all(wrapped)
        if (signal.aborted) { controller.close(); return }

        // ── 5. Match & merge ─────────────────────────────────────────────────
        const canonical: ReturnType<typeof mergePlaces>[] = []
        for (const result of adapterResults) {
          for (const incoming of result.places) {
            const idx = findMatch(canonical, incoming)
            if (idx >= 0) canonical[idx] = mergePlaces(canonical[idx], incoming)
            else          canonical.push(finalisePlaceConfidence(incoming))
          }
        }

        const wheelchairCanonical = canonical.filter((p) => !p.dogPolicyOnly)

        // ── 6. Name filter ───────────────────────────────────────────────────
        const nameFiltered = filterByNameHint(wheelchairCanonical, nameHint)

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
          }
        }
        const filterDebug: FilterDebug = {
          total:  withScore.length,
          passed: withScore.filter((p) => passesFilters(p, filters)).length,
          failedBy,
          toiletValueCounts,
        }

        const filtered = nameHint
          ? [...withScore].sort((a, b) => b.overallConfidence - a.overallConfidence)
          : withScore.filter((p) => passesFilters(p, filters))
                    .sort((a, b) => b.overallConfidence - a.overallConfidence)

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
          },
        })
        controller.close()
      } catch (err) {
        if (signal.aborted) { controller.close(); return }
        console.error("[search] unhandled error:", err)
        emit({ type: "fatal", error: "An unexpected error occurred. Please try again." })
        controller.close()
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
