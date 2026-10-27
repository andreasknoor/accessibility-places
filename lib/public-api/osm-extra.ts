import type { Place } from "../types"
import { fetchOsmPlacesByQuery, raceOverpass } from "../adapters/osm"
import type { ApiOnlyCategory } from "./constants"
import { UPSTREAM_TIMEOUT_MS } from "./constants"
import {
  combineEntrances, isUsableElevatorNode, stepFreeFromEntranceNode,
  type Tags, type YesNoUnknown,
} from "./tags"

// OSM queries the public API needs beyond the app's adapter queries.

// ─── API-only categories ──────────────────────────────────────────────────

const EXTRA_CLAUSES: Record<Exclude<ApiOnlyCategory, "arts_centre">, string[]> = {
  castle:       [`["historic"~"^(castle|palace)$"]["name"]`, `["castle_type"]["name"]`],
  garden:       [`["leisure"="garden"]["name"]["access"!~"^(private|no)$"]`, `["garden:type"="botanical"]["name"]`],
  concert_hall: [`["amenity"="concert_hall"]`, `["theatre:type"="concert_hall"]`],
}

export function buildExtraCategoryQuery(
  categories: ApiOnlyCategory[],
  location: { lat: number; lon: number },
  radiusKm: number,
): string {
  const around = `(around:${Math.round(radiusKm * 1000)},${location.lat},${location.lon})`
  const clauses: string[] = []
  for (const cat of categories) {
    if (cat === "arts_centre") continue // covered by the app's gallery category
    for (const f of EXTRA_CLAUSES[cat]) clauses.push(`nwr${around}${f};`)
  }
  if (clauses.length === 0) return ""
  return `[out:json][timeout:10];(${clauses.join("")});out 500 center tags;`
}

export function fetchExtraCategoryPlaces(
  categories: ApiOnlyCategory[],
  location: { lat: number; lon: number },
  radiusKm: number,
): Promise<Place[]> {
  const query = buildExtraCategoryQuery(categories, location, radiusKm)
  if (!query) return Promise.resolve([])
  return fetchOsmPlacesByQuery(query, location, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS))
}

// ─── Element by id ────────────────────────────────────────────────────────

export type OsmType = "node" | "way" | "relation"

export async function fetchOsmElement(type: OsmType, id: number): Promise<Place | null> {
  const query = `[out:json][timeout:10];${type}(id:${id});out center tags;`
  // Location only picks the endpoint set; any DACH point selects the full race.
  const places = await fetchOsmPlacesByQuery(query, { lat: 51, lon: 10 }, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS))
  return places[0] ?? null
}

// ─── Entrance + elevator nodes of ways / relations ─────────────────────────
// One query for all requested buildings. Per element the output is: the
// element itself (`out ids`, used as a separator), its entrance nodes on the
// outline, then highway=elevator nodes inside its area.

export interface StructureInfo {
  stepFree: YesNoUnknown
  elevator: boolean
}

export function buildStructureQuery(refs: string[]): string {
  const parts: string[] = []
  for (const ref of refs) {
    const [type, id] = ref.split("/")
    if (!/^\d+$/.test(id ?? "")) continue
    if (type === "way") {
      parts.push(`way(id:${id});out ids;node(w)[entrance];out tags;way(id:${id});map_to_area;node(area)[highway=elevator];out tags;`)
    } else if (type === "relation") {
      parts.push(`relation(id:${id});out ids;way(r);node(w)[entrance];out tags;relation(id:${id});map_to_area;node(area)[highway=elevator];out tags;`)
    }
  }
  return parts.length ? `[out:json][timeout:15];${parts.join("")}` : ""
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseStructureResponse(elements: any[]): Map<string, StructureInfo> {
  const out = new Map<string, { entrances: YesNoUnknown[]; elevator: boolean }>()
  let current: string | null = null
  for (const el of elements) {
    if (el.type === "way" || el.type === "relation") {
      current = `${el.type}/${el.id}`
      out.set(current, { entrances: [], elevator: false })
      continue
    }
    if (!current || el.type !== "node") continue
    const tags: Tags = el.tags ?? {}
    const entry = out.get(current)!
    if ("entrance" in tags) entry.entrances.push(stepFreeFromEntranceNode(tags))
    if (isUsableElevatorNode(tags)) entry.elevator = true
  }
  const result = new Map<string, StructureInfo>()
  for (const [ref, { entrances, elevator }] of out) {
    result.set(ref, { stepFree: combineEntrances(entrances), elevator })
  }
  return result
}

export async function fetchStructureInfo(
  refs: string[],
  location: { lat: number; lon: number },
): Promise<Map<string, StructureInfo>> {
  const query = buildStructureQuery(refs)
  if (!query) return new Map()
  const { json } = await raceOverpass(query, location, { timeoutMs: UPSTREAM_TIMEOUT_MS })
  return parseStructureResponse(json.elements ?? [])
}
