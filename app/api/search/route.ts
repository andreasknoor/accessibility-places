import { NextRequest, NextResponse } from "next/server"
import type { SearchParams, SearchResult, SourceId, FilterDebug, A11yValue } from "@/lib/types"
import { fetchAllSources }            from "@/lib/adapters"
import { findMatch, filterByNameHint } from "@/lib/matching/match"
import { mergePlaces, passesFilters, finalisePlaceConfidence, computeFilteredConfidence } from "@/lib/matching/merge"
import { parseQuery, summariseResults } from "@/lib/llm"
import { NOMINATIM_ENDPOINT }         from "@/lib/config"

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

// ─── Route handler ─────────────────────────────────────────────────────────

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
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  try {

  // ── 1. Parse query (LLM extracts location + categories) ───────────────────
  const parsed = await parseQuery(body.userQuery)

  // ── 2. Geocode the extracted location string ───────────────────────────────
  const geo = await geocode(parsed.locationQuery)
  if (!geo) {
    return NextResponse.json(
      { error: `Location not found: "${parsed.locationQuery}"` },
      { status: 404 },
    )
  }

  // ── 3. Fetch all active sources in parallel ────────────────────────────────
  const params: SearchParams = {
    query:      body.userQuery,
    location:   { lat: geo.lat, lon: geo.lon },
    radiusKm:   body.radiusKm,
    categories: parsed.categories,
    filters:    body.filters,
    sources:    body.sources,
  }

  const adapterResults = await fetchAllSources(params)

  // ── 4. Match & merge into canonical place list ─────────────────────────────
  const canonical: ReturnType<typeof mergePlaces>[] = []

  for (const result of adapterResults) {
    for (const incoming of result.places) {
      const idx = findMatch(canonical, incoming)
      if (idx >= 0) {
        canonical[idx] = mergePlaces(canonical[idx], incoming)
      } else {
        canonical.push(finalisePlaceConfidence(incoming))
      }
    }
  }

  // ── 4b. Name filter (when user searched for a specific place) ──────────────
  const nameHint     = parsed.nameHint ?? ""
  const nameFiltered = filterByNameHint(canonical, nameHint)

  // ── 5. Recompute confidence using only active filter criteria, then filter & sort
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
    total:             withScore.length,
    passed:            withScore.filter((p) => passesFilters(p, body.filters)).length,
    failedBy,
    toiletValueCounts,
  }

  // When searching by name: bypass accessibility filter — show the place regardless of criteria
  const filtered = nameHint
    ? [...withScore].sort((a, b) => b.overallConfidence - a.overallConfidence)
    : withScore.filter((p) => passesFilters(p, body.filters))
              .sort((a, b) => b.overallConfidence - a.overallConfidence)

  // ── 6. Stats ───────────────────────────────────────────────────────────────
  const sourceStats = {} as Record<SourceId, number>
  for (const r of adapterResults) {
    sourceStats[r.sourceId] = r.places.length
  }

  // ── 7. LLM summary ────────────────────────────────────────────────────────
  const summary = await summariseResults(filtered, body.locale ?? "de")

  const result: SearchResult = {
    places:        filtered,
    summary,
    durationMs:    Date.now() - t0,
    nameHint:      parsed.nameHint || undefined,
    sourceStats,
    location:      { lat: geo.lat, lon: geo.lon },
    locationLabel: geo.label,
    filterDebug,
  }

  return NextResponse.json(result)

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[search] unhandled error:", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
