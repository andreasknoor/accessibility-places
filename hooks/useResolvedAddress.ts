"use client"

import { useEffect, useState } from "react"
import type { Place } from "@/lib/types"

// "Street 1, 12345 City" for a place, falling back to a reverse-geocoded
// address when the sources carried none (common for OSM nodes without
// addr:* tags). Empty string while unknown. Previously inline in
// PlaceDebugSheet; shared by both detail views of the unified place UI.
export function useResolvedAddress(place: Place): string {
  const addr = place.address
  const line1 = [addr.street, addr.houseNumber].filter(Boolean).join(" ")
  const line2 = [addr.postalCode, addr.city].filter(Boolean).join(" ")
  const own = [line1, line2].filter(Boolean).join(", ")
  const [resolved, setResolved] = useState<string | null>(null)

  const { lat, lon } = place.coordinates
  useEffect(() => {
    if (own) return
    fetch(`/api/geocode/reverse?lat=${lat}&lon=${lon}&detail=1`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return
        const l1 = [d.street, d.houseNumber].filter(Boolean).join(" ")
        const l2 = [d.postalCode, d.city].filter(Boolean).join(" ")
        const full = [l1, l2].filter(Boolean).join(", ")
        if (full) setResolved(full)
      })
      .catch(() => {})
  }, [own, lat, lon])

  return own || resolved || ""
}
