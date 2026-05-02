import { NextRequest } from "next/server"
import type { SearchParams, SearchResult, SourceId, FilterDebug, A11yValue, Category, SearchFilters } from "@/lib/types"
import { startAdapterTasks }            from "@/lib/adapters"
import { findMatch, filterByNameHint }  from "@/lib/matching/match"
import { mergePlaces, passesFilters, finalisePlaceConfidence, computeFilteredConfidence } from "@/lib/matching/merge"
import { parseQuery } from "@/lib/llm"
import { NOMINATIM_ENDPOINT }           from "@/lib/config"

// ─── Internal geocoding (LLM-extracted location string → coordinates) ──────

async function geocode(
  locationQuery: string,
): Promise<{ lat: number; lon: number; label: string } | null> {
  const url = `${NOMINATIM_ENDPOINT}/search?q=${encodeURIComponent(locationQuery)}&format=json&limit=1&countrycodes=de,at,ch`
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "AccessibleSpaces/1.0" },
      signal:  AbortSignal.timeout(8_000),
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

// ─── Streaming NDJSON event types ───────────────────────────────────────────
// One JSON object per line. Client treats `\n` as event delimiter.
//   { type: "source", sourceId, status: "ok"|"error", count?, error?, durationMs }
//   { type: "result", payload: SearchResult }
//   { type: "fatal",  error }

type StreamEvent =
  | { type: "source-progress"; sourceId: SourceId; attempt: number; of: number }
  | { type: "source"; sourceId: SourceId; status: "ok" | "error"; count?: number; error?: string; durationMs: number }
  | { type: "result"; payload: SearchResult }
  | { type: "fatal";  error: string }

// ─── Route handler (NDJSON streaming) ──────────────────────────────────────

export async function POST(req: NextRequest) {
  const t0 = Date.now()

  let body: {
    userQuery: string
    radiusKm: number
    filters: SearchParams["filters"]
    sources: SearchParams["sources"]
    locale?: string
  }

  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status:  400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"))

      try {
        // ── 1. Parse query (LLM extracts location + categories) ──────────────
        const parsed = await parseQuery(body.userQuery)

        // ── 2. Geocode the extracted location string ─────────────────────────
        const geo = await geocode(parsed.locationQuery)
        if (!geo) {
          emit({ type: "fatal", error: `Location not found: "${parsed.locationQuery}"` })
          controller.close()
          return
        }

        // ── 3. Build per-source params ───────────────────────────────────────
        // For named-place searches: neutralise accessibility filters so pre-filters
        // don't discard untagged-but-real matches. Categories come from the LLM
        // (which now infers even for named searches) — no longer forcing all 15,
        // which was the main driver of excess Google Places API cost.
        const PERMISSIVE_FILTERS: SearchFilters = { entrance: false, toilet: false, parking: false, seating: false, onlyVerified: false, acceptUnknown: true }
        const nameHint = parsed.nameHint ?? ""

        const params: SearchParams = {
          query:      body.userQuery,
          location:   { lat: geo.lat, lon: geo.lon },
          radiusKm:   body.radiusKm,
          categories: parsed.categories,
          filters:    nameHint ? PERMISSIVE_FILTERS : body.filters,
          sources:    body.sources,
          nameHint:   nameHint || undefined,
        }

        // ── 4. Fire all adapters; emit a `source` event as each finishes ─────
        const tasks = startAdapterTasks(params, (sourceId, attempt, of) => {
          emit({ type: "source-progress", sourceId, attempt, of })
        })
        const wrapped = tasks.map(({ sourceId, promise }) =>
          promise.then((r) => {
            const event: StreamEvent = r.error
              ? { type: "source", sourceId, status: "error", error: r.error, durationMs: r.durationMs }
              : { type: "source", sourceId, status: "ok",    count: r.places.length, durationMs: r.durationMs }
            emit(event)
            return r
          }),
        )
        const adapterResults = await Promise.all(wrapped)

        // ── 5. Match & merge into canonical place list ───────────────────────
        const canonical: ReturnType<typeof mergePlaces>[] = []
        for (const result of adapterResults) {
          for (const incoming of result.places) {
            const idx = findMatch(canonical, incoming)
            if (idx >= 0) canonical[idx] = mergePlaces(canonical[idx], incoming)
            else          canonical.push(finalisePlaceConfidence(incoming))
          }
        }

        // ── 5b. Drop supplementary-only records (e.g. Pfotenpiloten places
        //   that never matched a wheelchair-data source). They contribute
        //   `allowsDogs` info via the merge but shouldn't appear standalone.
        const wheelchairCanonical = canonical.filter((p) => !p.dogPolicyOnly)

        // ── 6. Name filter ───────────────────────────────────────────────────
        const nameFiltered = filterByNameHint(wheelchairCanonical, nameHint)

        // ── 7. Filtered confidence + filter/sort ─────────────────────────────
        const withScore = nameFiltered.map((p) => ({
          ...p,
          overallConfidence: computeFilteredConfidence(p, body.filters),
        }))

        const failedBy = { entrance: 0, toilet: 0, parking: 0, seating: 0 }
        const toiletValueCounts: Record<A11yValue, number> = { yes: 0, limited: 0, no: 0, unknown: 0 }
        for (const p of withScore) {
          toiletValueCounts[p.accessibility.toilet.value]++
          const passes = passesFilters(p, body.filters)
          if (!passes) {
            if (body.filters.entrance && !["yes","limited"].includes(p.accessibility.entrance.value) && !(p.accessibility.entrance.value === "unknown" && body.filters.acceptUnknown)) failedBy.entrance++
            if (body.filters.toilet   && !["yes","limited"].includes(p.accessibility.toilet.value)   && !(p.accessibility.toilet.value   === "unknown" && body.filters.acceptUnknown)) failedBy.toilet++
            if (body.filters.parking  && !["yes","limited"].includes(p.accessibility.parking.value)  && !(p.accessibility.parking.value  === "unknown" && body.filters.acceptUnknown)) failedBy.parking++
          }
        }
        const filterDebug: FilterDebug = {
          total:  withScore.length,
          passed: withScore.filter((p) => passesFilters(p, body.filters)).length,
          failedBy,
          toiletValueCounts,
        }

        const filtered = nameHint
          ? [...withScore].sort((a, b) => b.overallConfidence - a.overallConfidence)
          : withScore.filter((p) => passesFilters(p, body.filters))
                    .sort((a, b) => b.overallConfidence - a.overallConfidence)

        // ── 8. Stats ─────────────────────────────────────────────────────────
        const sourceStats = {} as Record<SourceId, number>
        for (const r of adapterResults) sourceStats[r.sourceId] = r.places.length

        emit({
          type: "result",
          payload: {
            places:        filtered,
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
        const message = err instanceof Error ? err.message : String(err)
        console.error("[search] unhandled error:", err)
        emit({ type: "fatal", error: message })
        controller.close()
      }
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
