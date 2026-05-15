// Reads all SEO snapshots from Vercel Blob and prints a count matrix.
// Run: npx tsx --env-file=.env.local scripts/report-seo.ts
import { list } from "@vercel/blob"
import { CITIES, SEO_CATEGORY_SLUGS } from "../lib/cities"
import type { Place } from "../lib/types"

const cityOrder = CITIES.map((c) => c.slug)
const catSlugs  = Object.keys(SEO_CATEGORY_SLUGS)

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN not set")
    process.exit(1)
  }

  // 1. Fetch all blob metadata
  const blobMap = new Map<string, string>() // pathname → url
  let cursor: string | undefined
  do {
    const result = await list({ prefix: "seo/", cursor, limit: 1000 })
    for (const blob of result.blobs) blobMap.set(blob.pathname, blob.url)
    cursor = result.cursor
  } while (cursor)

  console.log(`Found ${blobMap.size} blobs in store.\n`)

  // 2. Fetch counts for every city × category
  type Row = { city: string; counts: Map<string, number> }
  const rows: Row[] = []

  for (const citySlug of cityOrder) {
    const city = CITIES.find((c) => c.slug === citySlug)!
    const counts = new Map<string, number>()

    await Promise.all(catSlugs.map(async (catSlug) => {
      const key   = `seo/${citySlug}/${catSlug}.json`
      const url   = blobMap.get(key)
      if (!url) { counts.set(catSlug, -1); return } // blob missing

      try {
        const res = await fetch(url, {
          headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
        })
        if (!res.ok) { counts.set(catSlug, -1); return }
        const places = (await res.json()) as Place[]
        counts.set(catSlug, places.length)
      } catch {
        counts.set(catSlug, -1)
      }
    }))

    rows.push({ city: city.nameDe, counts })
  }

  // 3. Print markdown table
  const colWidth = 12
  const cityWidth = 16

  const header = "Stadt".padEnd(cityWidth) + catSlugs.map((s) => s.padStart(colWidth)).join("")
  const sep    = "-".repeat(header.length)
  console.log(header)
  console.log(sep)

  const zeros: string[] = []
  const missing: string[] = []

  for (const { city, counts } of rows) {
    const row = city.padEnd(cityWidth) + catSlugs.map((slug) => {
      const n = counts.get(slug) ?? -1
      if (n === -1) return "  (missing)".padStart(colWidth)
      return String(n).padStart(colWidth)
    }).join("")
    console.log(row)

    for (const slug of catSlugs) {
      const n = counts.get(slug) ?? -1
      if (n === 0)  zeros.push(`${city} / ${slug}`)
      if (n === -1) missing.push(`${city} / ${slug}`)
    }
  }

  // 4. Summary
  console.log(`\n${"=".repeat(sep.length)}`)
  console.log(`Total combos: ${cityOrder.length * catSlugs.length}`)
  console.log(`  With data:  ${cityOrder.length * catSlugs.length - zeros.length - missing.length}`)
  console.log(`  Zero hits:  ${zeros.length}`)
  console.log(`  Missing:    ${missing.length}`)

  if (zeros.length > 0) {
    console.log("\n--- ZERO HITS (blob exists but 0 places) ---")
    zeros.forEach((z) => console.log(`  ${z}`))
  }

  if (missing.length > 0) {
    console.log("\n--- MISSING (no blob in store) ---")
    missing.forEach((m) => console.log(`  ${m}`))
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
