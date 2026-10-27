import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { apiError, apiJson, guard } from "./http"
import { firstIssue, lookupSchema, nearbySchema, queryObject, toiletsSchema } from "./schemas"
import { runLookup } from "./lookup"
import { runNearby } from "./nearby"
import { enrichAndSerialize, parsePlaceId, runDetail } from "./detail"
import { attributionFor, gintoAttributions } from "./pipeline"
import { fetchToiletFeatures, toiletsWithin } from "./toilets"
import { OSM_ATTRIBUTION } from "./constants"

// Route bodies for /api/v1/*. The route files only re-export these, so the
// handlers stay unit-testable without the Next.js routing layer.

const ALL_FAILED = () => apiError(502, "upstream_unavailable", "All data sources failed. Retry later.")

async function safely(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    Sentry.captureException(err, { tags: { area: "public-api" } })
    return apiError(500, "internal_error", "Unexpected server error.")
  }
}

export async function handleLookup(req: NextRequest): Promise<Response> {
  const denied = await guard(req)
  if (denied) return denied
  const parsed = lookupSchema.safeParse(queryObject(req.nextUrl.searchParams))
  if (!parsed.success) return apiError(400, "invalid_parameter", firstIssue(parsed.error))

  return safely(async () => {
    const { results, warnings, allFailed } = await runLookup(parsed.data)
    if (allFailed && results.length === 0) return ALL_FAILED()
    const places = await enrichAndSerialize(results, warnings)
    return apiJson(
      { query: parsed.data, count: places.length, results: places },
      { attribution: attributionFor(places, gintoAttributions(results.map((r) => r.place))), warnings },
    )
  })
}

export async function handleNearby(req: NextRequest): Promise<Response> {
  const denied = await guard(req)
  if (denied) return denied
  const parsed = nearbySchema.safeParse(queryObject(req.nextUrl.searchParams))
  if (!parsed.success) return apiError(400, "invalid_parameter", firstIssue(parsed.error))
  const q = parsed.data

  return safely(async () => {
    const { results, warnings, allFailed } = await runNearby({
      lat: q.lat, lon: q.lon, radiusM: q.radius, categories: q.category, wheelchair: q.wheelchair, limit: q.limit,
    })
    if (allFailed && results.length === 0) return ALL_FAILED()
    return apiJson({ query: q, count: results.length, results }, { attribution: attributionFor(results), warnings })
  })
}

export async function handleToilets(req: NextRequest): Promise<Response> {
  const denied = await guard(req)
  if (denied) return denied
  const parsed = toiletsSchema.safeParse(queryObject(req.nextUrl.searchParams))
  if (!parsed.success) return apiError(400, "invalid_parameter", firstIssue(parsed.error))
  const q = parsed.data

  return safely(async () => {
    const center = { lat: q.lat, lon: q.lon }
    let features
    try {
      features = await fetchToiletFeatures(center, q.radius)
    } catch {
      return apiError(502, "upstream_unavailable", "OpenStreetMap (Overpass) did not respond. Retry later.")
    }
    const results = toiletsWithin(features, center, q.radius)
    return apiJson({ query: q, count: results.length, results }, { attribution: [OSM_ATTRIBUTION] })
  })
}

export async function handleDetail(req: NextRequest, rawId: string): Promise<Response> {
  const denied = await guard(req)
  if (denied) return denied
  const id = decodeURIComponent(rawId)
  const parsed = parsePlaceId(id)
  if (!parsed) {
    return apiError(400, "invalid_parameter",
      "id must look like osm:node:123, osm:way:123 or osm:relation:123 (non-OSM places are only available via /places/lookup).")
  }

  return safely(async () => {
    let detail
    try {
      detail = await runDetail(parsed.type, parsed.id)
    } catch {
      return apiError(502, "upstream_unavailable", "OpenStreetMap (Overpass) did not respond. Retry later.")
    }
    if (!detail.result) return apiError(404, "not_found", `No named OSM element ${id}.`)
    return apiJson({ result: detail.result }, { attribution: attributionFor([detail.result]), warnings: detail.warnings })
  })
}

// Re-exported for the route files' OPTIONS handlers.
export { corsPreflight } from "./http"
