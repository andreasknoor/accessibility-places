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

import { CITIES, SEO_CATEGORY_SLUGS } from "../lib/cities"
import { fetchPlacesForSeoPage }       from "../lib/seo-search"
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "fs"
import { join }                        from "path"

const VALIDITY_PATH = join(process.cwd(), "lib/generated/seo-validity.json")
const CONCURRENCY   = 2
const DELAY_MS      = 2000

async function main() {
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
        if (existing[key] === true && !hasData) {
          // Previously confirmed but now returns 0 results. Could be a transient
          // Overpass timeout (safeRun swallows ETIMEDOUT and returns []). Keep true
          // to avoid removing confirmed pages from the sitemap on a bad day.
          console.warn(`  ⚠ ${key}: was confirmed, now 0 places — keeping true (possible timeout)`)
        } else {
          updated[key] = hasData
        }
        successCount++
        const status = hasData ? "✓" : "✗"
        console.log(`  ${status} ${key} (${places.length} places)`)
      } catch (err) {
        failCount++
        const kept = existing[key] ?? "?"
        console.warn(`  ? ${key} — check failed, keeping "${kept}"`)
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
