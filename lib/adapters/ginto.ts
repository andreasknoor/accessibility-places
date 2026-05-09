/**
 * Ginto adapter — https://api.ginto.guide/graphql
 * GraphQL API, Bearer-Token auth.
 * Set GINTO_API_KEY in .env.local (contact support@ginto.guide).
 * Coverage: Switzerland (CH) only.
 */
import type { Place, SearchParams, A11yValue, Category } from "../types"
import { buildAttribute } from "../matching/merge"
import { RELIABILITY_WEIGHTS, GINTO_LEVEL2_WEIGHT } from "../config"
import { nanoid } from "../utils"

const ENDPOINT   = "https://api.ginto.guide/graphql"
const MAX_PAGES  = 2   // cap at 100 results to limit API calls

// ─── Category mapping ─────────────────────────────────────────────────────

// Our Category → Ginto category key (multiple of ours may share one Ginto key)
const TO_GINTO: Partial<Record<Category, string>> = {
  cafe:        "restaurant",
  restaurant:  "restaurant",
  bar:         "restaurant",
  pub:         "restaurant",
  biergarten:  "restaurant",
  fast_food:   "restaurant",
  ice_cream:   "restaurant",
  hotel:       "hotel",
  hostel:      "group_house",
  apartment:   "holiday_home",
  museum:      "museum",
  gallery:     "museum",
  theater:     "theatre",
  cinema:      "cinema",
  library:     "library",
  attraction:  "landmark",
}

// Ginto category key → our Category (best-fit)
const FROM_GINTO: Record<string, Category> = {
  restaurant:   "restaurant",
  hotel:        "hotel",
  group_house:  "hostel",
  holiday_home: "apartment",
  museum:       "museum",
  theatre:      "theater",
  cinema:       "cinema",
  library:      "library",
  landmark:     "attraction",
  zoo:          "attraction",
  park:         "attraction",
}

// ─── defaultRatings key → A11yValue ──────────────────────────────────────
// Keys follow a consistent prefix convention:
//   (no prefix)  → entrance / general
//   toilet_      → toilet criterion
//   parking_     → parking criterion
// Infix: "completely" → yes, "partially" → limited, "not_" → no

function extractValues(keys: string[]): { entrance: A11yValue; toilet: A11yValue; parking: A11yValue } {
  let entrance: A11yValue = "unknown"
  let toilet:   A11yValue = "unknown"
  let parking:  A11yValue = "unknown"

  for (const key of keys) {
    if (key.startsWith("toilet_") && toilet === "unknown") {
      if (key.includes("completely"))  toilet = "yes"
      else if (key.includes("partially")) toilet = "limited"
      else if (key.includes("not_"))   toilet = "no"
    } else if (key.startsWith("parking_") && parking === "unknown") {
      if (key.includes("completely"))  parking = "yes"
      else if (key.includes("partially")) parking = "limited"
      else if (key.includes("not_"))   parking = "no"
    } else if (entrance === "unknown") {
      if (key === "completely_wheelchair_accessible")     entrance = "yes"
      else if (key === "partially_wheelchair_accessible") entrance = "limited"
      else if (key === "not_wheelchair_accessible")       entrance = "no"
    }
  }

  return { entrance, toilet, parking }
}

// ─── GraphQL query ─────────────────────────────────────────────────────────

const GQL_QUERY = `
  query SearchNearby($lat: Float, $lng: Float, $within: Float, $categories: [String!], $first: Int, $after: String) {
    entriesBySearch(lat: $lat, lng: $lng, within: $within, categories: $categories, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        entryId
        name
        categories { key }
        position { lat lng street housenumber postcode city countryCode }
        accessibilityInfo { defaultRatings { key } }
        publication { linkUrl }
        updatedAt
        qualityInfo { detailLevels }
      }
    }
  }
`.trim()

interface GintoNode {
  entryId:         string
  name:            string
  categories:      { key: string }[]
  position:        { lat: number; lng: number; street?: string; housenumber?: string; postcode?: string; city?: string; countryCode?: string }
  accessibilityInfo: { defaultRatings: { key: string }[] }
  publication:     { linkUrl?: string }
  updatedAt:       string
  qualityInfo:     { detailLevels: string[] }
}

async function fetchPage(
  apiKey: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ nodes: GintoNode[]; hasNextPage: boolean; endCursor: string | null }> {
  const res = await fetch(ENDPOINT, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Accept":        "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "Accept-Language": "de",
    },
    body:   JSON.stringify({ query: GQL_QUERY, variables }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  })

  if (!res.ok) throw new Error(`Ginto API error: ${res.status}`)

  const json = await res.json()
  if (json.errors?.length) throw new Error(`Ginto GraphQL error: ${json.errors[0].message}`)

  const conn = json.data?.entriesBySearch
  if (!conn) throw new Error("Ginto: unexpected response shape")

  return {
    nodes:       conn.nodes ?? [],
    hasNextPage: conn.pageInfo?.hasNextPage ?? false,
    endCursor:   conn.pageInfo?.endCursor ?? null,
  }
}

// ─── Main fetch ────────────────────────────────────────────────────────────

export async function fetchGinto(params: SearchParams): Promise<Place[]> {
  const apiKey = process.env.GINTO_API_KEY
  if (!apiKey) throw new Error("GINTO_API_KEY not set")

  // Build Ginto category list from requested categories (deduplicated)
  const gintoCategories = params.categories?.length
    ? [...new Set(params.categories.map((c) => TO_GINTO[c]).filter((g): g is string => Boolean(g)))]
    : undefined   // undefined = no category filter → all entries

  const baseVars = {
    lat:        params.location.lat,
    lng:        params.location.lon,
    within:     params.radiusKm,
    categories: gintoCategories,
    first:      50,
  }

  const allNodes: GintoNode[] = []
  let after: string | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const { nodes, hasNextPage, endCursor } = await fetchPage(
      apiKey,
      after ? { ...baseVars, after } : baseVars,
      params.signal,
    )
    allNodes.push(...nodes)
    if (!hasNextPage || !endCursor) break
    after = endCursor
  }

  return allNodes.map((node) => nodeToPlace(node))
}

const TWO_YEARS_MS = 2 * 365.25 * 24 * 60 * 60 * 1000

function nodeToPlace(node: GintoNode): Place {
  const ratingKeys = node.accessibilityInfo.defaultRatings.map((r) => r.key)
  const { entrance, toilet, parking } = extractValues(ratingKeys)
  const rawValue = ratingKeys[0] ?? "ginto"

  const gintoCategory = node.categories[0]?.key ?? ""
  const category: Category = FROM_GINTO[gintoCategory] ?? "attraction"

  // Weight: LEVEL_2 entries are more thoroughly documented (0.95 vs 0.90).
  // Recently updated entries get a ×1.2 boost (same rule as OSM check_date).
  // When both apply, take the larger effective weight — don't stack.
  const isLevel2           = node.qualityInfo.detailLevels.includes("LEVEL_2")
  const isVerifiedRecently = Date.now() - new Date(node.updatedAt).getTime() < TWO_YEARS_MS
  const level2Weight       = isLevel2 ? GINTO_LEVEL2_WEIGHT : RELIABILITY_WEIGHTS.ginto
  const verifiedWeight     = RELIABILITY_WEIGHTS.ginto * 1.2
  const effectiveWeight    = isVerifiedRecently
    ? Math.max(level2Weight, verifiedWeight)
    : level2Weight
  const weightMultiplier   = effectiveWeight / RELIABILITY_WEIGHTS.ginto

  const attr = (value: A11yValue) =>
    buildAttribute("ginto", value, rawValue, {}, false, weightMultiplier, node.updatedAt, isVerifiedRecently)

  return {
    id:          nanoid(),
    name:        node.name,
    category,
    address: {
      street:      node.position.street      ?? "",
      houseNumber: node.position.housenumber ?? "",
      postalCode:  node.position.postcode    ?? "",
      city:        node.position.city        ?? "",
      country:     (node.position.countryCode ?? "CH") as "CH",
    },
    coordinates:   { lat: node.position.lat, lon: node.position.lng },
    gintoUrl:      node.publication.linkUrl,
    accessibility: {
      entrance: attr(entrance),
      toilet:   attr(toilet),
      parking:  attr(parking),
    },
    overallConfidence: 0,
    primarySource:     "ginto",
    sourceRecords: [{
      sourceId:   "ginto",
      externalId: node.entryId,
      fetchedAt:  new Date().toISOString(),
      metadata: {
        name:        node.name,
        category:    node.categories[0]?.key,
        ratings:     node.accessibilityInfo.defaultRatings.map((r) => r.key),
        city:        node.position.city,
        countryCode: node.position.countryCode,
        linkUrl:     node.publication.linkUrl,
        detailLevels: node.qualityInfo.detailLevels,
        updatedAt:   node.updatedAt,
      },
      raw: node,
    }],
  }
}
