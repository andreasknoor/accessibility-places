import type { Place, SearchParams, SourceId } from "../types"
import { fetchOsm }                  from "./osm"
import { fetchAccessibilityCloud }   from "./accessibility-cloud"
import { fetchReisenFuerAlle }       from "./reisen-fuer-alle"
import { fetchGooglePlaces }         from "./google-places"

export type AdapterResult = {
  sourceId: SourceId
  places: Place[]
  error?: string
  durationMs: number
}

async function safeRun(
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

/** Run all active sources in parallel and return results. */
export async function fetchAllSources(params: SearchParams): Promise<AdapterResult[]> {
  const { sources } = params

  const tasks: Promise<AdapterResult>[] = []

  if (sources.osm)
    tasks.push(safeRun("osm", () => fetchOsm(params)))
  if (sources.accessibility_cloud)
    tasks.push(safeRun("accessibility_cloud", () => fetchAccessibilityCloud(params)))
  if (sources.reisen_fuer_alle)
    tasks.push(safeRun("reisen_fuer_alle", () => fetchReisenFuerAlle(params)))
  if (sources.google_places)
    tasks.push(safeRun("google_places", () => fetchGooglePlaces(params)))

  return Promise.all(tasks)
}
