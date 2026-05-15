import { list } from "@vercel/blob"

const CURRENT_CATS = ["cafe","restaurant","bar","pub","biergarten","hotel","museum","theater","cinema","attraction"]
const OLD_CATS     = ["apartment","fast-food","gallery","hostel","library","fast_food"]

async function main() {
  const map: Record<string, { url: string; size: number; city: string }[]> = {}
  let cursor: string | undefined
  do {
    const result = await list({ prefix: "seo/", cursor, limit: 1000 })
    for (const blob of result.blobs) {
      const parts = blob.pathname.split("/")
      if (parts.length === 3) {
        const city = parts[1]
        const cat  = parts[2].replace(".json", "")
        if (!map[cat]) map[cat] = []
        map[cat].push({ url: blob.url, size: blob.size, city })
      }
    }
    cursor = result.cursor
  } while (cursor)

  console.log("=== AKTUELLE KATEGORIEN (10) ===")
  let totalEmpty = 0
  for (const cat of CURRENT_CATS) {
    const blobs   = map[cat] ?? []
    const empty   = blobs.filter((b) => b.size <= 2)
    const nonEmpty = blobs.filter((b) => b.size > 2)
    totalEmpty   += empty.length
    const emptyList = empty.map((b) => b.city).join(", ")
    console.log(`${cat.padEnd(12)}: ${nonEmpty.length}/${blobs.length} gefüllt${empty.length > 0 ? `  ← ${empty.length} leer: ${emptyList}` : ""}`)
  }
  console.log(`\nGesamt leere Blobs (aktuelle Kategorien): ${totalEmpty}`)

  console.log("\n=== VERALTETE KATEGORIEN (nicht mehr in der App) ===")
  for (const cat of OLD_CATS) {
    const blobs = map[cat] ?? []
    if (blobs.length > 0) console.log(`${cat.padEnd(12)}: ${blobs.length} Blobs noch im Store (können gelöscht werden)`)
  }

  console.log("\n=== STÄDTE MIT DEN MEISTEN LEEREN BLOBS ===")
  const cityEmpty: Record<string, number> = {}
  for (const cat of CURRENT_CATS) {
    for (const b of (map[cat] ?? []).filter((b) => b.size <= 2)) {
      cityEmpty[b.city] = (cityEmpty[b.city] ?? 0) + 1
    }
  }
  Object.entries(cityEmpty)
    .sort((a, b) => b[1] - a[1])
    .forEach(([city, n]) => console.log(`  ${city.padEnd(14)}: ${n}/${CURRENT_CATS.length} Kategorien leer`))
}

main().catch((err) => { console.error(err); process.exit(1) })
