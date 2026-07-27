/**
 * A.Cloud UNIQUE COVERAGE measurement — the decisive metric for the
 * "should we remove A.Cloud entirely?" question.
 *
 * Prior analyses measured A.Cloud's *accuracy* (does it agree with OSM/Google/
 * Ginto). This measures the opposite and more decisive thing: how many A.Cloud
 * places would DISAPPEAR from results entirely if A.Cloud were removed — i.e.
 * places with no counterpart in any OTHER active source. That's the real cost
 * of removal; accuracy is moot for a place no other source knows.
 *
 * Method per location:
 *   - Fetch A.Cloud (real adapter).
 *   - Fetch the other DACH-default sources via their real adapters: OSM + Ginto.
 *     (RfA is active in production but needs a key absent locally — see the
 *     HARD CAVEAT below. Google is OFF by default in DACH, correctly excluded.)
 *   - For each A.Cloud place, findMatch() against the combined OSM+Ginto pool.
 *   - "Unique" = no match. Break unique down into:
 *       · wheelmap-derived whose OSM node is DEAD (410) — not real coverage,
 *         it's a stale ghost the live OSM adapter already drops;
 *       · wheelmap-derived whose node lives but the OSM adapter didn't return
 *         (radius/cap edge case);
 *       · other-dataset places genuinely absent from OSM/Ginto — the real
 *         additive coverage removal would destroy.
 *
 * HARD CAVEAT baked into the report: RfA (Reisen für Alle) is DE-focused,
 * high-quality, and ACTIVE in production but not testable locally. So for DE
 * locations the "unique to A.Cloud" count is an UPPER BOUND — RfA may cover
 * some of them in production. For AT/CH (where RfA is sparse/empty) the number
 * is reliable.
 *
 * Free to run (A.Cloud + Overpass + Ginto). Usage:
 *   npx tsx scripts/analyze-acloud-unique-coverage.ts
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
const RAW_JSON_PATH = join(OUT_DIR, "acloud-unique-coverage-raw.json")
const REPORT_PATH   = join(OUT_DIR, "acloud-unique-coverage-2026-07.md")

type LocationSpec = { key: string; label: string; country: "DE" | "AT" | "CH"; kind: "city" | "rural"; lat: number; lon: number; radiusKm: number }

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

const NEUTRAL_FILTERS = { entrance: false, toilet: false, parking: false, parkingNearby: true, seating: false, onlyVerified: false, acceptUnknown: true }
// Only the sources we actually query here; the adapters read their own flags.
const SOURCES_OSM  = { accessibility_cloud: false, osm: true,  reisen_fuer_alle: false, ginto: false, acceslibre: false, google_places: false }
const SOURCES_GIN  = { accessibility_cloud: false, osm: false, reisen_fuer_alle: false, ginto: true,  acceslibre: false, google_places: false }
const SOURCES_AC   = { accessibility_cloud: true,  osm: false, reisen_fuer_alle: false, ginto: false, acceslibre: false, google_places: false }

// Check whether a dead-looking OSM node is really deleted (HTTP 410) via the
// authoritative OSM API — distinguishes "genuinely gone" from "adapter didn't
// fetch it". Rate-friendly: only called for the small unmatched-wheelmap set.
async function osmNodeStatus(id: number): Promise<"alive" | "gone" | "unknown"> {
  try {
    const res = await fetch(`https://api.openstreetmap.org/api/0.6/node/${id}.json`, {
      headers: { "User-Agent": "AccessiblePlaces/coverage-check" },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 410) return "gone"
    if (res.ok) return "alive"
    return "unknown"
  } catch {
    return "unknown"
  }
}

interface LocationResult {
  spec: LocationSpec
  acloudCount: number
  osmPoolCount: number
  gintoPoolCount: number
  matchedInOthers: number
  unique: number
  uniqueBreakdown: {
    wheelmapDeadNode: number       // unmatched + node confirmed 410 gone
    wheelmapNodeAliveButUnfetched: number // unmatched, node alive — OSM adapter gap
    wheelmapNodeUnknown: number
    otherDatasetGenuinelyUnique: number  // the real additive coverage
  }
  uniqueExamples: Array<{ name: string; kind: string; note: string }>
}

async function main() {
  const { fetchAccessibilityCloud } = await import("../lib/adapters/accessibility-cloud")
  const { fetchOsm } = await import("../lib/adapters/osm")
  const { fetchGinto } = await import("../lib/adapters/ginto")
  const { findMatch } = await import("../lib/matching/match")
  const { ALL_CATEGORIES } = await import("../lib/llm")

  const results: LocationResult[] = []

  for (const spec of LOCATIONS) {
    console.log(`\n=== ${spec.label} (${spec.country}, ${spec.kind}) ===`)
    const base = { query: "", location: { lat: spec.lat, lon: spec.lon }, radiusKm: spec.radiusKm, categories: ALL_CATEGORIES, filters: NEUTRAL_FILTERS, locale: "de" as const }

    const acloud = await fetchAccessibilityCloud({ ...base, sources: SOURCES_AC })
    console.log(`  A.Cloud: ${acloud.length}`)

    let osmPool: Awaited<ReturnType<typeof fetchOsm>>["places"] = []
    try {
      const osmRes = await fetchOsm({ ...base, sources: SOURCES_OSM })
      osmPool = osmRes.places
    } catch (e) { console.warn(`  OSM failed: ${e}`) }
    console.log(`  OSM pool: ${osmPool.length}`)

    let gintoPool: Awaited<ReturnType<typeof fetchGinto>> = []
    try {
      gintoPool = await fetchGinto({ ...base, sources: SOURCES_GIN })
    } catch (e) { console.warn(`  Ginto failed: ${e}`) }
    console.log(`  Ginto pool: ${gintoPool.length}`)

    const pool = [...osmPool, ...gintoPool]

    let matched = 0
    const unmatchedWheelmap: Array<{ name: string; nodeId: number }> = []
    const unmatchedOther: Array<{ name: string }> = []

    for (const place of acloud) {
      const idx = findMatch(pool, place)
      if (idx >= 0) { matched++; continue }
      // unmatched — classify by origin
      const m = place.wheelmapUrl?.match(/\/nodes\/(\d+)/)
      if (m) unmatchedWheelmap.push({ name: place.name, nodeId: Number(m[1]) })
      else unmatchedOther.push({ name: place.name })
    }

    // For unmatched wheelmap-derived, check node liveness (small set only)
    let deadNode = 0, aliveUnfetched = 0, unknownNode = 0
    const uniqueExamples: LocationResult["uniqueExamples"] = []
    for (const w of unmatchedWheelmap) {
      const status = await osmNodeStatus(w.nodeId)
      if (status === "gone") { deadNode++; if (uniqueExamples.length < 6) uniqueExamples.push({ name: w.name, kind: "wheelmap", note: "OSM-Node gelöscht (410) — kein echter Deckungsbeitrag" }) }
      else if (status === "alive") { aliveUnfetched++; if (uniqueExamples.length < 6) uniqueExamples.push({ name: w.name, kind: "wheelmap", note: "OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)" }) }
      else unknownNode++
    }
    for (const o of unmatchedOther) {
      if (uniqueExamples.length < 6) uniqueExamples.push({ name: o.name, kind: "other-dataset", note: "kein OSM/Ginto-Pendant — echter A.Cloud-Alleinbeitrag" })
    }

    const unique = unmatchedWheelmap.length + unmatchedOther.length
    console.log(`  matched in others: ${matched}, unique: ${unique} (davon anderer-Datensatz: ${unmatchedOther.length}, wheelmap-tot: ${deadNode}, wheelmap-lebt: ${aliveUnfetched})`)

    results.push({
      spec,
      acloudCount: acloud.length,
      osmPoolCount: osmPool.length,
      gintoPoolCount: gintoPool.length,
      matchedInOthers: matched,
      unique,
      uniqueBreakdown: {
        wheelmapDeadNode: deadNode,
        wheelmapNodeAliveButUnfetched: aliveUnfetched,
        wheelmapNodeUnknown: unknownNode,
        otherDatasetGenuinelyUnique: unmatchedOther.length,
      },
      uniqueExamples,
    })
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(RAW_JSON_PATH, JSON.stringify(results, null, 2))
  console.log(`\nRaw data written to ${RAW_JSON_PATH}`)
  writeReport(results)
  console.log(`Report written to ${REPORT_PATH}`)
}

function pct(n: number, d: number): string { return d > 0 ? `${((n / d) * 100).toFixed(0)}%` : "–" }

function writeReport(results: LocationResult[]) {
  const lines: string[] = []
  const push = (s: string) => lines.push(s)

  push(`# A.Cloud — Einzigartiger Deckungsbeitrag (${new Date().toISOString().slice(0, 10)})`)
  push("")
  push("Die entscheidende Messung für die Frage \"A.Cloud ganz entfernen?\": Wie viele A.Cloud-Orte würden aus den Ergebnissen KOMPLETT verschwinden, weil keine andere aktive Quelle sie kennt? Genauigkeit ist irrelevant für einen Ort, den sonst niemand listet.")
  push("")
  push("Methode: pro Ort A.Cloud vs. den kombinierten Pool aus OSM + Ginto (echte Adapter, `findMatch`-Logik). Skript: `scripts/analyze-acloud-unique-coverage.ts`. Rohdaten: `docs/analysis/acloud-unique-coverage-raw.json`. Kosten: 0 $.")
  push("")
  push("**HARTE EINSCHRÄNKUNG:** Reisen für Alle (RfA) ist in Produktion aktiv (Gewicht 1.0, DE-fokussiert, hohe Qualität), aber lokal ohne API-Key nicht testbar. Für **DE-Orte** ist die \"einzigartig\"-Zahl daher eine **OBERGRENZE** — RfA könnte einige davon in Produktion abdecken. Für **AT/CH** (RfA dünn/leer) ist die Zahl verlässlich. Google ist im DACH-Standard AUS und daher korrekt ausgeschlossen.")
  push("")

  push("## Pro Ort")
  push("")
  push("| Ort | Land | Typ | A.Cloud | in OSM/Ginto vorhanden | einzigartig | davon echter Alleinbeitrag (anderer Datensatz) | davon tote wheelmap-Node | davon wheelmap lebt |")
  push("|---|---|---|---|---|---|---|---|---|")
  for (const r of results) {
    const b = r.uniqueBreakdown
    push(`| ${r.spec.label} | ${r.spec.country} | ${r.spec.kind} | ${r.acloudCount} | ${pct(r.matchedInOthers, r.acloudCount)} | ${pct(r.unique, r.acloudCount)} | ${b.otherDatasetGenuinelyUnique} | ${b.wheelmapDeadNode} | ${b.wheelmapNodeAliveButUnfetched} |`)
  }
  push("")

  push("## Aggregiert")
  push("")
  const total = results.reduce((s, r) => s + r.acloudCount, 0)
  const matched = results.reduce((s, r) => s + r.matchedInOthers, 0)
  const unique = results.reduce((s, r) => s + r.unique, 0)
  const realUnique = results.reduce((s, r) => s + r.uniqueBreakdown.otherDatasetGenuinelyUnique, 0)
  const dead = results.reduce((s, r) => s + r.uniqueBreakdown.wheelmapDeadNode, 0)
  const alive = results.reduce((s, r) => s + r.uniqueBreakdown.wheelmapNodeAliveButUnfetched, 0)
  const unknown = results.reduce((s, r) => s + r.uniqueBreakdown.wheelmapNodeUnknown, 0)
  push(`- **A.Cloud gesamt:** ${total}`)
  push(`- **bereits in OSM/Ginto vorhanden (redundant):** ${pct(matched, total)} (${matched})`)
  push(`- **einzigartig (kein OSM/Ginto-Pendant):** ${pct(unique, total)} (${unique})`)
  push(`  - davon **echter Alleinbeitrag** (andere lokale Datensätze, ohne Pendant): **${realUnique}** ${realUnique > 0 ? `(${pct(realUnique, total)})` : ""} ← das würde bei Entfernung wirklich verloren gehen`)
  push(`  - davon tote wheelmap-Node (410, ohnehin wertlos): ${dead}`)
  push(`  - davon wheelmap-Node lebt aber vom OSM-Adapter nicht geliefert (Radius/Cap-Randfall): ${alive}`)
  push(`  - davon Node-Status unklar: ${unknown}`)
  push("")

  const deReal = results.filter(r => r.spec.country === "DE").reduce((s, r) => s + r.uniqueBreakdown.otherDatasetGenuinelyUnique, 0)
  const atchReal = results.filter(r => r.spec.country !== "DE").reduce((s, r) => s + r.uniqueBreakdown.otherDatasetGenuinelyUnique, 0)
  push(`**Nach Land (echter Alleinbeitrag):** DE ${deReal} (Obergrenze — RfA ungetestet), AT+CH ${atchReal} (verlässlich).`)
  push("")

  push("## Beispiele für einzigartige A.Cloud-Orte")
  push("")
  for (const r of results) {
    if (r.uniqueExamples.length === 0) continue
    push(`### ${r.spec.label}`)
    for (const ex of r.uniqueExamples) push(`- ${ex.name} [${ex.kind}]: ${ex.note}`)
    push("")
  }

  push("## Interpretation")
  push("")
  push("- **\"redundant\"** = die App würde diesen Ort auch ohne A.Cloud zeigen (via OSM/Ginto). Für diese Orte ist A.Cloud entbehrlich (und laut den Voranalysen im Schnitt veralteter).")
  push("- **\"echter Alleinbeitrag\"** ist die einzige Zahl, die gegen eine Entfernung spricht: Orte, die NUR A.Cloud kennt und die bei Entfernung ersatzlos aus der App verschwänden.")
  push("- Tote wheelmap-Nodes zählen NICHT als Deckungsbeitrag — der Live-OSM-Adapter lässt sie ohnehin weg; A.Cloud hält hier nur eine Leiche warm.")
  push("- RfA-Einschränkung beachten: DE-Alleinbeitrag ist eine Obergrenze; die AT/CH-Zahl ist die belastbare.")

  writeFileSync(REPORT_PATH, lines.join("\n") + "\n")
}

main().catch((err) => { console.error(err); process.exit(1) })
