/**
 * Regenerates the Markdown report from the (possibly patched) raw JSON —
 * no A.Cloud/OSM/Google calls, pure read + format. Used after
 * repair-osm-in-analysis.ts patches individual locations, to avoid re-running
 * (and re-paying for) the full analysis just to refresh the report text.
 *
 * Usage: npx tsx scripts/regenerate-report.ts [googleRequestCount]
 */
import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const RAW_JSON_PATH = join(process.cwd(), "docs/analysis/acloud-data-quality-raw.json")
const REPORT_PATH   = join(process.cwd(), "docs/analysis/acloud-data-quality-2026-07.md")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LocationResult = any

// Known from the original successful run's log (repairs afterwards only
// touched free OSM/A.Cloud calls, no additional Google spend) — passed
// explicitly rather than recomputed, since this script deliberately does not
// re-fetch anything.
const googleRequestCount = Number(process.argv[2] ?? 120)

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(0)}%` : "–"
}

function writeReport(results: LocationResult[]) {
  const lines: string[] = []
  const push = (s: string) => lines.push(s)

  push(`# A.Cloud Datenqualitäts-Analyse (${new Date().toISOString().slice(0, 10)})`)
  push("")
  push(`Automatisierter Lauf über ${results.length} Orte (Großstadt + ländlich, DE/AT/CH). Skript: \`scripts/analyze-acloud-data-quality.ts\` (+ \`repair-osm-in-analysis.ts\` für 5 zunächst an Overpass-Timeouts gescheiterte Orte). Rohdaten: \`docs/analysis/acloud-data-quality-raw.json\`.`)
  push("")
  push(`Gesamt-Google-Requests: ${googleRequestCount} (~$${(googleRequestCount * 0.035).toFixed(2)}) — die OSM-Reparatur hat KEINE zusätzlichen Google-Requests verursacht (nur kostenlose A.Cloud/OSM-Aufrufe wiederholt).`)
  push("")
  push("## Pro Ort")
  push("")
  push("| Ort | Land | Typ | A.Cloud-Treffer | Eingang bekannt | OSM-Match-Rate | OSM-Übereinstimmung | Google-Match-Rate | Google-Übereinstimmung | Dauerhaft geschlossen (Google) |")
  push("|---|---|---|---|---|---|---|---|---|---|")
  for (const r of results) {
    const osmAgreeTotal = r.osm.agreement.entrance + r.osm.agreement.disagreement
    const gAgreeTotal = r.googleA.agreement.entrance + r.googleA.agreement.disagreement
    const closed = r.googleA.businessStatus["CLOSED_PERMANENTLY"] ?? 0
    push(`| ${r.spec.label} | ${r.spec.country} | ${r.spec.kind} | ${r.acloudCount} | ${pct(r.acloudCompleteness.entranceKnown, r.acloudCount)} | ${pct(r.osm.matchedCount, r.acloudCount)} | ${pct(r.osm.agreement.entrance, osmAgreeTotal)} | ${pct(r.googleA.foundCount, r.googleA.sampleSize)} | ${pct(r.googleA.agreement.entrance, gAgreeTotal)} | ${closed}/${r.googleA.foundCount} |`)
  }
  push("")

  push("## Aggregiert: Großstadt vs. ländlich")
  push("")
  for (const kind of ["city", "rural"] as const) {
    const subset = results.filter((r: LocationResult) => r.spec.kind === kind)
    const acloudTotal = subset.reduce((s: number, r: LocationResult) => s + r.acloudCount, 0)
    const osmMatchTotal = subset.reduce((s: number, r: LocationResult) => s + r.osm.matchedCount, 0)
    const osmAgreeTotal = subset.reduce((s: number, r: LocationResult) => s + r.osm.agreement.entrance, 0)
    const osmDisTotal = subset.reduce((s: number, r: LocationResult) => s + r.osm.agreement.disagreement, 0)
    push(`**${kind === "city" ? "Großstädte" : "Ländliche Orte"}** — A.Cloud-Treffer gesamt: ${acloudTotal}, OSM-Match-Rate: ${pct(osmMatchTotal, acloudTotal)}, OSM-Übereinstimmung unter Matches: ${pct(osmAgreeTotal, osmAgreeTotal + osmDisTotal)}`)
  }
  push("")

  push("## Aggregiert: Land")
  push("")
  for (const country of ["DE", "AT", "CH"] as const) {
    const subset = results.filter((r: LocationResult) => r.spec.country === country)
    const acloudTotal = subset.reduce((s: number, r: LocationResult) => s + r.acloudCount, 0)
    const closedTotal = subset.reduce((s: number, r: LocationResult) => s + (r.googleA.businessStatus["CLOSED_PERMANENTLY"] ?? 0), 0)
    const foundTotal = subset.reduce((s: number, r: LocationResult) => s + r.googleA.foundCount, 0)
    push(`**${country}** — A.Cloud-Treffer gesamt: ${acloudTotal}, davon laut Google dauerhaft geschlossen: ${pct(closedTotal, foundTotal)}`)
  }
  push("")

  push("## OSM check_date-Altersverteilung (bei gematchten Orten)")
  push("")
  const ageBuckets = ["none", "<1y", "1-2y", "2-5y", "5y+"]
  const ageTotals: Record<string, number> = {}
  for (const b of ageBuckets) ageTotals[b] = results.reduce((s: number, r: LocationResult) => s + (r.osm.checkDateAgeBuckets[b] ?? 0), 0)
  push("| Alter | Anzahl |")
  push("|---|---|")
  for (const b of ageBuckets) push(`| ${b} | ${ageTotals[b]} |`)
  push("")

  push("## Beispiele für Abweichungen (max. 5 pro Ort und Quelle)")
  push("")
  for (const r of results) {
    if (r.osm.disagreementExamples.length === 0 && r.googleA.disagreementExamples.length === 0) continue
    push(`### ${r.spec.label}`)
    if (r.osm.disagreementExamples.length > 0) {
      push("**A.Cloud vs. OSM:**")
      for (const ex of r.osm.disagreementExamples) {
        push(`- ${ex.name}: A.Cloud=${ex.acloud}, OSM=${ex.osm}${ex.checkDate ? ` (OSM check_date: ${ex.checkDate})` : " (kein check_date)"}`)
      }
    }
    if (r.googleA.disagreementExamples.length > 0) {
      push("**A.Cloud vs. Google:**")
      for (const ex of r.googleA.disagreementExamples) {
        push(`- ${ex.name}: A.Cloud=${ex.acloud}, Google=${ex.google} (businessStatus: ${ex.businessStatus})`)
      }
    }
    push("")
  }

  push("## Google-Flächen-Sweep (Variante B) — Rückwärts-Abdeckung")
  push("")
  push("| Ort | Sweep-Kategorien | Google-Treffer | davon auch bei A.Cloud |")
  push("|---|---|---|---|")
  for (const r of results) {
    push(`| ${r.spec.label} | ${r.googleB.sweepCategories.join(", ")} | ${r.googleB.sweepCount} | ${pct(r.googleB.matchedBackToAcloud, r.googleB.sweepCount)} |`)
  }
  push("")

  push("## Methodische Hinweise")
  push("")
  push("- A.Cloud liefert kein nutzbares Aktualitäts-Datum in den Rohdaten (bestätigt: der Adapter übergibt nie `verifiedAt`/`verifiedRecently` für diese Quelle) — Aktualität wird deshalb ausschließlich indirekt über OSM `check_date` und Google `businessStatus`/Werte-Abgleich erschlossen, nicht direkt gemessen.")
  push("- \"Übereinstimmung\" bezieht sich nur auf das Kriterium Eingang (am häufigsten in allen drei Quellen befüllt); Toilette/Parken wurden nicht separat ausgewertet, ließen sich aber mit denselben Rohdaten nachrechnen.")
  push("- Ein Match-Fehlschlag (kein OSM/Google-Gegenstück gefunden) bedeutet nicht zwingend \"falsch\" — kann auch heißen, der Ort ist nur A.Cloud bekannt.")
  push("- Variante A prüft eine Stichprobe (max. 10 je Ort), keine Vollerhebung.")
  push("- Alle 12 Orte lieferten am Ende OSM-Daten; 5 davon (Berlin, München, Wien, Bad Berleburg, Appenzell) brauchten wegen Overpass-Timeouts (HTTP 504) einen zweiten Anlauf über `repair-osm-in-analysis.ts` — keine Auswirkung auf die Google-Kosten, da dieser Reparaturlauf nur die kostenlosen A.Cloud/OSM-Aufrufe wiederholt hat.")

  writeFileSync(REPORT_PATH, lines.join("\n") + "\n")
}

const results: LocationResult[] = JSON.parse(readFileSync(RAW_JSON_PATH, "utf-8"))
writeReport(results)
console.log(`Report regenerated at ${REPORT_PATH}`)
