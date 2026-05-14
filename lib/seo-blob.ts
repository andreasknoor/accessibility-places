import { list } from "@vercel/blob"
import type { Place } from "./types"

// Singleton Promise so concurrent page renders during static generation share one fetch.
// Setting urlMap = new Map() before awaiting caused a race: later callers saw a truthy
// but still-empty Map and returned [] for every key.
let urlMapPromise: Promise<Map<string, string>> | null = null

function getUrlMap(): Promise<Map<string, string>> {
  if (!urlMapPromise) urlMapPromise = buildUrlMap()
  return urlMapPromise
}

async function buildUrlMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let cursor: string | undefined
  do {
    const result = await list({ prefix: "seo/", cursor, limit: 1000 })
    for (const blob of result.blobs) {
      map.set(blob.pathname, blob.url)
    }
    cursor = result.cursor
  } while (cursor)
  return map
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
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    })
    if (!res.ok) return []
    return (await res.json()) as Place[]
  } catch {
    return []
  }
}
