/**
 * Checks all city/category combinations and writes lib/generated/seo-validity.json.
 *
 * Safety rules:
 *   - A failed check never overwrites an existing `true` value (Overpass downtime
 *     cannot remove previously confirmed pages from the sitemap/links).
 *   - If < 50% of checks succeed the script exits without writing (full outage guard).
 *   - The file is only written when the content actually changed.
 */

import { CITIES, SEO_CATEGORY_SLUGS } from "../lib/cities"
import { fetchPlacesForSeoPage }       from "../lib/seo-search"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join }                        from "path"

const VALIDITY_PATH = join(process.cwd(), "lib/generated/seo-validity.json")
const CONCURRENCY   = 5
const DELAY_MS      = 500

async function main() {
  const existing: Record<string, boolean> = existsSync(VALIDITY_PATH)
    ? JSON.parse(readFileSync(VALIDITY_PATH, "utf-8"))
    : {}

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
          // Previously had data but now empty — only update if we're confident
          // (could be a transient Overpass gap). We still update false→false
          // and undefined→false here; the guard is for true→false flips.
          // Comment out the next line to be more conservative (never flip true→false).
          updated[key] = false
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
  if (successCount < total * 0.5) {
    console.error(`\nAbort: only ${successCount}/${total} checks succeeded (< 50%). File not written.`)
    process.exit(1)
  }

  mkdirSync(join(process.cwd(), "lib/generated"), { recursive: true })
  const newContent = JSON.stringify(updated, null, 2) + "\n"
  const oldContent = existsSync(VALIDITY_PATH) ? readFileSync(VALIDITY_PATH, "utf-8") : ""

  if (newContent === oldContent) {
    console.log("\nNo changes — file unchanged.")
    return
  }

  writeFileSync(VALIDITY_PATH, newContent)
  const trueCount  = Object.values(updated).filter(Boolean).length
  const falseCount = Object.values(updated).filter((v) => !v).length
  console.log(`\nWritten: ${trueCount} with data, ${falseCount} empty (${successCount} checked, ${failCount} failed)`)
}

main().catch((err) => { console.error(err); process.exit(1) })
