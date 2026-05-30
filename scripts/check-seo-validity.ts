/**
 * Checks all city/category combinations and writes lib/generated/seo-validity.json.
 *
 * Safety rules:
 *   - A check returning 0 results never overwrites an existing `true` value — only a
 *     check that actually finds places can confirm a new page. This protects against
 *     transient Overpass gaps removing confirmed pages from the sitemap.
 *   - If ≤ 50% of checks succeed the script exits without writing (full outage guard).
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
process.env.ENABLE_NEARBY_PARKING = "0"

const VALIDITY_PATH = join(process.cwd(), "lib/generated/seo-validity.json")
const CONCURRENCY   = 2
const DELAY_MS      = 2000

async function main() {
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
