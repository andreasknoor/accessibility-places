import type { Place } from "../types"
import { ALL_CATEGORIES } from "../llm"
import { findMatch, haversineMetres, normaliseString, trigramSimilarity } from "../matching/match"
import { mergePlaces } from "../matching/merge"
import { LOOKUP_MAX_ANCHORS, LOOKUP_RADIUS_KM, LOOKUP_WIDE_RADIUS_KM } from "./constants"
import { photonSearch, type PhotonHit } from "./photon"
import { fetchApiPlaces, type ApiWarning } from "./pipeline"
import { isVenueTags, osmRefOf, osmTagsOf } from "./tags"

// /places/lookup: name (+ city / address / coordinates) → best-matching venues.
//
// 1. Anchors: the caller's lat/lon, else Photon venue hits for
//    "<name> <address> <city>" (≤ 3, ≥ 300 m apart), else the city itself
//    (wide 5 km anchor).
// 2. Per anchor, the normal place-search pipeline (OSM name-regex query +
//    Ginto) within 0.5 km, merged across anchors.
// 3. Drop non-venues (bus stops, routes, taxi ranks, entrance nodes …),
//    score and rank.

export interface LookupQuery {
  name:     string
  city?:    string
  address?: string
  lat?:     number
  lon?:     number
  limit:    number
}

interface Anchor { lat: number; lon: number; wide: boolean }

export interface ScoredPlace { place: Place; score: number }

function normaliseName(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim()
}

/** Name similarity 0–1: trigram, with a containment floor ("Philharmonie" ⊂ "Berliner Philharmonie"). */
export function nameScore(query: string, candidate: string): number {
  const a = normaliseName(query)
  const b = normaliseName(candidate)
  if (!a || !b) return 0
  if (a === b) return 1
  const tri = trigramSimilarity(a, b)
  return a.includes(b) || b.includes(a) ? Math.max(tri, 0.85) : tri
}

/**
 * match_score = 0.6 · name + 0.25 · proximity + 0.15 · city
 *   proximity: 1 at the anchor, linearly 0 at 500 m; 0.5 for a wide (city-only) anchor
 *   city:      1 = address city equals the requested city, 0 = differs,
 *              0.5 = no city requested or the place has no city tag
 */
export function matchScore(q: LookupQuery, place: Place, anchors: Anchor[]): number {
  const name = nameScore(q.name, place.name)
  let proximity = 0
  for (const a of anchors) {
    const p = a.wide ? 0.5 : Math.max(0, 1 - haversineMetres(a, place.coordinates) / 500)
    proximity = Math.max(proximity, p)
  }
  let city = 0.5
  if (q.city && place.address.city) {
    city = normaliseString(place.address.city) === normaliseString(q.city) ? 1 : 0
  }
  return 0.6 * name + 0.25 * proximity + 0.15 * city
}

async function findAnchors(q: LookupQuery, warnings: ApiWarning[]): Promise<Anchor[]> {
  if (q.lat !== undefined && q.lon !== undefined) return [{ lat: q.lat, lon: q.lon, wide: false }]

  const text = [q.name, q.address, q.city].filter(Boolean).join(" ")
  let hits: PhotonHit[] = []
  try {
    hits = await photonSearch(text)
  } catch {
    warnings.push({ code: "geocoder_unavailable", message: "Venue geocoder (Photon) failed; lookup fell back to the city." })
  }

  let venues = hits.filter((h) => h.kind === "venue" && nameScore(q.name, h.name) >= 0.5)
  if (q.city) {
    const inCity = venues.filter((h) => normaliseString(h.city) === normaliseString(q.city!))
    if (inCity.length) venues = inCity
  }
  const anchors: Anchor[] = []
  for (const v of venues) {
    if (anchors.length >= LOOKUP_MAX_ANCHORS) break
    if (anchors.some((a) => haversineMetres(a, v) < 300)) continue
    anchors.push({ lat: v.lat, lon: v.lon, wide: false })
  }
  if (anchors.length) return anchors

  // No venue candidate: search by name across the city (or address) area.
  const area = q.city ?? q.address
  if (!area) return []
  try {
    const areaHits = await photonSearch(area, { limit: 3, areasOnly: true })
    const best = areaHits[0]
    if (best) return [{ lat: best.lat, lon: best.lon, wide: true }]
  } catch {
    warnings.push({ code: "geocoder_unavailable", message: "Geocoder (Photon) failed; the city could not be resolved." })
  }
  return []
}

export async function runLookup(q: LookupQuery): Promise<{ results: ScoredPlace[]; warnings: ApiWarning[]; allFailed: boolean }> {
  const warnings: ApiWarning[] = []
  const anchors = await findAnchors(q, warnings)
  if (anchors.length === 0) {
    warnings.push({ code: "location_not_found", message: "No candidate location found for this name/city." })
    return { results: [], warnings, allFailed: false }
  }

  const runs = await Promise.all(anchors.map((a) => fetchApiPlaces({
    location:    a,
    radiusKm:    a.wide ? LOOKUP_WIDE_RADIUS_KM : LOOKUP_RADIUS_KM,
    categories:  [...ALL_CATEGORIES],
    nameHint:    q.name,
    placeSearch: true,
  })))

  // Merge runs from overlapping anchors.
  const merged: Place[] = []
  for (const run of runs) {
    for (const p of run.places) {
      const same = merged.findIndex((m) => m.id === p.id)
      const idx  = same >= 0 ? same : findMatch(merged, p)
      if (idx >= 0) { if (same < 0) merged[idx] = mergePlaces(merged[idx], p) }
      else merged.push(p)
    }
  }
  for (const run of runs) {
    for (const w of run.warnings) if (!warnings.some((x) => x.message === w.message)) warnings.push(w)
  }

  const venues = merged.filter((p) => {
    const tags = osmTagsOf(p)
    // Non-OSM records (Ginto) are curated venues; OSM name hits need a venue tag.
    if (tags && !p.sourceRecords.some((r) => r.sourceId !== "osm")) return isVenueTags(tags)
    return true
  })

  const scored = venues
    .map((place) => ({ place, score: matchScore(q, place, anchors) }))
    .filter((s) => nameScore(q.name, s.place.name) >= 0.5)
    .sort((a, b) => b.score - a.score || (osmRefOf(a.place) ? -1 : 1))
    .slice(0, q.limit)

  return { results: scored, warnings, allFailed: runs.every((r) => r.allFailed) }
}
