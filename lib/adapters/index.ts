import type { Place, SearchParams, SourceId } from "../types"
import { fetchOsm }                  from "./osm"
import { fetchAccessibilityCloud }   from "./accessibility-cloud"
import { fetchReisenFuerAlle }       from "./reisen-fuer-alle"
import { fetchGooglePlaces }         from "./google-places"
import { fetchGinto }                from "./ginto"

export type AdapterResult = {
  sourceId: SourceId
  places: Place[]
  error?: string
  durationMs: number
}

export async function safeRun(
  sourceId: SourceId,
  fn: () => Promise<Place[]>,
): Promise<AdapterResult> {
  const t0 = Date.now()
  try {
    const places = await fn()
    return { sourceId, places, durationMs: Date.now() - t0 }
  } catch (err) {
    console.error(`[adapter:${sourceId}]`, err)
    return { sourceId, places: [], error: String(err), durationMs: Date.now() - t0 }
  }
}

/** Build per-source pending tasks. Used by the streaming search route to emit
 *  per-source events as each adapter finishes individually.
 *
 *  `onProgress` lets adapters (currently only OSM, with its multi-endpoint
 *  fallback) report mid-fetch progress so the UI can show "1/3, 2/3, 3/3"
 *  next to the loading spinner. */
export function startAdapterTasks(
  params: SearchParams,
  onProgress?: (sourceId: SourceId, attempt: number, of: number) => void,
): Array<{ sourceId: SourceId; promise: Promise<AdapterResult> }> {
  const { sources } = params
  const tasks: Array<{ sourceId: SourceId; promise: Promise<AdapterResult> }> = []
  if (sources.osm)
    tasks.push({ sourceId: "osm",                 promise: safeRun("osm",                 () => fetchOsm(params, (a, of) => onProgress?.("osm", a, of))) })
  if (sources.accessibility_cloud)
    tasks.push({ sourceId: "accessibility_cloud", promise: safeRun("accessibility_cloud", () => fetchAccessibilityCloud(params)) })
  if (sources.reisen_fuer_alle)
    tasks.push({ sourceId: "reisen_fuer_alle",    promise: safeRun("reisen_fuer_alle",    () => fetchReisenFuerAlle(params)) })
  if (sources.google_places)
    tasks.push({ sourceId: "google_places",       promise: safeRun("google_places",       () => fetchGooglePlaces(params)) })
  if (sources.ginto)
    tasks.push({ sourceId: "ginto",               promise: safeRun("ginto",               () => fetchGinto(params)) })
  return tasks
}

/** Run all active sources in parallel and return results. */
export async function fetchAllSources(params: SearchParams): Promise<AdapterResult[]> {
  return Promise.all(startAdapterTasks(params).map((t) => t.promise))
}
