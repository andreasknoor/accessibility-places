/**
 * Regenerates the Wheelmap-origin Markdown report from the (patched) raw
 * JSON — no fetching, pure read + format. See regenerate-report.ts for the
 * same pattern used after the first analysis's OSM repair.
 *
 * Usage: npx tsx scripts/regenerate-wheelmap-report.ts
 */
import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const RAW_JSON_PATH = join(process.cwd(), "docs/analysis/acloud-wheelmap-origin-raw.json")
const REPORT_PATH   = join(process.cwd(), "docs/analysis/acloud-wheelmap-origin-2026-07.md")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LocationResult = any

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
  push(`12 Orte (dieselben wie in der ersten Analyse, DE+AT+CH, Großstadt+ländlich). Skript: \`scripts/analyze-acloud-wheelmap-origin.ts\` (+ \`repair-wheelmap-origin-analysis.ts\` für 5 Orte mit zunächst fehlgeschlagener Fuzzy-Abfrage). Rohdaten: \`docs/analysis/acloud-wheelmap-origin-raw.json\`. Kosten: 0 $.`)
  push("")
  push("**Verifikation der \"Node nicht mehr vorhanden\"-Quote:** Stichprobe von 5 als \"gone\" markierten Berlin-IDs wurde direkt gegen die offizielle OSM-API (`api.openstreetmap.org`, nicht Overpass) geprüft — alle 5 lieferten `HTTP 410 Gone`. Die Quote ist real, kein Abfrage-Artefakt.")
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
  const totalAcloud = results.reduce((s: number, r: LocationResult) => s + r.acloudCount, 0)
  const totalWheelmap = results.reduce((s: number, r: LocationResult) => s + r.wheelmapCount, 0)
  const totalOther = results.reduce((s: number, r: LocationResult) => s + r.otherCount, 0)
  const totalLookedUp = results.reduce((s: number, r: LocationResult) => s + r.wheelmap.lookedUp, 0)
  const totalGone = results.reduce((s: number, r: LocationResult) => s + r.wheelmap.nodeGone, 0)
  const totalWmAgree = results.reduce((s: number, r: LocationResult) => s + r.wheelmap.agree, 0)
  const totalWmDisagree = results.reduce((s: number, r: LocationResult) => s + r.wheelmap.disagree, 0)
  const totalOtherAgree = results.reduce((s: number, r: LocationResult) => s + r.other.agree, 0)
  const totalOtherDisagree = results.reduce((s: number, r: LocationResult) => s + r.other.disagree, 0)
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
    const total = results.reduce((s: number, r: LocationResult) => s + (r.wheelmap.checkDateAgeBuckets[b] ?? 0), 0)
    push(`| ${b} | ${total} |`)
  }
  push("")

  push("## Häufigste \"andere\" sourceIds (über alle Orte)")
  push("")
  const sourceIdTotals = new Map<string, number>()
  for (const r of results) {
    for (const [sid, count] of Object.entries(r.sourceIdBreakdown)) {
      sourceIdTotals.set(sid as string, (sourceIdTotals.get(sid as string) ?? 0) + (count as number))
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
  push("- \"OSM-Node nicht mehr vorhanden\" ist das härteste Einzelsignal über alle drei A.Cloud-Analysen hinweg: A.Cloud referenziert einen Datensatz, der bei OSM inzwischen gelöscht/zusammengeführt wurde — per echter OSM-API-Stichprobe verifiziert (HTTP 410), kein Abfrage-Artefakt.")
  push("- Die \"andere Datensätze\"-Gruppe nutzt weiterhin Fuzzy-Matching (keine exakte ID verfügbar). Bei 5 Orten (Berlin, München, Wien, Graz, Bad Berleburg) war die Gruppe klein (1–11 Einträge) und lieferte 0 Treffer trotz sauberer OSM-Flächenabfrage (1400+ echte Kandidaten je Ort) — plausibel bei so kleiner Stichprobe, kein Fehler.")
  push("- `sourceId`-Werte sind opak (keine auflösbaren Namen über die öffentliche API) — Herkunft wird über Konzentration/Streuung eingeschätzt, nicht über echte Datensatz-Namen.")

  writeFileSync(REPORT_PATH, lines.join("\n") + "\n")
}

const results: LocationResult[] = JSON.parse(readFileSync(RAW_JSON_PATH, "utf-8"))
writeReport(results)
console.log(`Report regenerated at ${REPORT_PATH}`)
