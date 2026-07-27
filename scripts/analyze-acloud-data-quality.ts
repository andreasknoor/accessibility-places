/**
 * A.Cloud data-quality analysis (see docs/analysis/acloud-data-quality-2026-07.md
 * for the write-up, and the concept discussion that produced this script).
 *
 * For 12 locations (6 big cities + 6 rural areas, DE+AT+CH):
 *   - Fetches accessibility.cloud's own results (real adapter, real API key).
 *   - Cross-references each A.Cloud place against OSM's wheelchair-tagged
 *     features (custom lightweight Overpass query — NOT buildOverpassQuery(),
 *     which requires an active accessibility filter to apply its wheelchair-tag
 *     prefilter and would otherwise also exclude wheelchair=no places entirely;
 *     we want every wheelchair-tagged place, "no" included, to catch A.Cloud
 *     saying "yes" where OSM says "no").
 *   - Variant A: a *targeted* Google Places lookup (1 request per checked A.Cloud
 *     place, no pagination) for a sample of that location's A.Cloud places —
 *     the cheap, precise way to get Google's businessStatus + accessibilityOptions
 *     for exactly the venues we care about.
 *   - Variant B: a real fetchGooglePlaces() area sweep (same call production
 *     makes), to see how much of Google's own area coverage overlaps with
 *     A.Cloud's set in the other direction.
 *
 * Usage: npx tsx scripts/analyze-acloud-data-quality.ts
 *
 * Cost: Variant A is capped at GOOGLE_LOOKUP_SAMPLE_PER_LOCATION requests per
 * location; Variant B is one fetchGooglePlaces() call per location (worst case
 * 9 requests each, own internal cap). A hard GOOGLE_REQUEST_CAP stops the
 * whole run regardless of the above math, as a safety net.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"

// ─── .env.local loader — must run before any import that transitively reads
// process.env at module load time (lib/config.ts caches OVERPASS_ENDPOINTS
// this way). Same pattern as scripts/check-seo-validity.ts. ──────────────────
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

const OUT_DIR      = join(process.cwd(), "docs/analysis")
const RAW_JSON_PATH = join(OUT_DIR, "acloud-data-quality-raw.json")
const REPORT_PATH   = join(OUT_DIR, "acloud-data-quality-2026-07.md")

// ─── Locations ──────────────────────────────────────────────────────────────

type LocationSpec = {
  key: string; label: string; country: "DE" | "AT" | "CH"; kind: "city" | "rural"
  lat: number; lon: number; radiusKm: number
}

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

const GOOGLE_LOOKUP_SAMPLE_PER_LOCATION = 10
const GOOGLE_REQUEST_CAP = 250 // hard safety net regardless of the math above
let googleRequestCount = 0

const NEUTRAL_FILTERS = {
  entrance: false, toilet: false, parking: false, parkingNearby: true,
  seating: false, onlyVerified: false, acceptUnknown: true,
}
const NO_SOURCES = {
  accessibility_cloud: false, osm: false, reisen_fuer_alle: false,
  ginto: false, acceslibre: false, google_places: false,
}

// ─── Lightweight OSM fetch: every node/way with a `wheelchair` tag, any value
// (including "no" — buildOverpassQuery()'s wc prefilter excludes "no" entirely,
// which would hide exactly the disagreement case we care about most: A.Cloud
// says yes, OSM says no). Not reusing lib/adapters/osm.ts's query builder —
// this is a deliberately different, wider query for research purposes only,
// no production code touched. ────────────────────────────────────────────────

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
    // Up to 3 attempts per endpoint with backoff — the public mirror returns
    // transient 504 (busy)/429 (rate-limited) under sequential load, both
    // recoverable with a short wait, unlike the earlier 406 (missing
    // User-Agent, permanent until fixed) this loop already handles.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            // Overpass returns HTTP 406 for requests with no User-Agent at all —
            // silently swallowed by the catch below until this was debugged live.
            "User-Agent": "AccessiblePlaces/data-quality-analysis (accessibility research script)",
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(45_000),
        })
        if (!res.ok) {
          console.warn(`  OSM endpoint ${endpoint} returned HTTP ${res.status} (attempt ${attempt}/3)`)
          if (res.status === 504 || res.status === 429) {
            await new Promise((r2) => setTimeout(r2, attempt * 4000))
            continue
          }
          break // non-retryable status — try next endpoint
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
        await new Promise((r2) => setTimeout(r2, attempt * 4000))
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

// Minimal Place-shaped object — only the fields lib/matching/match.ts's
// matchScore() actually reads (name, coordinates, address). Not a real Place;
// cast for the sole purpose of reusing findMatch() instead of re-implementing
// matching logic.
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

// ─── Google Variant A: targeted single-venue lookup ────────────────────────

type GoogleLookupResult =
  | { found: false }
  | {
      found: true; name: string; lat: number; lon: number
      businessStatus: string | undefined
      entrance: boolean | undefined; toilet: boolean | undefined; parking: boolean | undefined
    }

async function googleTargetedLookup(name: string, lat: number, lon: number, apiKey: string): Promise<GoogleLookupResult> {
  if (googleRequestCount >= GOOGLE_REQUEST_CAP) return { found: false }
  const fieldMask = [
    "places.id", "places.displayName", "places.location", "places.formattedAddress",
    "places.accessibilityOptions", "places.businessStatus",
  ].join(",")
  const body = {
    textQuery: name,
    languageCode: "de",
    maxResultCount: 1,
    locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: 400 } },
  }
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    googleRequestCount++
    if (!res.ok) return { found: false }
    const json = await res.json()
    const top = json.places?.[0]
    if (!top) return { found: false }
    const a11y = top.accessibilityOptions ?? {}
    return {
      found: true,
      name: top.displayName?.text ?? name,
      lat: top.location?.latitude, lon: top.location?.longitude,
      businessStatus: top.businessStatus,
      entrance: a11y.wheelchairAccessibleEntrance,
      toilet: a11y.wheelchairAccessibleRestroom,
      parking: a11y.wheelchairAccessibleParking,
    }
  } catch {
    return { found: false }
  }
}

function boolToA11y(v: boolean | undefined): "yes" | "no" | "unknown" {
  if (v === true) return "yes"
  if (v === false) return "no"
  return "unknown"
}

// ─── Per-location result shape ──────────────────────────────────────────────

interface LocationResult {
  spec: LocationSpec
  acloudCount: number
  acloudCompleteness: { entranceKnown: number; toiletKnown: number; parkingKnown: number }
  osm: {
    candidateCount: number
    matchedCount: number
    agreement: { entrance: number; disagreement: number }
    checkDateAgeBuckets: Record<string, number> // "none" | "<1y" | "1-2y" | "2-5y" | "5y+"
    disagreementExamples: Array<{ name: string; acloud: string; osm: string; checkDate?: string }>
  }
  googleA: {
    sampleSize: number
    foundCount: number
    businessStatus: Record<string, number>
    agreement: { entrance: number; disagreement: number }
    disagreementExamples: Array<{ name: string; acloud: string; google: string; businessStatus?: string }>
  }
  googleB: {
    sweepCategories: string[]
    sweepCount: number
    matchedBackToAcloud: number
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
  const acloudKey = process.env.ACCESSIBILITY_CLOUD_API_KEY
  const googleKey = process.env.GOOGLE_PLACES_API_KEY
  if (!acloudKey) { console.error("ACCESSIBILITY_CLOUD_API_KEY missing — aborting"); process.exit(1) }
  if (!googleKey) { console.error("GOOGLE_PLACES_API_KEY missing — aborting"); process.exit(1) }

  const { fetchAccessibilityCloud } = await import("../lib/adapters/accessibility-cloud")
  const { fetchGooglePlaces } = await import("../lib/adapters/google-places")
  const { findMatch } = await import("../lib/matching/match")
  const { ALL_CATEGORIES } = await import("../lib/llm")

  const results: LocationResult[] = []

  for (const spec of LOCATIONS) {
    console.log(`\n=== ${spec.label} (${spec.country}, ${spec.kind}) ===`)

    // ── A.Cloud ──
    const acloud = await fetchAccessibilityCloud({
      query: "", location: { lat: spec.lat, lon: spec.lon }, radiusKm: spec.radiusKm,
      categories: ALL_CATEGORIES, filters: NEUTRAL_FILTERS, sources: NO_SOURCES, locale: "de",
    })
    console.log(`  A.Cloud: ${acloud.length} places`)

    const entranceKnown = acloud.filter((p) => p.accessibility.entrance.value !== "unknown").length
    const toiletKnown   = acloud.filter((p) => p.accessibility.toilet.value   !== "unknown").length
    const parkingKnown  = acloud.filter((p) => p.accessibility.parking.value  !== "unknown").length

    // ── OSM cross-reference ──
    const osmCandidates = await fetchOsmWheelchairTagged(spec.lat, spec.lon, spec.radiusKm)
    console.log(`  OSM (wheelchair-tagged): ${osmCandidates.length} candidates`)
    const osmShims = osmCandidates.map((c) => toMatchShim(c.name, c.lat, c.lon, c))

    let osmMatched = 0, osmAgree = 0, osmDisagree = 0
    const checkDateAgeBuckets: Record<string, number> = { none: 0, "<1y": 0, "1-2y": 0, "2-5y": 0, "5y+": 0 }
    const osmDisagreementExamples: LocationResult["osm"]["disagreementExamples"] = []

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
        if (osmDisagreementExamples.length < 5) {
          osmDisagreementExamples.push({ name: place.name, acloud: acloudVal, osm: osmVal, checkDate: osm.checkDate })
        }
      }
    }

    // ── Google Variant A: targeted lookup on a sample of A.Cloud places ──
    const sample = acloud.slice(0, GOOGLE_LOOKUP_SAMPLE_PER_LOCATION)
    let googleFound = 0, googleAgree = 0, googleDisagree = 0
    const businessStatus: Record<string, number> = {}
    const googleDisagreementExamples: LocationResult["googleA"]["disagreementExamples"] = []

    for (const place of sample) {
      const lookup = await googleTargetedLookup(place.name, place.coordinates.lat, place.coordinates.lon, googleKey)
      if (!lookup.found) continue
      googleFound++
      const status = lookup.businessStatus ?? "UNKNOWN"
      businessStatus[status] = (businessStatus[status] ?? 0) + 1

      const acloudVal = place.accessibility.entrance.value
      const googleVal = boolToA11y(lookup.entrance)
      if (acloudVal === "unknown" || googleVal === "unknown") continue
      if (acloudVal === googleVal) {
        googleAgree++
      } else {
        googleDisagree++
        if (googleDisagreementExamples.length < 5) {
          googleDisagreementExamples.push({ name: place.name, acloud: acloudVal, google: googleVal, businessStatus: status })
        }
      }
    }
    console.log(`  Google (targeted, ${sample.length} checked): ${googleFound} found, ${googleAgree} agree, ${googleDisagree} disagree`)

    // ── Google Variant B: real area sweep, top-3 categories among this
    // location's A.Cloud results (falls back to ALL_CATEGORIES.slice(0,3) if
    // A.Cloud returned nothing usable) ──
    const catFreq = new Map<string, number>()
    for (const p of acloud) catFreq.set(p.category, (catFreq.get(p.category) ?? 0) + 1)
    const topCats = [...catFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c)
    const sweepCategories = (topCats.length > 0 ? topCats : ALL_CATEGORIES.slice(0, 3)) as (typeof ALL_CATEGORIES)

    const sweepPlaces = await fetchGooglePlaces({
      query: "", location: { lat: spec.lat, lon: spec.lon }, radiusKm: spec.radiusKm,
      categories: sweepCategories, filters: NEUTRAL_FILTERS, sources: NO_SOURCES, locale: "de",
    })
    console.log(`  Google (sweep, categories ${sweepCategories.join(",")}): ${sweepPlaces.length} places`)

    let matchedBack = 0
    for (const sp of sweepPlaces) {
      if (findMatch(acloud, sp) >= 0) matchedBack++
    }

    results.push({
      spec,
      acloudCount: acloud.length,
      acloudCompleteness: { entranceKnown, toiletKnown, parkingKnown },
      osm: {
        candidateCount: osmCandidates.length,
        matchedCount: osmMatched,
        agreement: { entrance: osmAgree, disagreement: osmDisagree },
        checkDateAgeBuckets,
        disagreementExamples: osmDisagreementExamples,
      },
      googleA: {
        sampleSize: sample.length,
        foundCount: googleFound,
        businessStatus,
        agreement: { entrance: googleAgree, disagreement: googleDisagree },
        disagreementExamples: googleDisagreementExamples,
      },
      googleB: {
        sweepCategories,
        sweepCount: sweepPlaces.length,
        matchedBackToAcloud: matchedBack,
      },
    })

    console.log(`  Google request count so far: ${googleRequestCount}/${GOOGLE_REQUEST_CAP}`)
    if (googleRequestCount >= GOOGLE_REQUEST_CAP) {
      console.warn("  Hit GOOGLE_REQUEST_CAP — stopping further locations.")
      break
    }
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(RAW_JSON_PATH, JSON.stringify(results, null, 2))
  console.log(`\nRaw data written to ${RAW_JSON_PATH}`)
  console.log(`Total Google requests used: ${googleRequestCount} (~$${(googleRequestCount * 0.035).toFixed(2)})`)

  writeReport(results)
  console.log(`Report written to ${REPORT_PATH}`)
}

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(0)}%` : "–"
}

function writeReport(results: LocationResult[]) {
  const lines: string[] = []
  const push = (s: string) => lines.push(s)

  push(`# A.Cloud Datenqualitäts-Analyse (${new Date().toISOString().slice(0, 10)})`)
  push("")
  push(`Automatisierter Lauf über ${results.length} Orte (Großstadt + ländlich, DE/AT/CH). Skript: \`scripts/analyze-acloud-data-quality.ts\`. Rohdaten: \`docs/analysis/acloud-data-quality-raw.json\`.`)
  push("")
  push(`Gesamt-Google-Requests in diesem Lauf: ${googleRequestCount} (~$${(googleRequestCount * 0.035).toFixed(2)}).`)
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
    const subset = results.filter((r) => r.spec.kind === kind)
    const acloudTotal = subset.reduce((s, r) => s + r.acloudCount, 0)
    const osmMatchTotal = subset.reduce((s, r) => s + r.osm.matchedCount, 0)
    const osmAgreeTotal = subset.reduce((s, r) => s + r.osm.agreement.entrance, 0)
    const osmDisTotal = subset.reduce((s, r) => s + r.osm.agreement.disagreement, 0)
    push(`**${kind === "city" ? "Großstädte" : "Ländliche Orte"}** — A.Cloud-Treffer gesamt: ${acloudTotal}, OSM-Match-Rate: ${pct(osmMatchTotal, acloudTotal)}, OSM-Übereinstimmung unter Matches: ${pct(osmAgreeTotal, osmAgreeTotal + osmDisTotal)}`)
  }
  push("")

  push("## Aggregiert: Land")
  push("")
  for (const country of ["DE", "AT", "CH"] as const) {
    const subset = results.filter((r) => r.spec.country === country)
    const acloudTotal = subset.reduce((s, r) => s + r.acloudCount, 0)
    const closedTotal = subset.reduce((s, r) => s + (r.googleA.businessStatus["CLOSED_PERMANENTLY"] ?? 0), 0)
    const foundTotal = subset.reduce((s, r) => s + r.googleA.foundCount, 0)
    push(`**${country}** — A.Cloud-Treffer gesamt: ${acloudTotal}, davon laut Google dauerhaft geschlossen: ${pct(closedTotal, foundTotal)}`)
  }
  push("")

  push("## OSM check_date-Altersverteilung (bei gematchten Orten)")
  push("")
  const ageBuckets = ["none", "<1y", "1-2y", "2-5y", "5y+"]
  const ageTotals: Record<string, number> = {}
  for (const b of ageBuckets) ageTotals[b] = results.reduce((s, r) => s + (r.osm.checkDateAgeBuckets[b] ?? 0), 0)
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
}

main().catch((err) => { console.error(err); process.exit(1) })
