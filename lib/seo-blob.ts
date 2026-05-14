import { list } from "@vercel/blob"
import type { Place } from "./types"

// Populated once per build process by getUrlMap() and reused across all page renders.
// Next.js static generation runs in a single Node.js process, so module-level state persists.
let urlMap: Map<string, string> | null = null

async function getUrlMap(): Promise<Map<string, string>> {
  if (urlMap) return urlMap
  urlMap = new Map()
  let cursor: string | undefined
  do {
    const result = await list({ prefix: "seo/", cursor, limit: 1000 })
    for (const blob of result.blobs) {
      urlMap.set(blob.pathname, blob.url)
    }
    cursor = result.cursor
  } while (cursor)
  return urlMap
}

export async function getPlacesSnapshot(
  citySlug:     string,
  categorySlug: string,
): Promise<Place[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return []
  try {
    const map = await getUrlMap()
    const url = map.get(`seo/${citySlug}/${categorySlug}.json`)
    if (!url) return []
    const res = await fetch(url)
    if (!res.ok) return []
    return (await res.json()) as Place[]
  } catch {
    return []
  }
}
