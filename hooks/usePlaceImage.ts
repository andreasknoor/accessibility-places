"use client"

import { useEffect, useMemo, useState } from "react"
import type { Place } from "@/lib/types"

function str(v: unknown): string | null {
  if (v == null || v === "" || v === "unknown") return null
  return String(v)
}

const commonsUrl = (file: string) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=500`

// Photo for a place's detail view, resolved from OSM only (the Google Places
// photo proxy was removed 2026-07 as a cost surface): the `image` tag →
// `wikimedia_commons` tag → the Wikidata item's P18 image. Returns null when
// nothing is found; callers render their own fallback and should also drop
// the URL on an <img> load error. Shared by Quickstart and Expert detail
// views (unified place UI), previously inline in PlaceDebugSheet.
export function usePlaceImage(place: Place): string | null {
  const osmRecord = place.sourceRecords.find((r) => r.sourceId === "osm")
  const osmMeta = osmRecord ? (osmRecord.metadata ?? osmRecord.raw) as Record<string, unknown> | null : null

  // Tag-based URLs need no network — derived directly.
  const tagUrl = useMemo(() => {
    if (!osmMeta) return null
    const imageTag = str(osmMeta.image)
    if (imageTag) {
      if (imageTag.startsWith("File:")) return commonsUrl(imageTag.slice(5))
      if (imageTag.startsWith("http")) return imageTag
      return null
    }
    const commonsTag = str(osmMeta.wikimedia_commons)
    return commonsTag?.startsWith("File:") ? commonsUrl(commonsTag.slice(5)) : null
  }, [osmMeta])

  const hasOwnImageTag = !!osmMeta && (str(osmMeta.image) != null || str(osmMeta.wikimedia_commons)?.startsWith("File:"))
  const wikidataId = osmMeta && !hasOwnImageTag ? str(osmMeta.wikidata) : null

  // Wikidata P18 lookup, keyed by the item id so a result for a previous
  // place can never leak into the next one.
  const [wikidata, setWikidata] = useState<{ id: string; url: string } | null>(null)
  useEffect(() => {
    if (!wikidataId) return
    const controller = new AbortController()
    fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&props=claims&format=json&origin=*`,
      { signal: controller.signal },
    )
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        const filename = data?.entities?.[wikidataId]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
        if (typeof filename === "string") setWikidata({ id: wikidataId, url: commonsUrl(filename.replace(/ /g, "_")) })
      })
      .catch(() => {})
    return () => controller.abort()
  }, [wikidataId])

  return tagUrl ?? (wikidata && wikidata.id === wikidataId ? wikidata.url : null)
}
