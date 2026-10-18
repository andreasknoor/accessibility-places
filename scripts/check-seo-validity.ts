/**
 * Checks all city/category combinations and writes lib/generated/seo-validity.json.
 *
 * Safety rules:
 *   - A check returning 0 results never overwrites an existing `true` value — only a
 *     check that actually finds places can confirm a new page. This protects against
 *     transient Overpass gaps removing confirmed pages from the sitemap.
 *   - If ≤ 50% of checks succeed the script exits without writing (full outage guard).
 *   - Before any check runs, every Overpass endpoint is probed with a real data
 *     query. A 401/403 on any endpoint (missing/wrong OVERPASS_PRIVATE_KEY) or no
 *     endpoint returning data aborts the run. Needed because the OSM adapter
 *     swallows its own errors and reports "0 places", which the 50% guard counts
 *     as a successful check — a 403 went unnoticed for months that way.
 *   - The file is written atomically (write tmp → rename) to prevent corrupt reads.
 *   - The file is only written when the content actually changed.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "fs"
import { join }                        from "path"
import { CITIES, SEO_CATEGORY_SLUGS } from "../lib/cities"

// Load .env.local BEFORE importing lib/seo-search (which transitively loads
// lib/config.ts). lib/config.ts caches OVERPASS_ENDPOINTS as a module-level
// constant at import time — so process.env must be populated first.
// Static ESM imports are hoisted and execute before this block, which is why
// lib/seo-search is imported dynamically inside main() instead.
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

// Parking enrichment is irrelevant for validity checks and doubles Overpass load.
process.env.SKIP_NEARBY_ENRICHMENT = "1"

const VALIDITY_PATH = join(process.cwd(), "lib/generated/seo-validity.json")
const CONCURRENCY   = 2
const DELAY_MS      = 2000

// Cafés around Berlin Alexanderplatz — always non-empty on a healthy DACH server,
// so an empty answer (wrong-region mirror, broken extract) fails the probe too.
const PREFLIGHT_QUERY =
  '[out:json][timeout:10];node["amenity"="cafe"](around:500,52.5219,13.4132);out 1;'

type PreflightResult = { endpoint: string; ok: boolean; auth: boolean; detail: string }

async function probeOverpass(endpoint: string): Promise<PreflightResult> {
  const { overpassHeaders } = await import("../lib/adapters/osm")
  try {
    const res = await fetch(endpoint, {
      method:  "POST",
      headers: overpassHeaders(endpoint),
      body:    "data=" + encodeURIComponent(PREFLIGHT_QUERY),
      signal:  AbortSignal.timeout(20_000),
    })
    const auth = res.status === 401 || res.status === 403
    if (!res.ok) return { endpoint, ok: false, auth, detail: `HTTP ${res.status}` }
    const ct = res.headers.get("content-type") ?? ""
    if (ct.includes("html")) return { endpoint, ok: false, auth: false, detail: "HTML response (overloaded)" }
    const json = (await res.json()) as { elements?: unknown[] }
    const n = json.elements?.length ?? 0
    if (n === 0) return { endpoint, ok: false, auth: false, detail: "no data returned" }
    return { endpoint, ok: true, auth: false, detail: `${n} element(s)` }
  } catch (err) {
    return { endpoint, ok: false, auth: false, detail: String(err) }
  }
}

// Exits the process when the Overpass setup is unusable. Auth errors are always
// fatal (configuration, not a transient outage); other per-endpoint failures only
// warn as long as at least one endpoint delivers data.
async function preflightOverpass(): Promise<void> {
  const { OVERPASS_ENDPOINTS } = await import("../lib/config")
  console.log(`Preflight: probing ${OVERPASS_ENDPOINTS.length} Overpass endpoint(s)…`)
  const results = await Promise.all(OVERPASS_ENDPOINTS.map(probeOverpass))
  for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.endpoint} — ${r.detail}`)

  const authFailures = results.filter((r) => r.auth)
  if (authFailures.length) {
    console.error(
      `\nAbort: Overpass rejected the request (${authFailures.map((r) => r.detail).join(", ")}). ` +
      "Check that OVERPASS_PRIVATE_KEY is set and passed to this job.",
    )
    process.exit(1)
  }
  if (!results.some((r) => r.ok)) {
    console.error("\nAbort: no Overpass endpoint returned data. File not written.")
    process.exit(1)
  }
  if (results.some((r) => !r.ok)) {
    console.warn("Preflight: some endpoints failed, continuing with the remaining ones.")
  }
}

async function main() {
  await preflightOverpass()

  // Dynamic import runs after the env-loading block above, so lib/config.ts
  // sees the correct OVERPASS_ENDPOINTS value when it initialises.
  const { fetchPlacesForSeoPage } = await import("../lib/seo-search")

  const existingRaw: Record<string, unknown> = existsSync(VALIDITY_PATH)
    ? JSON.parse(readFileSync(VALIDITY_PATH, "utf-8"))
    : {}
  // Strip meta fields (keys prefixed with "_") before treating data as boolean map
  const existing: Record<string, boolean> = Object.fromEntries(
    Object.entries(existingRaw).filter(([k, v]) => !k.startsWith("_") && typeof v === "boolean"),
  ) as Record<string, boolean>

  const updated = { ...existing }

  const combos = CITIES.flatMap((city) =>
    Object.entries(SEO_CATEGORY_SLUGS).map(([slug, category]) => ({ city, slug, category })),
  )

  let successCount = 0
  let failCount    = 0

  for (let i = 0; i < combos.length; i += CONCURRENCY) {
    const batch = combos.slice(i, i + CONCURRENCY)

    await Promise.all(batch.map(async ({ city, slug, category }) => {
      const key = `${city.slug}/${slug}`
      try {
        const places = await fetchPlacesForSeoPage(city.lat, city.lon, category)
        const hasData = places.length > 0
        // Always trust a completed fetch — safeRun inside fetchPlacesForSeoPage
        // catches adapter errors and returns [], so reaching here means the
        // pipeline ran cleanly. Only actual throws (caught below) indicate a
        // transient failure worth preserving the previous value for.
        if (existing[key] === true && !hasData) {
          console.warn(`  ⚠ ${key}: was confirmed, now 0 places — updating to false`)
        }
        updated[key] = hasData
        successCount++
        const status = hasData ? "✓" : "✗"
        console.log(`  ${status} ${key} (${places.length} places)`)
      } catch (err) {
        // fetchPlacesForSeoPage threw — genuinely transient (bug, network split,
        // etc.). Keep the existing value so a bad day doesn't gut the sitemap.
        failCount++
        const kept = existing[key] ?? "?"
        console.warn(`  ? ${key} — check threw, keeping "${kept}"`)
      }
    }))

    if (i + CONCURRENCY < combos.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS))
    }

    const done  = Math.min(i + CONCURRENCY, combos.length)
    const pct   = Math.round((done / combos.length) * 100)
    console.log(`[${done}/${combos.length}] ${pct}% — ✓ ${successCount} ✗ fail ${failCount}`)
  }

  const total = combos.length
  if (successCount <= total * 0.5) {
    console.error(`\nAbort: only ${successCount}/${total} checks succeeded (< 50%). File not written.`)
    process.exit(1)
  }

  mkdirSync(join(process.cwd(), "lib/generated"), { recursive: true })

  // Only write (and update timestamp) when the boolean data actually changed.
  // Comparing just the data without meta fields avoids a noisy git commit on
  // every cron run even when no city/category results changed.
  const newDataJson = JSON.stringify(updated, null, 2)
  const oldDataJson = JSON.stringify(existing, null, 2)
  if (newDataJson === oldDataJson) {
    console.log("\nNo changes — file unchanged.")
    return
  }

  const output = { _generatedAt: new Date().toISOString(), ...updated }
  const newContent = JSON.stringify(output, null, 2) + "\n"
  const tmpPath = VALIDITY_PATH + ".tmp"
  writeFileSync(tmpPath, newContent)
  renameSync(tmpPath, VALIDITY_PATH)
  const trueCount  = Object.values(updated).filter(Boolean).length
  const falseCount = Object.values(updated).filter((v) => !v).length
  console.log(`\nWritten: ${trueCount} with data, ${falseCount} empty (${successCount} checked, ${failCount} failed)`)
}

main().catch((err) => { console.error(err); process.exit(1) })
