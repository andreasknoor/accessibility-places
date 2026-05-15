/**
 * Fetches accessibility data for all SEO landing pages and writes Place[]
 * snapshots to Vercel Blob. The Next.js build reads from these snapshots
 * instead of making live API calls, decoupling deployments from data freshness.
 *
 * Usage:
 *   npm run snapshot:seo
 *   SNAPSHOT_CONCURRENCY=8 npm run snapshot:seo
 *
 * Required env vars:
 *   BLOB_READ_WRITE_TOKEN          — Vercel Blob write access
 *   ACCESSIBILITY_CLOUD_API_KEY    — optional, source skipped if absent
 *   REISEN_FUER_ALLE_API_KEY       — optional, source skipped if absent
 *   REISEN_FUER_ALLE_API_BASE      — required alongside RfA key
 *   GINTO_API_KEY                  — optional, source skipped if absent
 */

import { put, head } from "@vercel/blob"
import { CITIES, SEO_CATEGORY_SLUGS } from "../lib/cities"
import { fetchPlacesForSeoPage }      from "../lib/seo-search"
import type { Category }              from "../lib/types"

const CONCURRENCY = Number(process.env.SNAPSHOT_CONCURRENCY ?? 5)
const DELAY_MS    = Number(process.env.SNAPSHOT_DELAY_MS    ?? 500)

interface Task {
  citySlug:     string
  categorySlug: string
  category:     Category
  lat:          number
  lon:          number
}

const tasks: Task[] = CITIES.flatMap((city) =>
  Object.entries(SEO_CATEGORY_SLUGS).map(([slug, category]) => ({
    citySlug:     city.slug,
    categorySlug: slug,
    category,
    lat:          city.lat,
    lon:          city.lon,
  })),
)

let done   = 0
let failed = 0

async function hasExistingData(path: string): Promise<boolean> {
  try {
    const blob = await head(path, { token: process.env.BLOB_READ_WRITE_TOKEN })
    return blob.size > 2  // [] is 2 bytes
  } catch {
    return false
  }
}

async function snapshotOne(task: Task): Promise<void> {
  const path = `seo/${task.citySlug}/${task.categorySlug}.json`
  try {
    const places = await fetchPlacesForSeoPage(task.lat, task.lon, task.category)
    if (places.length === 0 && await hasExistingData(path)) {
      process.stdout.write(`  skip ${path}  (0 places — keeping existing data)\n`)
      done++
      return
    }
    await put(path, JSON.stringify(places), {
      access:              "private",
      allowOverwrite:      true,
      contentType:         "application/json",
      cacheControlMaxAge:  60 * 60 * 24 * 7,
    })
    done++
    process.stdout.write(`  ok   ${path}  (${places.length} places)\n`)
  } catch (err) {
    failed++
    process.stderr.write(`  err  ${path}: ${err}\n`)
  }
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("Error: BLOB_READ_WRITE_TOKEN is not set")
    process.exit(1)
  }

  console.log(`Snapshotting ${tasks.length} pages  (concurrency=${CONCURRENCY}, delay=${DELAY_MS}ms)\n`)

  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(snapshotOne))
    if (i + CONCURRENCY < tasks.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS))
    }
  }

  console.log(`\n― ${done + failed} processed: ${done} ok, ${failed} failed ―`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
