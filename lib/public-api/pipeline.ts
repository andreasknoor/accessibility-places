import type { Category, Place } from "../types"
import type { AdapterResult } from "../adapters"
import { fetchAndMerge } from "../place-pipeline"
import { API_FETCH_FILTERS, API_SOURCES, GINTO_ATTRIBUTION, OSM_ATTRIBUTION, UPSTREAM_TIMEOUT_MS } from "./constants"

export interface ApiWarning { code: string; message: string }

/** Ginto entries are only republished when Ginto flags them as open data. */
export function isRepublishable(place: Place): boolean {
  if (place.primarySource !== "ginto") return true
  return place.sourceRecords[0]?.metadata?.isOpenData === true
}

export interface ApiFetchArgs {
  location:    { lat: number; lon: number }
  radiusKm:    number
  categories:  Category[]
  nameHint?:   string
  placeSearch?: boolean
  extra?:      Promise<AdapterResult>[]
  sources?:    Partial<typeof API_SOURCES>
}

export async function fetchApiPlaces(args: ApiFetchArgs): Promise<{ places: Place[]; warnings: ApiWarning[]; allFailed: boolean }> {
  const sources = { ...API_SOURCES, ...args.sources }
  const { places, failures } = await fetchAndMerge({
    query:       args.nameHint ?? "",
    location:    args.location,
    radiusKm:    args.radiusKm,
    categories:  args.categories,
    filters:     API_FETCH_FILTERS,
    sources,
    signal:      AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    nameHint:    args.nameHint,
    placeSearch: args.placeSearch,
    locale:      "de",
  }, { extra: args.extra, keep: isRepublishable })

  const warnings = failures.map((f) => ({
    code:    "source_unavailable",
    message: `Source "${f.sourceId}" did not respond in time or failed; results may be incomplete.`,
  }))
  // A source without its API key is skipped silently (returns [] without an
  // error) — it must not count as "responded", or a total OSM outage would be
  // reported as a partial result.
  const activeCount = (sources.osm ? 1 : 0)
    + (sources.ginto && process.env.GINTO_API_KEY ? 1 : 0)
    + (args.extra?.length ?? 0)
  return { places, warnings, allFailed: activeCount > 0 && failures.length >= activeCount }
}

/** Wrap an extra Place[] promise so it merges (and fails) like an adapter. */
export function asAdapterResult(sourceId: "osm", promise: Promise<Place[]>): Promise<AdapterResult> {
  const t0 = Date.now()
  return promise.then(
    (places) => ({ sourceId, places, durationMs: Date.now() - t0 }),
    (err)    => ({ sourceId, places: [], error: String(err), durationMs: Date.now() - t0 }),
  )
}

/** Attribution lines for exactly the sources present in a response. */
export function attributionFor(places: { sources: { source: string }[] }[], gintoExtra: string[] = []): string[] {
  const lines = [OSM_ATTRIBUTION]
  if (places.some((p) => p.sources.some((s) => s.source === "ginto"))) {
    lines.push(GINTO_ATTRIBUTION, ...gintoExtra)
  }
  return lines
}

/** Per-entry Ginto attribution strings (licenseInfo.attribution), deduplicated. */
export function gintoAttributions(places: Place[]): string[] {
  const out = new Set<string>()
  for (const p of places) {
    for (const r of p.sourceRecords) {
      const a = r.sourceId === "ginto" ? r.metadata?.attribution : undefined
      if (typeof a === "string" && a.trim()) out.add(a.trim())
    }
  }
  return [...out]
}
