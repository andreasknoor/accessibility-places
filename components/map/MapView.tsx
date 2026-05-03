"use client"

import { useEffect, useRef, useState } from "react"
import { Maximize2, Minimize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/lib/i18n"
import { SOURCE_LABELS } from "@/lib/config"
import { confidenceLabel } from "@/lib/matching/merge"
import type { Place } from "@/lib/types"

// Leaflet is ESM-only — loaded dynamically to avoid SSR issues
let L: typeof import("leaflet") | null = null

interface Props {
  places:        Place[]
  center?:       { lat: number; lon: number }
  selectedId?:   string
  panTrigger?:   number
  onSelect:      (place: Place) => void
  isFullscreen:  boolean
  onToggleFullscreen: () => void
  visible?:      boolean
}

const CONFIDENCE_COLORS = {
  high:   "#22c55e",   // green-500
  medium: "#eab308",   // yellow-500
  low:    "#ef4444",   // red-500
}

function markerColor(confidence: number): string {
  return CONFIDENCE_COLORS[confidenceLabel(confidence)]
}

function svgMarker(color: string, selected: boolean) {
  const size   = selected ? 38 : 30
  const stroke = selected ? "#1d4ed8" : "#fff"
  const sw     = selected ? 3 : 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="9" fill="${color}" stroke="${stroke}" stroke-width="${sw}"/>
    <text x="12" y="16" text-anchor="middle" font-size="11" fill="white" font-family="sans-serif">♿</text>
  </svg>`
}

export default function MapView({
  places,
  center,
  selectedId,
  panTrigger,
  onSelect,
  isFullscreen,
  onToggleFullscreen,
  visible,
}: Props) {
  const t        = useTranslations()
  const mapRef   = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInst  = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markers  = useRef<Map<string, any>>(new Map())
  const [mapReady, setMapReady] = useState(false)

  // Init map once
  useEffect(() => {
    if (!mapRef.current || mapInst.current) return

    let cancelled = false

    async function init() {
      L = (await import("leaflet")).default
      await import("leaflet/dist/leaflet.css")

      // Guard: effect may have been cleaned up while awaiting dynamic imports
      if (cancelled || mapInst.current || !mapRef.current) return

      const map = L.map(mapRef.current, {
        center:             [51.165691, 10.451526],
        zoom:               6,
        zoomControl:        true,
        attributionControl: true,
      })

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map)

      mapInst.current = map
      setMapReady(true)
    }
    init()

    return () => {
      cancelled = true
      if (mapInst.current) {
        mapInst.current.remove()
        mapInst.current = null
      }
    }
  }, [])

  // Update markers when places change
  useEffect(() => {
    if (!mapInst.current || !L) return

    // Remove stale markers
    const currentIds = new Set(places.map((p) => p.id))
    for (const [id, m] of markers.current) {
      if (!currentIds.has(id)) {
        m.remove()
        markers.current.delete(id)
      }
    }

    // Add / update markers
    for (const place of places) {
      const isSelected = place.id === selectedId
      const color      = markerColor(place.overallConfidence)
      const iconHtml   = svgMarker(color, isSelected)

      const icon = L!.divIcon({
        html:      iconHtml,
        className: "",
        iconSize:  [isSelected ? 38 : 30, isSelected ? 38 : 30],
        iconAnchor:[isSelected ? 19 : 15, isSelected ? 38 : 30],
      })

      const existing = markers.current.get(place.id)
      if (existing) {
        existing.setIcon(icon)
      } else {
        const addr = [place.address.street, place.address.houseNumber, place.address.city]
          .filter(Boolean).join(" ")

        const popup = L!.popup({ maxWidth: 260 }).setContent(`
          <div style="font-family:sans-serif;font-size:13px;line-height:1.5">
            <strong style="display:block;margin-bottom:4px">${place.name}</strong>
            ${addr ? `<div style="color:#666;font-size:11px;margin-bottom:6px">${addr}</div>` : ""}
            <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:11px">
              <span style="color:#888">${t.criteria.entrance}</span>
              <span style="color:${markerColor(place.accessibility.entrance.confidence)}">${place.accessibility.entrance.value}</span>
              <span style="color:#888">${t.criteria.toilet}</span>
              <span style="color:${markerColor(place.accessibility.toilet.confidence)}">${place.accessibility.toilet.value}</span>
              <span style="color:#888">${t.criteria.parking}</span>
              <span style="color:${markerColor(place.accessibility.parking.confidence)}">${place.accessibility.parking.value}</span>
            </div>
            <div style="margin-top:6px;font-size:10px;color:#888">
              ${t.map.source}: ${SOURCE_LABELS[place.primarySource]}
            </div>
          </div>
        `)

        const marker = L!.marker(
          [place.coordinates.lat, place.coordinates.lon],
          { icon },
        )
          .addTo(mapInst.current)
          .bindPopup(popup)
          .on("click", () => onSelect(place))

        markers.current.set(place.id, marker)
      }
    }

    // Always fit bounds to show all results when places are present
    if (places.length > 0) {
      const bounds = L!.latLngBounds(
        places.map((p) => [p.coordinates.lat, p.coordinates.lon] as [number, number]),
      )
      mapInst.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, selectedId, mapReady])

  // Pan to selected — also re-fires when panTrigger increments so that
  // clicking the same result after manually panning the map still re-centers.
  useEffect(() => {
    if (!mapInst.current || !selectedId) return
    const place = places.find((p) => p.id === selectedId)
    if (!place) return
    mapInst.current.panTo([place.coordinates.lat, place.coordinates.lon])
    markers.current.get(selectedId)?.openPopup()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, panTrigger, mapReady])

  // Pan to center — only when no results (e.g. failed search or initial state)
  useEffect(() => {
    if (!mapInst.current || !center || places.length > 0) return
    mapInst.current.setView([center.lat, center.lon], 13)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, mapReady])

  // Re-measure and re-center whenever the map container becomes visible.
  // Called for both tab reveals and fullscreen toggles — both change the
  // container dimensions from Leaflet's perspective.
  // We wait one frame for the browser to apply the CSS class, then call
  // invalidateSize so Leaflet knows the real container bounds, then
  // re-apply fitBounds/setView so the second search centers correctly.
  useEffect(() => {
    const isVisible = visible !== false  // default true for non-tab contexts
    if (!isVisible || !mapInst.current || !L) return
    const id = setTimeout(() => {
      mapInst.current?.invalidateSize()
      if (places.length > 0) {
        const bounds = L!.latLngBounds(
          places.map((p) => [p.coordinates.lat, p.coordinates.lon] as [number, number]),
        )
        mapInst.current?.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
      } else if (center) {
        mapInst.current?.setView([center.lat, center.lon], 13)
      }
    }, 50)
    return () => clearTimeout(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, isFullscreen])

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="w-full h-full" />

      {/* Fullscreen toggle */}
      <Button
        size="icon"
        variant="secondary"
        onClick={onToggleFullscreen}
        className="absolute top-3 right-3 z-[1000] shadow-md"
        title={isFullscreen ? t.map.exitFullscreen : t.map.fullscreen}
      >
        {isFullscreen
          ? <Minimize2 className="w-4 h-4" />
          : <Maximize2 className="w-4 h-4" />
        }
      </Button>
    </div>
  )
}
