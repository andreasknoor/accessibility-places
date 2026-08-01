"use client"

import dynamic from "next/dynamic"
import type { MapViewProps } from "@/lib/map/types"

// MapLibre GL JS + OpenFreeMap (issue #48 migration, cutover complete v12.0).
// Was a thin internal-flag switcher between this and the pre-migration
// Leaflet implementation (MapViewLeaflet.tsx, deleted at cutover) — every
// consumer (HomeClient, MobileLayout, SimpleLayout) imports this file and
// only this file, so the switch touched nothing outside components/map/.
const MapViewGL = dynamic(() => import("@/components/map/MapViewGL"), { ssr: false })

export default function MapView(props: MapViewProps) {
  return <MapViewGL {...props} />
}
