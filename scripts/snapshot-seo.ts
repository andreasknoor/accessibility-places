/**
 * Fetches accessibility data for all SEO landing pages and writes Place[]
 * snapshots to Vercel Blob. The Next.js build reads from these snapshots
 * instead of making live API calls, decoupling deployments from data freshness.
 *
 * Usage:
 *   npm run snapshot:seo
 *   SNAPSHOT_CONCURRENCY=2 npm run snapshot:seo
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

const CONCURRENCY   = Number(process.env.SNAPSHOT_CONCURRENCY ?? 2)
const DELAY_MS      = Number(process.env.SNAPSHOT_DELAY_MS    ?? 1000)
const RETRY_WAIT_MS = 30_000

interface Task {
  citySlug:     string
  categorySlug: string
  category:     Category
  lat:          number
  lon:          number
}

// "written"  — blob written with ≥1 place
// "empty"    — blob written with 0 places and no prior data → retry candidate
// "skip"     — 0 places but prior data exists → kept as-is
// "error"    — fetch or write threw
type SnapshotResult = "written" | "empty" | "skip" | "error"

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

async function snapshotOne(task: Task, isRetry = false): Promise<SnapshotResult> {
  const path = `seo/${task.citySlug}/${task.categorySlug}.json`
  try {
    const places = await fetchPlacesForSeoPage(task.lat, task.lon, task.category)
    if (places.length === 0 && await hasExistingData(path)) {
      process.stdout.write(`  skip ${path}  (0 places — keeping existing data)\n`)
      done++
      return "skip"
    }
    await put(path, JSON.stringify(places), {
      access:              "private",
      allowOverwrite:      true,
      contentType:         "application/json",
      cacheControlMaxAge:  60 * 60 * 24 * 7,
    })
    done++
    const label = isRetry ? "retry" : "ok   "
    process.stdout.write(`  ${label} ${path}  (${places.length} places)\n`)
    return places.length > 0 ? "written" : "empty"
  } catch (err) {
    failed++
    process.stderr.write(`  err  ${path}: ${err}\n`)
    return "error"
  }
}

async function runBatches(taskList: Task[], isRetry = false): Promise<Task[]> {
  const retryQueue: Task[] = []
  for (let i = 0; i < taskList.length; i += CONCURRENCY) {
    const batch = taskList.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map((t) => snapshotOne(t, isRetry)))
    if (!isRetry) {
      batch.forEach((t, idx) => {
        if (results[idx] === "empty") retryQueue.push(t)
      })
    }
    if (i + CONCURRENCY < taskList.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS))
    }
  }
  return retryQueue
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("Error: BLOB_READ_WRITE_TOKEN is not set")
    process.exit(1)
  }

  console.log(`Snapshotting ${tasks.length} pages  (concurrency=${CONCURRENCY}, delay=${DELAY_MS}ms)\n`)

  const retryQueue = await runBatches(tasks)

  if (retryQueue.length > 0) {
    process.stdout.write(`\n↩  ${retryQueue.length} empty — waiting ${RETRY_WAIT_MS / 1000}s for Overpass to recover...\n\n`)
    await new Promise((r) => setTimeout(r, RETRY_WAIT_MS))
    done -= retryQueue.length  // these were already counted; re-count after retry
    await runBatches(retryQueue, true)
  }

  console.log(`\n― ${tasks.length} processed: ${done} ok, ${failed} failed ―`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
