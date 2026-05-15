import { list } from "@vercel/blob"

async function main() {
  const map: Record<string, { count: number; sizes: number[] }> = {}
  let cursor: string | undefined
  do {
    const result = await list({ prefix: "seo/", cursor, limit: 1000 })
    for (const blob of result.blobs) {
      const parts = blob.pathname.split("/")
      if (parts.length === 3) {
        const cat = parts[2].replace(".json", "")
        if (!map[cat]) map[cat] = { count: 0, sizes: [] }
        map[cat].count++
        map[cat].sizes.push(blob.size)
      }
    }
    cursor = result.cursor
  } while (cursor)

  const cats = Object.keys(map).sort()
  for (const cat of cats) {
    const d = map[cat]
    const nonEmpty = d.sizes.filter((s) => s > 2).length
    const min = Math.min(...d.sizes)
    const max = Math.max(...d.sizes)
    const avg = Math.round(d.sizes.reduce((a, b) => a + b, 0) / d.sizes.length)
    console.log(`${cat.padEnd(14)}: ${nonEmpty}/${d.count} cities  avg=${avg}B  min=${min}B  max=${max}B`)
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
