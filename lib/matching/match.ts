import type { Place } from "../types"
import {
  GEO_MATCH_RADIUS_M,
  NAME_SIMILARITY_THRESHOLD,
  MATCH_SCORE_THRESHOLD,
} from "../config"

// ─── Haversine distance (metres) ───────────────────────────────────────────

export function haversineMetres(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

// ─── Trigram similarity ────────────────────────────────────────────────────

function trigrams(s: string): Set<string> {
  const padded = `  ${s}  `
  const set = new Set<string>()
  for (let i = 0; i < padded.length - 2; i++) {
    set.add(padded.slice(i, i + 3))
  }
  return set
}

export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  const na = normaliseString(a)
  const nb = normaliseString(b)
  if (na === nb) return 1
  const ta = trigrams(na)
  const tb = trigrams(nb)
  let intersection = 0
  for (const t of ta) if (tb.has(t)) intersection++
  return (2 * intersection) / (ta.size + tb.size)
}

// ─── Address normalisation ─────────────────────────────────────────────────

export function normaliseString(s: unknown): string {
  if (!s) return ""
  // A11yJSON LocalizedString can be { de: "...", en: "..." }
  if (typeof s === "object") {
    const obj = s as Record<string, string>
    s = obj.de ?? obj.en ?? Object.values(obj)[0] ?? ""
  }
  if (typeof s !== "string") return ""
  return s
    .toLowerCase()
    .replace(/straße/g, "str.")
    .replace(/strasse/g, "str.")
    .replace(/gasse/g, "g.")
    .replace(/[äÄ]/g, "ae")
    .replace(/[öÖ]/g, "oe")
    .replace(/[üÜ]/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function addressSimilarity(a: Place, b: Place): number {
  const streetA = normaliseString(`${a.address.street} ${a.address.houseNumber}`)
  const streetB = normaliseString(`${b.address.street} ${b.address.houseNumber}`)
  const cityA   = normaliseString(a.address.city)
  const cityB   = normaliseString(b.address.city)
  const zipA    = String(a.address.postalCode ?? "").replace(/\s/g, "")
  const zipB    = String(b.address.postalCode ?? "").replace(/\s/g, "")

  const cityMatch   = cityA && cityB ? (cityA === cityB ? 1 : 0) : 0.5
  const zipMatch    = zipA && zipB   ? (zipA  === zipB  ? 1 : 0) : 0.5
  const streetMatch = trigramSimilarity(streetA, streetB)

  return streetMatch * 0.6 + cityMatch * 0.25 + zipMatch * 0.15
}

// ─── Combined match score ──────────────────────────────────────────────────

function matchScore(a: Place, b: Place): number {
  const dist     = haversineMetres(a.coordinates, b.coordinates)
  if (dist > GEO_MATCH_RADIUS_M * 3) return 0          // fast reject

  const geoScore  = Math.max(0, 1 - dist / GEO_MATCH_RADIUS_M)
  const nameScore = trigramSimilarity(a.name, b.name)
  const addrScore = addressSimilarity(a, b)

  // Containment boost: if one normalised name is a full substring of the
  // other AND the points are nearby, treat the names as effectively matching.
  // Catches OSM duplicates like "Meierei" (node, fast_food kiosk) vs
  // "Meierei - Brauerei Potsdam" (way, the brewery building) at the same spot.
  // The geo guard prevents false positives like "Sushi" vs "Sushi Bar" in a
  // food court.
  const nameA = normaliseString(a.name)
  const nameB = normaliseString(b.name)
  const containment = nameA && nameB && (nameA.includes(nameB) || nameB.includes(nameA))
  const containmentClose = containment && dist <= GEO_MATCH_RADIUS_M
  const effectiveName    = containmentClose ? Math.max(nameScore, 0.9) : nameScore

  // If name similarity is very low, it's probably a different place
  if (!containmentClose && nameScore < NAME_SIMILARITY_THRESHOLD && dist > 20) return 0

  return effectiveName * 0.5 + addrScore * 0.3 + geoScore * 0.2
}

// ─── Name-hint filter (used by search route and tests) ────────────────────

function normaliseForNameSearch(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
}

export function filterByNameHint(places: Place[], nameHint: string): Place[] {
  if (!nameHint) return places
  const hint = normaliseForNameSearch(nameHint)
  return places.filter((p) => {
    const name = normaliseForNameSearch(p.name)
    return name.includes(hint) || trigramSimilarity(name, hint) >= 0.6
  })
}

// ─── Public matching function ──────────────────────────────────────────────

/**
 * Given a list of existing canonical places and a new candidate,
 * returns the best-matching existing place index (or -1 if no match).
 */
export function findMatch(
  existing: Place[],
  candidate: Place,
): number {
  let bestIdx   = -1
  let bestScore = MATCH_SCORE_THRESHOLD - 0.001

  for (let i = 0; i < existing.length; i++) {
    const score = matchScore(existing[i], candidate)
    if (score > bestScore) {
      bestScore = score
      bestIdx   = i
    }
  }
  return bestIdx
}
