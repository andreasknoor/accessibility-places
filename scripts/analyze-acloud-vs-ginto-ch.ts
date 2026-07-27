/**
 * A.Cloud vs. Ginto-AUDITED data-quality analysis, Switzerland only.
 *
 * Follow-up to scripts/analyze-acloud-data-quality.ts — that run's Google
 * comparison was directionally ambiguous (Google is itself low-trust, 0.35),
 * so this uses Ginto's AUDITED tier (qualityInfo.approvalLevels, the
 * project's own highest-trust signal, GINTO_AUDITED_WEIGHT = 1.0) as a
 * stronger ground truth instead. SELF_DECLARED Ginto entries are reported
 * separately for context, never treated as ground truth (same epistemic
 * status as A.Cloud itself — operator-reported, not externally verified).
 * OSM (wheelchair-tag check_date) stays in as a free third, independent
 * voice, enabling 2-vs-1 outlier resolution where all three overlap.
 *
 * Entirely free to run — A.Cloud, Ginto, and OSM all use existing API keys
 * with no per-request billing (unlike the prior Google comparison).
 *
 * Usage: npx tsx scripts/analyze-acloud-vs-ginto-ch.ts
 *
 * Scope caveat (see report): RELIABILITY_WEIGHTS.accessibility_cloud is not
 * country-specific — a CH-only finding here only generalises to the global
 * weight under the assumption that A.Cloud's CH data quality is
 * representative of its data quality elsewhere too.
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
const RAW_JSON_PATH = join(OUT_DIR, "acloud-vs-ginto-ch-raw.json")
const REPORT_PATH   = join(OUT_DIR, "acloud-vs-ginto-ch-2026-07.md")

type LocationSpec = { key: string; label: string; kind: "city" | "rural"; lat: number; lon: number; radiusKm: number }

const LOCATIONS: LocationSpec[] = [
  { key: "zuerich",     label: "Zürich",     kind: "city",  lat: 47.3768, lon:  8.5417, radiusKm: 8 },
  { key: "basel",       label: "Basel",      kind: "city",  lat: 47.5576, lon:  7.5923, radiusKm: 8 },
  { key: "bern",        label: "Bern",       kind: "city",  lat: 46.9480, lon:  7.4474, radiusKm: 8 },
  { key: "genf",        label: "Genf",       kind: "city",  lat: 46.2044, lon:  6.1432, radiusKm: 8 },
  { key: "lausanne",    label: "Lausanne",   kind: "city",  lat: 46.5197, lon:  6.6323, radiusKm: 8 },
  { key: "luzern",      label: "Luzern",     kind: "city",  lat: 47.0502, lon:  8.3093, radiusKm: 8 },
  { key: "winterthur",  label: "Winterthur", kind: "city",  lat: 47.5001, lon:  8.7238, radiusKm: 8 },
  { key: "appenzell",   label: "Appenzell",  kind: "rural", lat: 47.3333, lon:  9.4111, radiusKm: 15 },
  { key: "scuol",       label: "Scuol",      kind: "rural", lat: 46.7975, lon: 10.2833, radiusKm: 15 },
  { key: "poschiavo",   label: "Poschiavo",  kind: "rural", lat: 46.3167, lon: 10.0667, radiusKm: 15 },
  { key: "sarnen",      label: "Sarnen",     kind: "rural", lat: 46.8958, lon:  8.2472, radiusKm: 15 },
]

const NEUTRAL_FILTERS = {
  entrance: false, toilet: false, parking: false, parkingNearby: true,
  seating: false, onlyVerified: false, acceptUnknown: true,
}
const NO_SOURCES = {
  accessibility_cloud: false, osm: false, reisen_fuer_alle: false,
  ginto: false, acceslibre: false, google_places: false,
}

// ─── OSM wheelchair-tagged fetch (same as the repaired version in the prior
// script — retries on 504/429, User-Agent required by Overpass). ───────────

type OsmCandidate = {
  name: string; lat: number; lon: number
  street: string; houseNumber: string; city: string; postalCode: string
  wheelchairRaw: string; checkDate: string | undefined
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
            name, lat: center.lat, lon: center.lon,
            street: tags["addr:street"] ?? "", houseNumber: tags["addr:housenumber"] ?? "",
            city: tags["addr:city"] ?? "", postalCode: tags["addr:postcode"] ?? "",
            wheelchairRaw: tags.wheelchair ?? "",
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
    id: `shim:${name}:${lat}:${lon}`, name, coordinates: { lat, lon },
    address: { street: addr.street ?? "", houseNumber: addr.houseNumber ?? "", city: addr.city ?? "", postalCode: addr.postalCode ?? "", country: "" },
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

// ─── Per-location result shape ──────────────────────────────────────────────

interface LocationResult {
  spec: LocationSpec
  acloudCount: number
  gintoAuditedCount: number
  gintoSelfDeclaredCount: number
  osmCandidateCount: number
  auditedMatch: { matched: number; agree: number; disagree: number }
  selfDeclaredMatch: { matched: number; agree: number; disagree: number }
  osmMatch: { matched: number; agree: number; disagree: number; checkDateAgeBuckets: Record<string, number> }
  triangulation: { allAgree: number; acloudOutlier: number; osmOutlier: number; gintoOutlier: number; allDiffer: number }
  auditedDisagreementExamples: Array<{ name: string; acloud: string; ginto: string; updatedAt?: string }>
}

async function main() {
  const { fetchAccessibilityCloud } = await import("../lib/adapters/accessibility-cloud")
  const { fetchGinto } = await import("../lib/adapters/ginto")
  const { findMatch } = await import("../lib/matching/match")
  const { ALL_CATEGORIES } = await import("../lib/llm")

  const results: LocationResult[] = []

  for (const spec of LOCATIONS) {
    console.log(`\n=== ${spec.label} (${spec.kind}) ===`)

    const acloud = await fetchAccessibilityCloud({
      query: "", location: { lat: spec.lat, lon: spec.lon }, radiusKm: spec.radiusKm,
      categories: ALL_CATEGORIES, filters: NEUTRAL_FILTERS, sources: NO_SOURCES, locale: "de",
    })
    console.log(`  A.Cloud: ${acloud.length} places`)

    const ginto = await fetchGinto({
      query: "", location: { lat: spec.lat, lon: spec.lon }, radiusKm: spec.radiusKm,
      categories: ALL_CATEGORIES, filters: NEUTRAL_FILTERS, sources: NO_SOURCES, locale: "de",
    })
    const gintoAudited = ginto.filter((p) =>
      (p.sourceRecords[0]?.metadata as { approvalLevels?: string[] } | undefined)?.approvalLevels?.includes("AUDITED"))
    const gintoSelfDeclared = ginto.filter((p) =>
      !(p.sourceRecords[0]?.metadata as { approvalLevels?: string[] } | undefined)?.approvalLevels?.includes("AUDITED") &&
      (p.sourceRecords[0]?.metadata as { approvalLevels?: string[] } | undefined)?.approvalLevels?.includes("SELF_DECLARED"))
    console.log(`  Ginto: ${ginto.length} total (${gintoAudited.length} AUDITED, ${gintoSelfDeclared.length} SELF_DECLARED)`)

    const osmCandidates = await fetchOsmWheelchairTagged(spec.lat, spec.lon, spec.radiusKm)
    console.log(`  OSM (wheelchair-tagged): ${osmCandidates.length} candidates`)
    const osmShims = osmCandidates.map((c) => toMatchShim(c.name, c.lat, c.lon, c))

    // ── A.Cloud vs. Ginto AUDITED ──
    let auditedMatched = 0, auditedAgree = 0, auditedDisagree = 0
    const auditedDisagreementExamples: LocationResult["auditedDisagreementExamples"] = []
    // ── A.Cloud vs. Ginto SELF_DECLARED (context only) ──
    let sdMatched = 0, sdAgree = 0, sdDisagree = 0
    // ── A.Cloud vs. OSM ──
    let osmMatched = 0, osmAgree = 0, osmDisagree = 0
    const checkDateAgeBuckets: Record<string, number> = { none: 0, "<1y": 0, "1-2y": 0, "2-5y": 0, "5y+": 0 }
    // ── Triangulation (all three present) ──
    let allAgree = 0, acloudOutlier = 0, osmOutlier = 0, gintoOutlier = 0, allDiffer = 0

    for (const place of acloud) {
      const acloudVal = place.accessibility.entrance.value

      const auditedIdx = findMatch(gintoAudited, place)
      let gintoAuditedVal: string | null = null
      if (auditedIdx >= 0) {
        auditedMatched++
        gintoAuditedVal = gintoAudited[auditedIdx].accessibility.entrance.value
        if (acloudVal !== "unknown" && gintoAuditedVal !== "unknown") {
          if (acloudVal === gintoAuditedVal) auditedAgree++
          else {
            auditedDisagree++
            if (auditedDisagreementExamples.length < 5) {
              const updatedAt = (gintoAudited[auditedIdx].sourceRecords[0]?.metadata as { updatedAt?: string } | undefined)?.updatedAt
              auditedDisagreementExamples.push({ name: place.name, acloud: acloudVal, ginto: gintoAuditedVal, updatedAt })
            }
          }
        }
      }

      const sdIdx = findMatch(gintoSelfDeclared, place)
      if (sdIdx >= 0) {
        sdMatched++
        const sdVal = gintoSelfDeclared[sdIdx].accessibility.entrance.value
        if (acloudVal !== "unknown" && sdVal !== "unknown") {
          if (acloudVal === sdVal) sdAgree++; else sdDisagree++
        }
      }

      const osmIdx = findMatch(osmShims, place as unknown as Parameters<typeof findMatch>[1])
      let osmVal: string | null = null
      if (osmIdx >= 0) {
        osmMatched++
        const osm = osmCandidates[osmIdx]
        osmVal = osmValueOf(osm.wheelchairRaw)
        checkDateAgeBuckets[bucketAge(osm.checkDate)]++
        if (acloudVal !== "unknown" && osmVal !== "unknown") {
          if (acloudVal === osmVal) osmAgree++; else osmDisagree++
        }
      }

      // Triangulation: only when all three are present and known
      if (gintoAuditedVal && gintoAuditedVal !== "unknown" && osmVal && osmVal !== "unknown" && acloudVal !== "unknown") {
        if (acloudVal === gintoAuditedVal && gintoAuditedVal === osmVal) allAgree++
        else if (gintoAuditedVal === osmVal && acloudVal !== gintoAuditedVal) acloudOutlier++
        else if (acloudVal === gintoAuditedVal && osmVal !== acloudVal) osmOutlier++
        else if (acloudVal === osmVal && gintoAuditedVal !== acloudVal) gintoOutlier++
        else allDiffer++
      }
    }

    console.log(`  AUDITED: matched=${auditedMatched} agree=${auditedAgree} disagree=${auditedDisagree}`)
    console.log(`  SELF_DECLARED: matched=${sdMatched} agree=${sdAgree} disagree=${sdDisagree}`)
    console.log(`  OSM: matched=${osmMatched} agree=${osmAgree} disagree=${osmDisagree}`)

    results.push({
      spec,
      acloudCount: acloud.length,
      gintoAuditedCount: gintoAudited.length,
      gintoSelfDeclaredCount: gintoSelfDeclared.length,
      osmCandidateCount: osmCandidates.length,
      auditedMatch: { matched: auditedMatched, agree: auditedAgree, disagree: auditedDisagree },
      selfDeclaredMatch: { matched: sdMatched, agree: sdAgree, disagree: sdDisagree },
      osmMatch: { matched: osmMatched, agree: osmAgree, disagree: osmDisagree, checkDateAgeBuckets },
      triangulation: { allAgree, acloudOutlier, osmOutlier, gintoOutlier, allDiffer },
      auditedDisagreementExamples,
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

  push(`# A.Cloud vs. Ginto-AUDITED Datenqualitäts-Analyse — Schweiz (${new Date().toISOString().slice(0, 10)})`)
  push("")
  push(`Follow-up zu \`docs/analysis/acloud-data-quality-2026-07.md\` — nutzt Ginto-Einträge mit \`qualityInfo.approvalLevels: AUDITED\` (extern geprüft, höchste Vertrauensstufe im Projekt) als Ground Truth statt der mehrdeutigen Google-Werteabweichungen der letzten Runde. ${results.length} Orte in der Schweiz (7 Großstädte + 4 ländliche Orte). Skript: \`scripts/analyze-acloud-vs-ginto-ch.ts\`. Rohdaten: \`docs/analysis/acloud-vs-ginto-ch-raw.json\`. Kosten: 0 $ (A.Cloud, Ginto, OSM sind alle kostenlos).`)
  push("")
  push("**Wichtige Einschränkung:** `RELIABILITY_WEIGHTS.accessibility_cloud` ist nicht länderspezifisch — dieser CH-only-Befund lässt sich nur mit der Annahme \"A.Cloud's CH-Datenqualität ist repräsentativ für seine Datenqualität insgesamt\" auf die globale Gewichtung übertragen, nicht direkt beweisen für DE/AT.")
  push("")
  push("## Pro Ort")
  push("")
  push("| Ort | Typ | A.Cloud | Ginto AUDITED | Ginto SELF_DECL. | AUDITED-Match-Rate | AUDITED-Übereinstimmung | SELF_DECL.-Übereinstimmung | OSM-Übereinstimmung |")
  push("|---|---|---|---|---|---|---|---|---|")
  for (const r of results) {
    const auditedTotal = r.auditedMatch.agree + r.auditedMatch.disagree
    const sdTotal = r.selfDeclaredMatch.agree + r.selfDeclaredMatch.disagree
    const osmTotal = r.osmMatch.agree + r.osmMatch.disagree
    push(`| ${r.spec.label} | ${r.spec.kind} | ${r.acloudCount} | ${r.gintoAuditedCount} | ${r.gintoSelfDeclaredCount} | ${pct(r.auditedMatch.matched, r.acloudCount)} | ${pct(r.auditedMatch.agree, auditedTotal)} | ${pct(r.selfDeclaredMatch.agree, sdTotal)} | ${pct(r.osmMatch.agree, osmTotal)} |`)
  }
  push("")

  push("## Aggregiert")
  push("")
  const totalAcloud = results.reduce((s, r) => s + r.acloudCount, 0)
  const totalAuditedMatched = results.reduce((s, r) => s + r.auditedMatch.matched, 0)
  const totalAuditedAgree = results.reduce((s, r) => s + r.auditedMatch.agree, 0)
  const totalAuditedDisagree = results.reduce((s, r) => s + r.auditedMatch.disagree, 0)
  const totalSdAgree = results.reduce((s, r) => s + r.selfDeclaredMatch.agree, 0)
  const totalSdDisagree = results.reduce((s, r) => s + r.selfDeclaredMatch.disagree, 0)
  push(`- **A.Cloud-Treffer gesamt:** ${totalAcloud}`)
  push(`- **Match-Rate mit Ginto AUDITED:** ${pct(totalAuditedMatched, totalAcloud)}`)
  push(`- **Übereinstimmung mit AUDITED (Ground Truth):** ${pct(totalAuditedAgree, totalAuditedAgree + totalAuditedDisagree)} (${totalAuditedAgree}/${totalAuditedAgree + totalAuditedDisagree})`)
  push(`- **Übereinstimmung mit SELF_DECLARED (nur zum Vergleich, keine Ground Truth):** ${pct(totalSdAgree, totalSdAgree + totalSdDisagree)} (${totalSdAgree}/${totalSdAgree + totalSdDisagree})`)
  push("")

  push("## Triangulation (A.Cloud + Ginto-AUDITED + OSM gleichzeitig vorhanden)")
  push("")
  const tri = results.reduce((acc, r) => ({
    allAgree: acc.allAgree + r.triangulation.allAgree,
    acloudOutlier: acc.acloudOutlier + r.triangulation.acloudOutlier,
    osmOutlier: acc.osmOutlier + r.triangulation.osmOutlier,
    gintoOutlier: acc.gintoOutlier + r.triangulation.gintoOutlier,
    allDiffer: acc.allDiffer + r.triangulation.allDiffer,
  }), { allAgree: 0, acloudOutlier: 0, osmOutlier: 0, gintoOutlier: 0, allDiffer: 0 })
  const triTotal = tri.allAgree + tri.acloudOutlier + tri.osmOutlier + tri.gintoOutlier + tri.allDiffer
  push(`Fälle mit allen drei Quellen: ${triTotal}`)
  push("")
  push("| Ergebnis | Anzahl | Anteil |")
  push("|---|---|---|")
  push(`| Alle drei stimmen überein | ${tri.allAgree} | ${pct(tri.allAgree, triTotal)} |`)
  push(`| A.Cloud ist Ausreißer (Ginto+OSM einig) | ${tri.acloudOutlier} | ${pct(tri.acloudOutlier, triTotal)} |`)
  push(`| OSM ist Ausreißer (A.Cloud+Ginto einig) | ${tri.osmOutlier} | ${pct(tri.osmOutlier, triTotal)} |`)
  push(`| Ginto ist Ausreißer (A.Cloud+OSM einig) | ${tri.gintoOutlier} | ${pct(tri.gintoOutlier, triTotal)} |`)
  push(`| Alle drei unterschiedlich | ${tri.allDiffer} | ${pct(tri.allDiffer, triTotal)} |`)
  push("")

  push("## OSM check_date-Altersverteilung (bei gematchten Orten)")
  push("")
  const ageBuckets = ["none", "<1y", "1-2y", "2-5y", "5y+"]
  push("| Alter | Anzahl |")
  push("|---|---|")
  for (const b of ageBuckets) {
    const total = results.reduce((s, r) => s + (r.osmMatch.checkDateAgeBuckets[b] ?? 0), 0)
    push(`| ${b} | ${total} |`)
  }
  push("")

  push("## Beispiele: A.Cloud vs. Ginto-AUDITED-Abweichungen (max. 5 pro Ort)")
  push("")
  for (const r of results) {
    if (r.auditedDisagreementExamples.length === 0) continue
    push(`### ${r.spec.label}`)
    for (const ex of r.auditedDisagreementExamples) {
      push(`- ${ex.name}: A.Cloud=${ex.acloud}, Ginto(AUDITED)=${ex.ginto}${ex.updatedAt ? ` (Ginto updatedAt: ${ex.updatedAt} — System-Republish, kein Prüfdatum)` : ""}`)
    }
    push("")
  }

  push("## Methodische Hinweise")
  push("")
  push("- Ginto AUDITED = extern geprüft (`qualityInfo.approvalLevels`), die einzige hier verwendete echte Ground-Truth-Stufe. SELF_DECLARED wird separat ausgewiesen, aber nie als Beweis gegen A.Cloud gewertet — epistemisch gleichrangig mit A.Cloud selbst.")
  push("- `updatedAt` bei Ginto ist ein System-Republish-Zeitstempel, kein menschliches Prüfdatum (siehe Kommentar in `lib/adapters/ginto.ts`) — nur als Kontext angegeben, nicht als Aktualitätsbeweis.")
  push("- Übereinstimmung bezieht sich nur auf das Kriterium Eingang, wie in der Vorgänger-Analyse.")
  push("- Ein Match-Fehlschlag bedeutet nicht zwingend \"falsch\" — kann auch heißen, der Ort ist nur einer Quelle bekannt.")
  push("- Die Triangulationstabelle hat naturgemäß eine kleinere Stichprobe (alle drei Quellen müssen gleichzeitig vorliegen) — Einzelwerte vorsichtig interpretieren.")

  writeFileSync(REPORT_PATH, lines.join("\n") + "\n")
}

main().catch((err) => { console.error(err); process.exit(1) })
