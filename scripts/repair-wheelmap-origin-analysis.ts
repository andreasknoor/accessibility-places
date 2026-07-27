/**
 * Repairs the "andere Datensätze" (non-Wheelmap) fuzzy comparison for
 * locations where analyze-acloud-wheelmap-origin.ts's area-wide OSM fetch
 * silently returned zero candidates (Overpass rate-limited right after the
 * node-ID lookup query hit the same endpoint). Patches only the `other`
 * field for affected locations — does not touch the (already verified)
 * Wheelmap direct-comparison data.
 *
 * Usage: npx tsx scripts/repair-wheelmap-origin-analysis.ts
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

const RAW_JSON_PATH = join(process.cwd(), "docs/analysis/acloud-wheelmap-origin-raw.json")

const NEUTRAL_FILTERS = { entrance: false, toilet: false, parking: false, parkingNearby: true, seating: false, onlyVerified: false, acceptUnknown: true }
const NO_SOURCES = { accessibility_cloud: false, osm: false, reisen_fuer_alle: false, ginto: false, acceslibre: false, google_places: false }

type OsmCandidate = { name: string; lat: number; lon: number; street: string; houseNumber: string; city: string; postalCode: string; wheelchairRaw: string }

async function fetchOsmWheelchairTagged(lat: number, lon: number, radiusKm: number): Promise<OsmCandidate[]> {
  const r = radiusKm * 1000
  const query = `[out:json][timeout:25];(node["wheelchair"](around:${r},${lat},${lon});way["wheelchair"](around:${r},${lat},${lon}););out 2000 center tags;`
  const endpoints = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
  for (const endpoint of endpoints) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "AccessiblePlaces/data-quality-analysis (accessibility research script)" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(45_000),
        })
        if (!res.ok) {
          console.warn(`    HTTP ${res.status} (attempt ${attempt}/5)`)
          if (res.status === 504 || res.status === 429) { await new Promise((r2) => setTimeout(r2, attempt * 6000)); continue }
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
          out.push({ name, lat: center.lat, lon: center.lon, street: tags["addr:street"] ?? "", houseNumber: tags["addr:housenumber"] ?? "", city: tags["addr:city"] ?? "", postalCode: tags["addr:postcode"] ?? "", wheelchairRaw: tags.wheelchair ?? "" })
        }
        return out
      } catch {
        await new Promise((r2) => setTimeout(r2, attempt * 6000))
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
  return { id: `shim:${name}:${lat}:${lon}`, name, coordinates: { lat, lon }, address: { street: addr.street ?? "", houseNumber: addr.houseNumber ?? "", city: addr.city ?? "", postalCode: addr.postalCode ?? "", country: "" } }
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: any[] = JSON.parse(readFileSync(RAW_JSON_PATH, "utf-8"))
  const broken = results.filter((r) => r.otherCount > 0 && r.other.fuzzyMatched === 0)
  console.log(`Repairing "andere Datensätze" for ${broken.length} location(s): ${broken.map((r) => r.spec.label).join(", ")}`)

  const { fetchAccessibilityCloud } = await import("../lib/adapters/accessibility-cloud")
  const { findMatch } = await import("../lib/matching/match")
  const { ALL_CATEGORIES } = await import("../lib/llm")

  for (const entry of broken) {
    const spec = entry.spec
    console.log(`\n=== ${spec.label} ===`)

    const acloud = await fetchAccessibilityCloud({
      query: "", location: { lat: spec.lat, lon: spec.lon }, radiusKm: spec.radiusKm,
      categories: ALL_CATEGORIES, filters: NEUTRAL_FILTERS, sources: NO_SOURCES, locale: "de",
    })
    const otherPlaces = acloud.filter((p) => !p.wheelmapUrl?.match(/\/nodes\/\d+/))
    console.log(`  andere Datensätze (re-derived): ${otherPlaces.length}`)

    const osmCandidates = await fetchOsmWheelchairTagged(spec.lat, spec.lon, spec.radiusKm)
    console.log(`  OSM-Kandidaten: ${osmCandidates.length}`)
    const osmShims = osmCandidates.map((c) => toMatchShim(c.name, c.lat, c.lon, c))

    let matched = 0, agree = 0, disagree = 0
    for (const place of otherPlaces) {
      const idx = findMatch(osmShims, place as unknown as Parameters<typeof findMatch>[1])
      if (idx < 0) continue
      matched++
      const acloudVal = place.accessibility.entrance.value
      const osmVal = osmValueOf(osmCandidates[idx].wheelchairRaw)
      if (acloudVal === "unknown" || osmVal === "unknown") continue
      if (acloudVal === osmVal) agree++; else disagree++
    }
    console.log(`  matched=${matched} agree=${agree} disagree=${disagree}`)

    entry.other = { fuzzyMatched: matched, agree, disagree }
  }

  writeFileSync(RAW_JSON_PATH, JSON.stringify(results, null, 2))
  console.log(`\nPatched raw JSON written to ${RAW_JSON_PATH}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
