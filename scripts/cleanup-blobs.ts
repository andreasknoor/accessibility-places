import { list, del } from "@vercel/blob"

const STALE_CATS = ["apartment", "fast-food", "gallery", "hostel", "library"]

async function main() {
  const toDelete: string[] = []
  let cursor: string | undefined
  do {
    const result = await list({ prefix: "seo/", cursor, limit: 1000 })
    for (const blob of result.blobs) {
      const parts = blob.pathname.split("/")
      if (parts.length === 3) {
        const cat = parts[2].replace(".json", "")
        if (STALE_CATS.includes(cat)) toDelete.push(blob.url)
      }
    }
    cursor = result.cursor
  } while (cursor)

  if (toDelete.length === 0) {
    console.log("Keine veralteten Blobs gefunden.")
    return
  }

  console.log(`Lösche ${toDelete.length} veraltete Blobs...`)
  await del(toDelete)
  console.log("Fertig.")
}

main().catch((err) => { console.error(err); process.exit(1) })
