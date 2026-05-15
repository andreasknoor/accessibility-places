/**
 * Full rebuild of all SEO snapshots: deletes existing blobs, then re-fetches
 * every city/category combination and writes fresh Place[] data to Vercel Blob.
 *
 * Unlike snapshot-seo.ts, this script ALWAYS writes the result — even empty
 * arrays. Use this after filter changes or when stale data needs to be cleared.
 *
 * Usage:
 *   npm run rebuild:seo
 *   SNAPSHOT_CONCURRENCY=3 npm run rebuild:seo
 *
 * Required env vars:
 *   BLOB_READ_WRITE_TOKEN          — Vercel Blob write access
 *   ACCESSIBILITY_CLOUD_API_KEY    — optional, source skipped if absent
 *   REISEN_FUER_ALLE_API_KEY       — optional, source skipped if absent
 *   REISEN_FUER_ALLE_API_BASE      — required alongside RfA key
 *   GINTO_API_KEY                  — optional, source skipped if absent
 */

import { list, del, put } from "@vercel/blob"
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

async function deleteAllBlobs() {
  process.stdout.write("Lösche alle vorhandenen SEO-Blobs...\n")
  const toDelete: string[] = []
  let cursor: string | undefined
  do {
    const result = await list({ prefix: "seo/", cursor, limit: 1000 })
    toDelete.push(...result.blobs.map((b) => b.url))
    cursor = result.cursor
  } while (cursor)

  if (toDelete.length === 0) {
    process.stdout.write("  Keine Blobs gefunden.\n\n")
    return
  }
  await del(toDelete)
  process.stdout.write(`  ${toDelete.length} Blobs gelöscht.\n\n`)
}

async function rebuildOne(task: Task): Promise<void> {
  const path = `seo/${task.citySlug}/${task.categorySlug}.json`
  try {
    const places = await fetchPlacesForSeoPage(task.lat, task.lon, task.category)
    await put(path, JSON.stringify(places), {
      access:             "private",
      allowOverwrite:     true,
      contentType:        "application/json",
      cacheControlMaxAge: 60 * 60 * 24 * 7,
    })
    done++
    process.stdout.write(`  ok    ${path}  (${places.length} places)\n`)
  } catch (err) {
    failed++
    process.stderr.write(`  err   ${path}: ${err}\n`)
  }
}

async function runBatches() {
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(rebuildOne))
    if (i + CONCURRENCY < tasks.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS))
    }
  }
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("Error: BLOB_READ_WRITE_TOKEN is not set")
    process.exit(1)
  }

  console.log(`Full rebuild: ${tasks.length} pages  (concurrency=${CONCURRENCY}, delay=${DELAY_MS}ms)\n`)

  await deleteAllBlobs()
  await runBatches()

  console.log(`\n― ${tasks.length} processed: ${done} ok, ${failed} failed ―`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
