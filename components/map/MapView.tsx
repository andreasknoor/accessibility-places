"use client"

import dynamic from "next/dynamic"
import type { MapViewProps } from "@/lib/map/types"

// Internal engine switch for the MapLibre migration (issue #48). NOT a
// user-facing toggle — see the "dual-map" decision in the issue: this flag
// exists only to de-risk rollout (A/B on real devices, a rollback lever) and
// has an explicit deletion criterion (Phase 4, step 17: delete this file's
// branching, MapViewLeaflet.tsx, and the Leaflet dependencies once MapLibre
// is the sole implementation). Every consumer (HomeClient, MobileLayout,
// SimpleLayout) imports this file and only this file — neither implementation
// is referenced directly anywhere else, so the eventual cutover touches
// nothing outside components/map/.
const MAP_ENGINE = process.env.NEXT_PUBLIC_MAP_ENGINE === "maplibre" ? "maplibre" : "leaflet"

const MapViewLeaflet = dynamic(() => import("@/components/map/MapViewLeaflet"), { ssr: false })
const MapViewGL      = dynamic(() => import("@/components/map/MapViewGL"),      { ssr: false })

export default function MapView(props: MapViewProps) {
  return MAP_ENGINE === "maplibre" ? <MapViewGL {...props} /> : <MapViewLeaflet {...props} />
}
