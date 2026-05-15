import { list } from "@vercel/blob"
import type { Place } from "./types"

interface BlobEntry { url: string; size: number }

// Singleton Promise so concurrent page renders during static generation share one fetch.
// Setting urlMap = new Map() before awaiting caused a race: later callers saw a truthy
// but still-empty Map and returned [] for every key.
let blobMapPromise: Promise<Map<string, BlobEntry>> | null = null

function getBlobMap(): Promise<Map<string, BlobEntry>> {
  if (!blobMapPromise) blobMapPromise = buildBlobMap()
  return blobMapPromise
}

async function buildBlobMap(): Promise<Map<string, BlobEntry>> {
  const map = new Map<string, BlobEntry>()
  let cursor: string | undefined
  do {
    const result = await list({ prefix: "seo/", cursor, limit: 1000 })
    for (const blob of result.blobs) {
      map.set(blob.pathname, { url: blob.url, size: blob.size })
    }
    cursor = result.cursor
  } while (cursor)
  return map
}

export type SlugPair = { city: string; category: string }

// Returns only city/category pairs where a non-empty snapshot exists.
// Falls back to [] on error so callers can apply their own fallback.
export async function getNonEmptySlugPairs(): Promise<SlugPair[]> {
  try {
    const map = await getBlobMap()
    const pairs: SlugPair[] = []
    for (const [pathname, { size }] of map) {
      if (size <= 2) continue
      // pathname: "seo/{city}/{category}.json"
      const inner = pathname.slice("seo/".length, -".json".length)
      const slash = inner.indexOf("/")
      if (slash < 0) continue
      pairs.push({ city: inner.slice(0, slash), category: inner.slice(slash + 1) })
    }
    return pairs
  } catch {
    return []
  }
}

export async function getPlacesSnapshot(
  citySlug:     string,
  categorySlug: string,
): Promise<Place[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return []
  try {
    const map = await getBlobMap()
    const entry = map.get(`seo/${citySlug}/${categorySlug}.json`)
    if (!entry) return []
    const res = await fetch(entry.url, {
      headers: { authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    })
    if (!res.ok) return []
    return (await res.json()) as Place[]
  } catch {
    return []
  }
}
