/**
 * A.Cloud "Wheelmap direct comparison" + data-origin breakdown.
 *
 * Live probing before writing this (see conversation) found two things that
 * reshape the approach vs. the original "call Wheelmap's own API" idea:
 *
 *  1. Wheelmap.org is itself just a UI on OpenStreetMap — every A.Cloud
 *     record whose `wheelmapUrl` points at wheelmap.org/nodes/{ID} has {ID}
 *     as a literal OSM node ID (confirmed live against Berlin/Zürich/Wien).
 *     So the "direct" comparison this is named after is an EXACT node-ID
 *     lookup against OSM — not a separate Wheelmap API integration, and not
 *     the fuzzy name/geo matching the two prior scripts had to rely on.
 *  2. A.Cloud's raw properties carry a stable `sourceId` per record — one
 *     value (`LiBTS67TjmBcXdEmX`) dominates everywhere (83–90% across 3
 *     cities tested), and that's exactly the Wheelmap/OSM dataset; every
 *     other sourceId is a smaller, city-specific local survey/dataset. This
 *     gives a clean two-way split for the "origin" analysis: Wheelmap/OSM-
 *     derived vs. everything else, without needing to resolve dataset names.
 *
 * Runs across the original 12 DACH locations (not just CH — this method's
 * precision makes the country generalisation question moot: it's an exact
 * ID match, not a fuzzy geo/name heuristic, so there's no reason to restrict
 * scope this time).
 *
 * Entirely free (A.Cloud + Overpass, no Google/Ginto calls in this script).
 *
 * Usage: npx tsx scripts/analyze-acloud-wheelmap-origin.ts
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
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

const OUT_DIR       = join(process.cwd(), "docs/analysis")
const RAW_JSON_PATH = join(OUT_DIR, "acloud-wheelmap-origin-raw.json")
const REPORT_PATH   = join(OUT_DIR, "acloud-wheelmap-origin-2026-07.md")

type LocationSpec = { key: string; label: string; country: "DE" | "AT" | "CH"; kind: "city" | "rural"; lat: number; lon: number; radiusKm: number }

// Same 12 locations as the first analysis (docs/analysis/acloud-data-quality-2026-07.md).
const LOCATIONS: LocationSpec[] = [
  { key: "berlin",        label: "Berlin",        country: "DE", kind: "city",  lat: 52.5200, lon: 13.4050, radiusKm: 8 },
  { key: "muenchen",      label: "München",       country: "DE", kind: "city",  lat: 48.1372, lon: 11.5755, radiusKm: 8 },
  { key: "wien",          label: "Wien",          country: "AT", kind: "city",  lat: 48.2082, lon: 16.3738, radiusKm: 8 },
  { key: "graz",          label: "Graz",          country: "AT", kind: "city",  lat: 47.0700, lon: 15.4400, radiusKm: 8 },
  { key: "zuerich",       label: "Zürich",        country: "CH", kind: "city",  lat: 47.3769, lon:  8.5417, radiusKm: 8 },
  { key: "genf",          label: "Genf",          country: "CH", kind: "city",  lat: 46.2044, lon:  6.1432, radiusKm: 8 },
  { key: "bad-berleburg", label: "Bad Berleburg", country: "DE", kind: "rural", lat: 51.0552, lon:  8.3844, radiusKm: 15 },
  { key: "prenzlau",      label: "Prenzlau",      country: "DE", kind: "rural", lat: 53.3167, lon: 13.8667, radiusKm: 15 },
  { key: "lienz",         label: "Lienz",         country: "AT", kind: "rural", lat: 46.8300, lon: 12.7683, radiusKm: 15 },
  { key: "zwettl",        label: "Zwettl",        country: "AT", kind: "rural", lat: 48.6072, lon: 15.1667, radiusKm: 15 },
  { key: "appenzell",     label: "Appenzell",     country: "CH", kind: "rural", lat: 47.3333, lon:  9.4111, radiusKm: 15 },
  { key: "scuol",         label: "Scuol",         country: "CH", kind: "rural", lat: 46.7975, lon: 10.2833, radiusKm: 15 },
]

const NEUTRAL_FILTERS = {
  entrance: false, toilet: false, parking: false, parkingNearby: true,
  seating: false, onlyVerified: false, acceptUnknown: true,
}
const NO_SOURCES = {
  accessibility_cloud: false, osm: false, reisen_fuer_alle: false,
  ginto: false, acceslibre: false, google_places: false,
}

function osmValueOf(raw: string): "yes" | "limited" | "no" | "unknown" {
  if (raw === "yes" || raw === "designated") return "yes"
  if (raw === "limited") return "limited"
  if (raw === "no") return "no"
  return "unknown"
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

// ─── Exact OSM node-ID batch lookup (the actual "Wheelmap direct comparison") ──

type OsmNodeTags = { wheelchairRaw: string; checkDate: string | undefined; exists: true }

async function fetchOsmNodesById(ids: number[]): Promise<Map<number, OsmNodeTags>> {
  const out = new Map<number, OsmNodeTags>()
  if (ids.length === 0) return out
  const query = `[out:json][timeout:25];node(id:${ids.join(",")});out tags;`
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
          console.warn(`  OSM node-lookup ${endpoint} returned HTTP ${res.status} (attempt ${attempt}/4)`)
          if (res.status === 504 || res.status === 429) {
            await new Promise((r2) => setTimeout(r2, attempt * 5000))
            continue
          }
          break
        }
        const json = await res.json()
        for (const el of json.elements ?? []) {
          const tags = el.tags ?? {}
          out.set(el.id, {
            wheelchairRaw: tags.wheelchair ?? "",
            checkDate: tags["check_date:wheelchair"] ?? tags["check_date"],
            exists: true,
          })
        }
        return out
      } catch {
        await new Promise((r2) => setTimeout(r2, attempt * 5000))
      }
    }
  }
  return out
}

// ─── Fuzzy fallback for the "other datasets" group (same technique as the
// prior two scripts) — used only for the non-Wheelmap stratum, to give it a
// comparable (if noisier) agreement number. ─────────────────────────────────

type OsmCandidate = { name: string; lat: number; lon: number; street: string; houseNumber: string; city: string; postalCode: string; wheelchairRaw: string; checkDate: string | undefined }

async function fetchOsmWheelchairTagged(lat: number, lon: number, radiusKm: number): Promise<OsmCandidate[]> {
  const r = radiusKm * 1000
  const query = `[out:json][timeout:25];(node["wheelchair"](around:${r},${lat},${lon});way["wheelchair"](around:${r},${lat},${lon}););out 2000 center tags;`
  const endpoints = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
  for (const endpoint of endpoints) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "AccessiblePlaces/data-quality-analysis (accessibility research script)" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(45_000),
        })
        if (!res.ok) {
          if (res.status === 504 || res.status === 429) { await new Promise((r2) => setTimeout(r2, attempt * 5000)); continue }
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
            name, lat: center.lat, lon: center.lon,
            street: tags["addr:street"] ?? "", houseNumber: tags["addr:housenumber"] ?? "",
            city: tags["addr:city"] ?? "", postalCode: tags["addr:postcode"] ?? "",
            wheelchairRaw: tags.wheelchair ?? "", checkDate: tags["check_date:wheelchair"] ?? tags["check_date"],
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMatchShim(name: string, lat: number, lon: number, addr: { street?: string; houseNumber?: string; city?: string; postalCode?: string } = {}): any {
  return { id: `shim:${name}:${lat}:${lon}`, name, coordinates: { lat, lon }, address: { street: addr.street ?? "", houseNumber: addr.houseNumber ?? "", city: addr.city ?? "", postalCode: addr.postalCode ?? "", country: "" } }
}

interface LocationResult {
  spec: LocationSpec
  acloudCount: number
  wheelmapCount: number
  otherCount: number
  sourceIdBreakdown: Record<string, number> // sourceId -> count (includes the dominant Wheelmap one)
  wheelmap: {
    lookedUp: number
    nodeGone: number // OSM node no longer exists — direct staleness signal
    agree: number
    disagree: number
    checkDateAgeBuckets: Record<string, number>
    disagreementExamples: Array<{ name: string; acloud: string; osm: string; checkDate?: string }>
  }
  other: {
    fuzzyMatched: number
    agree: number
    disagree: number
  }
}

async function main() {
  const { fetchAccessibilityCloud } = await import("../lib/adapters/accessibility-cloud")
  const { findMatch } = await import("../lib/matching/match")
  const { ALL_CATEGORIES } = await import("../lib/llm")

  const results: LocationResult[] = []

  for (const spec of LOCATIONS) {
    console.log(`\n=== ${spec.label} (${spec.country}, ${spec.kind}) ===`)

    const acloud = await fetchAccessibilityCloud({
      query: "", location: { lat: spec.lat, lon: spec.lon }, radiusKm: spec.radiusKm,
      categories: ALL_CATEGORIES, filters: NEUTRAL_FILTERS, sources: NO_SOURCES, locale: "de",
    })
    console.log(`  A.Cloud: ${acloud.length} places`)

    const sourceIdBreakdown: Record<string, number> = {}
    const wheelmapPlaces: Array<{ place: typeof acloud[number]; nodeId: number }> = []
    const otherPlaces: typeof acloud = []

    for (const place of acloud) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = place.sourceRecords[0]?.raw as any
      const sid = raw?.sourceId ?? "unknown"
      sourceIdBreakdown[sid] = (sourceIdBreakdown[sid] ?? 0) + 1

      const m = place.wheelmapUrl?.match(/\/nodes\/(\d+)/)
      if (m) {
        wheelmapPlaces.push({ place, nodeId: Number(m[1]) })
      } else {
        otherPlaces.push(place)
      }
    }
    console.log(`  Wheelmap/OSM-derived: ${wheelmapPlaces.length}, andere Datensätze: ${otherPlaces.length}`)

    // ── Exact node-ID lookup for the Wheelmap group ──
    const nodeIds = wheelmapPlaces.map((w) => w.nodeId)
    const osmNodes = await fetchOsmNodesById(nodeIds)
    console.log(`  OSM-Node-Lookup: ${osmNodes.size}/${nodeIds.length} Nodes gefunden`)

    let lookedUp = 0, nodeGone = 0, wmAgree = 0, wmDisagree = 0
    const checkDateAgeBuckets: Record<string, number> = { none: 0, "<1y": 0, "1-2y": 0, "2-5y": 0, "5y+": 0 }
    const disagreementExamples: LocationResult["wheelmap"]["disagreementExamples"] = []

    for (const { place, nodeId } of wheelmapPlaces) {
      lookedUp++
      const node = osmNodes.get(nodeId)
      if (!node) { nodeGone++; continue }
      checkDateAgeBuckets[bucketAge(node.checkDate)]++
      const acloudVal = place.accessibility.entrance.value
      const osmVal = osmValueOf(node.wheelchairRaw)
      if (acloudVal === "unknown" || osmVal === "unknown") continue
      if (acloudVal === osmVal) wmAgree++
      else {
        wmDisagree++
        if (disagreementExamples.length < 5) {
          disagreementExamples.push({ name: place.name, acloud: acloudVal, osm: osmVal, checkDate: node.checkDate })
        }
      }
    }
    console.log(`  Wheelmap-Direktabgleich: gone=${nodeGone}, agree=${wmAgree}, disagree=${wmDisagree}`)

    // ── Fuzzy comparison for the "other datasets" group ──
    const osmCandidates = otherPlaces.length > 0 ? await fetchOsmWheelchairTagged(spec.lat, spec.lon, spec.radiusKm) : []
    const osmShims = osmCandidates.map((c) => toMatchShim(c.name, c.lat, c.lon, c))
    let otherMatched = 0, otherAgree = 0, otherDisagree = 0
    for (const place of otherPlaces) {
      const idx = findMatch(osmShims, place as unknown as Parameters<typeof findMatch>[1])
      if (idx < 0) continue
      otherMatched++
      const acloudVal = place.accessibility.entrance.value
      const osmVal = osmValueOf(osmCandidates[idx].wheelchairRaw)
      if (acloudVal === "unknown" || osmVal === "unknown") continue
      if (acloudVal === osmVal) otherAgree++; else otherDisagree++
    }
    console.log(`  Andere Datensätze (Fuzzy-Vergleich): matched=${otherMatched}, agree=${otherAgree}, disagree=${otherDisagree}`)

    results.push({
      spec,
      acloudCount: acloud.length,
      wheelmapCount: wheelmapPlaces.length,
      otherCount: otherPlaces.length,
      sourceIdBreakdown,
      wheelmap: { lookedUp, nodeGone, agree: wmAgree, disagree: wmDisagree, checkDateAgeBuckets, disagreementExamples },
      other: { fuzzyMatched: otherMatched, agree: otherAgree, disagree: otherDisagree },
    })
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(RAW_JSON_PATH, JSON.stringify(results, null, 2))
  console.log(`\nRaw data written to ${RAW_JSON_PATH}`)

  writeReport(results)
  console.log(`Report written to ${REPORT_PATH}`)
}

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(0)}%` : "–"
}

function writeReport(results: LocationResult[]) {
  const lines: string[] = []
  const push = (s: string) => lines.push(s)

  push(`# A.Cloud — Wheelmap-Direktabgleich + Herkunftsanalyse (${new Date().toISOString().slice(0, 10)})`)
  push("")
  push("Follow-up zu den beiden vorherigen A.Cloud-Analysen. Nutzt, dass Wheelmap.org selbst nur eine Oberfläche auf OpenStreetMap ist — `wheelmapUrl` zeigt auf eine echte OSM-Node-ID, die sich EXAKT abfragen lässt (kein Fuzzy-Matching, keine Namens-/Geo-Unschärfe). Zusätzlich: Aufschlüsselung nach A.Cloud's eigenem `sourceId`-Feld (Herkunfts-Datensatz).")
  push("")
  push(`12 Orte (dieselben wie in der ersten Analyse, DE+AT+CH, Großstadt+ländlich). Skript: \`scripts/analyze-acloud-wheelmap-origin.ts\`. Rohdaten: \`docs/analysis/acloud-wheelmap-origin-raw.json\`. Kosten: 0 $.`)
  push("")

  push("## Pro Ort — Herkunft")
  push("")
  push("| Ort | Land | A.Cloud gesamt | Wheelmap/OSM-Anteil | Andere Datensätze | Distinkte sourceIds |")
  push("|---|---|---|---|---|---|")
  for (const r of results) {
    push(`| ${r.spec.label} | ${r.spec.country} | ${r.acloudCount} | ${pct(r.wheelmapCount, r.acloudCount)} | ${pct(r.otherCount, r.acloudCount)} | ${Object.keys(r.sourceIdBreakdown).length} |`)
  }
  push("")

  push("## Pro Ort — Direktabgleich (Wheelmap/OSM-Anteil) vs. Fuzzy-Vergleich (andere Datensätze)")
  push("")
  push("| Ort | OSM-Node noch vorhanden | Direktabgleich-Übereinstimmung | Andere: Match-Rate | Andere: Übereinstimmung |")
  push("|---|---|---|---|---|")
  for (const r of results) {
    const wmTotal = r.wheelmap.agree + r.wheelmap.disagree
    const otherTotal = r.other.agree + r.other.disagree
    push(`| ${r.spec.label} | ${pct(r.wheelmap.lookedUp - r.wheelmap.nodeGone, r.wheelmap.lookedUp)} | ${pct(r.wheelmap.agree, wmTotal)} | ${pct(r.other.fuzzyMatched, r.otherCount)} | ${pct(r.other.agree, otherTotal)} |`)
  }
  push("")

  push("## Aggregiert")
  push("")
  const totalAcloud = results.reduce((s, r) => s + r.acloudCount, 0)
  const totalWheelmap = results.reduce((s, r) => s + r.wheelmapCount, 0)
  const totalOther = results.reduce((s, r) => s + r.otherCount, 0)
  const totalLookedUp = results.reduce((s, r) => s + r.wheelmap.lookedUp, 0)
  const totalGone = results.reduce((s, r) => s + r.wheelmap.nodeGone, 0)
  const totalWmAgree = results.reduce((s, r) => s + r.wheelmap.agree, 0)
  const totalWmDisagree = results.reduce((s, r) => s + r.wheelmap.disagree, 0)
  const totalOtherAgree = results.reduce((s, r) => s + r.other.agree, 0)
  const totalOtherDisagree = results.reduce((s, r) => s + r.other.disagree, 0)
  push(`- **A.Cloud-Treffer gesamt:** ${totalAcloud}`)
  push(`- **Wheelmap/OSM-Anteil:** ${pct(totalWheelmap, totalAcloud)} (${totalWheelmap})`)
  push(`- **Andere Datensätze-Anteil:** ${pct(totalOther, totalAcloud)} (${totalOther})`)
  push(`- **OSM-Node nicht mehr vorhanden** (von A.Cloud referenziert, aber bei OSM gelöscht): ${pct(totalGone, totalLookedUp)} (${totalGone}/${totalLookedUp})`)
  push(`- **Direktabgleich-Übereinstimmung (Wheelmap/OSM-Anteil, exakte Node-ID):** ${pct(totalWmAgree, totalWmAgree + totalWmDisagree)} (${totalWmAgree}/${totalWmAgree + totalWmDisagree})`)
  push(`- **Übereinstimmung andere Datensätze (Fuzzy-Vergleich):** ${pct(totalOtherAgree, totalOtherAgree + totalOtherDisagree)} (${totalOtherAgree}/${totalOtherAgree + totalOtherDisagree})`)
  push("")

  push("## check_date-Altersverteilung — nur Wheelmap/OSM-Anteil, exakt zugeordnet")
  push("")
  const ageBuckets = ["none", "<1y", "1-2y", "2-5y", "5y+"]
  push("| Alter | Anzahl |")
  push("|---|---|")
  for (const b of ageBuckets) {
    const total = results.reduce((s, r) => s + (r.wheelmap.checkDateAgeBuckets[b] ?? 0), 0)
    push(`| ${b} | ${total} |`)
  }
  push("")

  push("## Häufigste \"andere\" sourceIds (über alle Orte)")
  push("")
  const sourceIdTotals = new Map<string, number>()
  for (const r of results) {
    for (const [sid, count] of Object.entries(r.sourceIdBreakdown)) {
      sourceIdTotals.set(sid, (sourceIdTotals.get(sid) ?? 0) + count)
    }
  }
  const sorted = [...sourceIdTotals.entries()].sort((a, b) => b[1] - a[1])
  push("| sourceId | Gesamtanzahl | Vermutlich |")
  push("|---|---|---|")
  for (const [sid, count] of sorted.slice(0, 15)) {
    const guess = count / totalAcloud > 0.3 ? "Wheelmap/OSM (dominant, überall vertreten)" : "lokaler/regionaler Einzeldatensatz"
    push(`| \`${sid}\` | ${count} | ${guess} |`)
  }
  push("")

  push("## Beispiele: Direktabgleich-Abweichungen (max. 5 pro Ort)")
  push("")
  for (const r of results) {
    if (r.wheelmap.disagreementExamples.length === 0) continue
    push(`### ${r.spec.label}`)
    for (const ex of r.wheelmap.disagreementExamples) {
      push(`- ${ex.name}: A.Cloud=${ex.acloud}, OSM (exakte Node)=${ex.osm}${ex.checkDate ? ` (check_date: ${ex.checkDate})` : " (kein check_date)"}`)
    }
    push("")
  }

  push("## Methodische Hinweise")
  push("")
  push("- Der \"Wheelmap-Direktabgleich\" ist technisch eine exakte OSM-Node-ID-Abfrage, keine separate Wheelmap-API-Anbindung — Wheelmap ist selbst nur eine Oberfläche auf OSM, `wheelmapUrl` enthält die OSM-Node-ID direkt in der URL.")
  push("- Dieser Abgleich hat KEIN Matching-Rauschen (anders als die vorherigen Analysen) — jede Abweichung ist eine echte Abweichung zwischen genau demselben referenzierten Datensatz zu zwei Zeitpunkten, kein Zuordnungsfehler.")
  push("- \"OSM-Node nicht mehr vorhanden\" ist das härteste Einzelsignal in dieser Analyse: A.Cloud referenziert einen Datensatz, der bei OSM inzwischen gelöscht/zusammengeführt wurde.")
  push("- Die \"andere Datensätze\"-Gruppe nutzt weiterhin Fuzzy-Matching (keine exakte ID verfügbar) — direkt vergleichbar mit der Methode der ersten Analyse.")
  push("- `sourceId`-Werte sind opak (keine auflösbaren Namen über die öffentliche API) — Herkunft wird über Konzentration/Streuung eingeschätzt, nicht über echte Datensatz-Namen.")

  writeFileSync(REPORT_PATH, lines.join("\n") + "\n")
}

main().catch((err) => { console.error(err); process.exit(1) })
