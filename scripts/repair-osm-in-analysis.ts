/**
 * One-off repair: re-fetches ONLY the OSM cross-reference for locations where
 * scripts/analyze-acloud-data-quality.ts's OSM query failed (HTTP 406 — a
 * missing User-Agent, now fixed there too — or transient 504/429 under load).
 * Does NOT touch Google data (already paid for, real cost) — only re-does the
 * free A.Cloud + OSM fetch for the broken locations and patches the existing
 * raw JSON + regenerates the report.
 *
 * Usage: npx tsx scripts/repair-osm-in-analysis.ts
 */
import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"

const envPath = join(process.cwd(), ".env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
    if (key && !(key in process.env)) process.env[key] = val
  }
}

const RAW_JSON_PATH = join(process.cwd(), "docs/analysis/acloud-data-quality-raw.json")

const NEUTRAL_FILTERS = {
  entrance: false, toilet: false, parking: false, parkingNearby: true,
  seating: false, onlyVerified: false, acceptUnknown: true,
}
const NO_SOURCES = {
  accessibility_cloud: false, osm: false, reisen_fuer_alle: false,
  ginto: false, acceslibre: false, google_places: false,
}

type OsmCandidate = {
  name: string; lat: number; lon: number
  street: string; houseNumber: string; city: string; postalCode: string
  wheelchairRaw: string; toiletRaw: string; checkDate: string | undefined
}

async function fetchOsmWheelchairTagged(lat: number, lon: number, radiusKm: number): Promise<OsmCandidate[]> {
  const r = radiusKm * 1000
  const query = `[out:json][timeout:25];(node["wheelchair"](around:${r},${lat},${lon});way["wheelchair"](around:${r},${lat},${lon}););out 2000 center tags;`
  const endpoints = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]

  for (const endpoint of endpoints) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "AccessiblePlaces/data-quality-analysis (accessibility research script)",
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(45_000),
        })
        if (!res.ok) {
          console.warn(`  OSM endpoint ${endpoint} returned HTTP ${res.status} (attempt ${attempt}/4)`)
          if (res.status === 504 || res.status === 429) {
            await new Promise((r2) => setTimeout(r2, attempt * 5000))
            continue
          }
          break
        }
        const json = await res.json()
        const out: OsmCandidate[] = []
        for (const el of json.elements ?? []) {
          const tags = el.tags ?? {}
          const name = tags.name
          if (!name) continue
          const center = el.type === "node" ? { lat: el.lat, lon: el.lon } : el.center
          if (!center) continue
          out.push({
            name,
            lat: center.lat, lon: center.lon,
            street: tags["addr:street"] ?? "", houseNumber: tags["addr:housenumber"] ?? "",
            city: tags["addr:city"] ?? "", postalCode: tags["addr:postcode"] ?? "",
            wheelchairRaw: tags.wheelchair ?? "",
            toiletRaw: tags["toilets:wheelchair"] ?? "",
            checkDate: tags["check_date:wheelchair"] ?? tags["check_date"],
          })
        }
        return out
      } catch {
        await new Promise((r2) => setTimeout(r2, attempt * 5000))
      }
    }
  }
  return []
}

function osmValueOf(raw: string): "yes" | "limited" | "no" | "unknown" {
  if (raw === "yes" || raw === "designated") return "yes"
  if (raw === "limited") return "limited"
  if (raw === "no") return "no"
  return "unknown"
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMatchShim(name: string, lat: number, lon: number, addr: { street?: string; houseNumber?: string; city?: string; postalCode?: string } = {}): any {
  return {
    id: `shim:${name}:${lat}:${lon}`,
    name,
    coordinates: { lat, lon },
    address: {
      street: addr.street ?? "", houseNumber: addr.houseNumber ?? "",
      city: addr.city ?? "", postalCode: addr.postalCode ?? "", country: "",
    },
  }
}

function bucketAge(checkDate: string | undefined): string {
  if (!checkDate) return "none"
  const t = Date.parse(checkDate)
  if (Number.isNaN(t)) return "none"
  const years = (Date.now() - t) / (365.25 * 24 * 3600 * 1000)
  if (years < 1) return "<1y"
  if (years < 2) return "1-2y"
  if (years < 5) return "2-5y"
  return "5y+"
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: any[] = JSON.parse(readFileSync(RAW_JSON_PATH, "utf-8"))
  const broken = results.filter((r) => r.osm.candidateCount === 0)
  console.log(`Repairing OSM data for ${broken.length} location(s): ${broken.map((r) => r.spec.label).join(", ")}`)

  const { fetchAccessibilityCloud } = await import("../lib/adapters/accessibility-cloud")
  const { findMatch } = await import("../lib/matching/match")
  const { ALL_CATEGORIES } = await import("../lib/llm")

  for (const entry of broken) {
    const spec = entry.spec
    console.log(`\n=== Repairing ${spec.label} ===`)

    const acloud = await fetchAccessibilityCloud({
      query: "", location: { lat: spec.lat, lon: spec.lon }, radiusKm: spec.radiusKm,
      categories: ALL_CATEGORIES, filters: NEUTRAL_FILTERS, sources: NO_SOURCES, locale: "de",
    })

    const osmCandidates = await fetchOsmWheelchairTagged(spec.lat, spec.lon, spec.radiusKm)
    console.log(`  OSM (wheelchair-tagged): ${osmCandidates.length} candidates`)
    const osmShims = osmCandidates.map((c) => toMatchShim(c.name, c.lat, c.lon, c))

    let osmMatched = 0, osmAgree = 0, osmDisagree = 0
    const checkDateAgeBuckets: Record<string, number> = { none: 0, "<1y": 0, "1-2y": 0, "2-5y": 0, "5y+": 0 }
    const disagreementExamples: Array<{ name: string; acloud: string; osm: string; checkDate?: string }> = []

    for (const place of acloud) {
      const idx = findMatch(osmShims, place as unknown as Parameters<typeof findMatch>[1])
      if (idx < 0) continue
      osmMatched++
      const osm = osmCandidates[idx]
      const bucket = bucketAge(osm.checkDate)
      checkDateAgeBuckets[bucket] = (checkDateAgeBuckets[bucket] ?? 0) + 1

      const acloudVal = place.accessibility.entrance.value
      const osmVal = osmValueOf(osm.wheelchairRaw)
      if (acloudVal === "unknown" || osmVal === "unknown") continue
      if (acloudVal === osmVal) {
        osmAgree++
      } else {
        osmDisagree++
        if (disagreementExamples.length < 5) {
          disagreementExamples.push({ name: place.name, acloud: acloudVal, osm: osmVal, checkDate: osm.checkDate })
        }
      }
    }

    entry.osm = {
      candidateCount: osmCandidates.length,
      matchedCount: osmMatched,
      agreement: { entrance: osmAgree, disagreement: osmDisagree },
      checkDateAgeBuckets,
      disagreementExamples,
    }
    console.log(`  Matched: ${osmMatched}, agree: ${osmAgree}, disagree: ${osmDisagree}`)
  }

  writeFileSync(RAW_JSON_PATH, JSON.stringify(results, null, 2))
  console.log(`\nPatched raw JSON written to ${RAW_JSON_PATH}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
