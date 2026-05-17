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
  parkingSpots?: { lat: number; lon: number; capacity?: number }[]
  center?:       { lat: number; lon: number }
  userLocation?: { lat: number; lon: number }
  selectedId?:   string
  panTrigger?:   number
  onSelect:      (place: Place) => void
  onShowInResults?:    (place: Place) => void
  isFullscreen:        boolean
  onToggleFullscreen:  () => void
  showFullscreenToggle?: boolean
  visible?:            boolean
}

const CONFIDENCE_COLORS = {
  high:   "#22c55e",   // green-500
  medium: "#eab308",   // yellow-500
  low:    "#ef4444",   // red-500
}

function markerColor(confidence: number): string {
  return CONFIDENCE_COLORS[confidenceLabel(confidence)]
}

function svgParkingMarker() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 26 26">
    <rect x="1" y="1" width="24" height="24" rx="5" fill="#1d4ed8" stroke="white" stroke-width="1.5"/>
    <text x="13" y="19" text-anchor="middle" font-size="15" font-weight="bold" fill="white" font-family="sans-serif">P</text>
  </svg>`
}

function svgMarker(color: string, selected: boolean) {
  const size   = selected ? 46 : 36
  const stroke = selected ? "#1d4ed8" : "#fff"
  const sw     = selected ? 3 : 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="9" fill="${color}" stroke="${stroke}" stroke-width="${sw}"/>
    <text x="12" y="16" text-anchor="middle" font-size="11" fill="white" font-family="sans-serif">♿</text>
  </svg>`
}

export default function MapView({
  places,
  parkingSpots,
  center,
  userLocation,
  selectedId,
  panTrigger,
  onSelect,
  onShowInResults,
  isFullscreen,
  onToggleFullscreen,
  showFullscreenToggle = true,
  visible,
}: Props) {
  const t        = useTranslations()
  const mapRef   = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInst  = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markers  = useRef<Map<string, any>>(new Map())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parkingMarkersRef = useRef<any[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userMarker = useRef<any>(null)
  const [mapReady, setMapReady] = useState(false)
  const onShowInResultsRef  = useRef(onShowInResults)
  const placesRef           = useRef(places)
  const userLocationRef     = useRef(userLocation)
  useEffect(() => { onShowInResultsRef.current = onShowInResults }, [onShowInResults])
  useEffect(() => { placesRef.current = places }, [places])
  useEffect(() => { userLocationRef.current = userLocation }, [userLocation])

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

  // Inject pulse animation CSS once
  useEffect(() => {
    if (document.getElementById("ap-user-loc-style")) return
    const style = document.createElement("style")
    style.id = "ap-user-loc-style"
    style.textContent = `
      @keyframes ap-pulse {
        0%   { transform:scale(1);   opacity:0.6; }
        70%  { transform:scale(2.8); opacity:0;   }
        100% { transform:scale(2.8); opacity:0;   }
      }
      .ap-user-dot { position:relative; width:22px; height:22px; }
      .ap-user-dot-ring {
        position:absolute; inset:0; border-radius:50%;
        background:rgba(59,130,246,0.35);
        animation:ap-pulse 2s ease-out infinite;
      }
      .ap-user-dot-inner {
        position:absolute; inset:4px; border-radius:50%;
        background:#3b82f6; border:2.5px solid #fff;
        box-shadow:0 1px 4px rgba(0,0,0,0.3);
      }
    `
    document.head.appendChild(style)
  }, [])

  // User location marker (only when userLocation prop is set)
  useEffect(() => {
    if (!mapInst.current || !L) return
    if (userLocation) {
      const icon = L.divIcon({
        html:      '<div class="ap-user-dot"><div class="ap-user-dot-ring"></div><div class="ap-user-dot-inner"></div></div>',
        className: "",
        iconSize:  [22, 22],
        iconAnchor:[11, 11],
      })
      if (userMarker.current) {
        userMarker.current.setLatLng([userLocation.lat, userLocation.lon])
        userMarker.current.setIcon(icon)
      } else {
        userMarker.current = L.marker(
          [userLocation.lat, userLocation.lon],
          { icon, zIndexOffset: 1000 },
        ).addTo(mapInst.current)
      }
    } else {
      userMarker.current?.remove()
      userMarker.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLocation, mapReady])

  // Parking spot markers — shown only when parkingSpots is a non-empty array
  useEffect(() => {
    if (!mapInst.current || !L) return
    for (const m of parkingMarkersRef.current) m.remove()
    parkingMarkersRef.current = []

    for (const spot of parkingSpots ?? []) {
      const icon = L.divIcon({
        html:       svgParkingMarker(),
        className:  "",
        iconSize:   [21, 21],
        iconAnchor: [10, 10],
      })
      const tooltipEl = document.createElement("div")
      tooltipEl.style.cssText = "text-align:center;line-height:1.4"
      tooltipEl.innerHTML = spot.capacity != null
        ? t.map.parkingSpots(spot.capacity).replace(/ ([^ ]*)$/, "<br>$1")
        : t.map.parkingSpot.replace(/ ([^ ]*)$/, "<br>$1")
      const marker = L.marker([spot.lat, spot.lon], { icon, zIndexOffset: -200 })
        .bindTooltip(tooltipEl, { permanent: false, direction: "top", offset: [0, -12] })
        .addTo(mapInst.current)
      parkingMarkersRef.current.push(marker)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parkingSpots, mapReady])

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

      const iconSz = isSelected ? 46 : 36
      const icon = L!.divIcon({
        html:        iconHtml,
        className:   "",
        iconSize:    [iconSz, iconSz],
        iconAnchor:  [iconSz / 2, iconSz],
        popupAnchor: [0, -iconSz - 4],
      })

      const existing = markers.current.get(place.id)
      if (existing) {
        existing.setIcon(icon)
      } else {
        const addr = [place.address.street, place.address.houseNumber, place.address.city]
          .filter(Boolean).join(" ")

        // Build popup content as a real DOM element so L.DomEvent.on can attach
        // the click handler — plain addEventListener and inline onclick both fail
        // on mobile because Leaflet intercepts touchstart on the popup container.
        const div = document.createElement("div")
        div.style.cssText = "font-family:sans-serif;font-size:13px;line-height:1.5"

        const parkingText = (() => {
          const p = place.accessibility.parking
          if (p.value === "yes" && (p.details as { nearbyOnly?: boolean } | undefined)?.nearbyOnly) {
            return t.a11y.yesNearby
          }
          return t.a11y[p.value] ?? p.value
        })()

        div.innerHTML = `
          <strong style="display:block;margin-bottom:4px">${place.name} <span style="color:${markerColor(place.overallConfidence)};font-weight:normal">(${Math.round(place.overallConfidence * 100)}%)</span></strong>
          ${addr ? `<div style="color:#666;font-size:11px;margin-bottom:6px">${addr}</div>` : ""}
          <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:11px">
            <span style="color:#888">${t.criteria.entrance}</span>
            <span style="color:${markerColor(place.accessibility.entrance.confidence)}">${t.a11y[place.accessibility.entrance.value] ?? place.accessibility.entrance.value}</span>
            <span style="color:#888">${t.criteria.toilet}</span>
            <span style="color:${markerColor(place.accessibility.toilet.confidence)}">${t.a11y[place.accessibility.toilet.value] ?? place.accessibility.toilet.value}</span>
            <span style="color:#888">${t.criteria.parking}</span>
            <span style="color:${markerColor(place.accessibility.parking.confidence)}">${parkingText}</span>
          </div>
          <div style="margin-top:6px;font-size:10px;color:#888">
            ${t.map.source}: ${SOURCE_LABELS[place.primarySource]}
          </div>
          ${onShowInResults ? `<button data-show-id style="display:block;margin-top:8px;font-size:11px;color:#2563eb;background:none;border:none;cursor:pointer;padding:0;text-decoration:underline;text-align:left">${t.map.showInResults} →</button>` : ""}
        `

        if (onShowInResults) {
          const btn = div.querySelector<HTMLElement>("[data-show-id]")
          if (btn) {
            const capturedId = place.id
            L!.DomEvent.on(btn, "click", (ev: Event) => {
              L!.DomEvent.stopPropagation(ev)
              const p = placesRef.current.find((pl) => pl.id === capturedId)
              if (p) onShowInResultsRef.current?.(p)
            })
          }
        }
        const popup = L!.popup({ maxWidth: 260 }).setContent(div)

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

    // Fit bounds to show all results; include user location when in nearby mode
    if (places.length > 0) {
      const latlngs: [number, number][] = places.map((p) => [p.coordinates.lat, p.coordinates.lon])
      const ul = userLocationRef.current
      if (ul) latlngs.push([ul.lat, ul.lon])
      mapInst.current.fitBounds(L!.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 15 })
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
        const latlngs: [number, number][] = places.map((p) => [p.coordinates.lat, p.coordinates.lon])
        const ul = userLocationRef.current
        if (ul) latlngs.push([ul.lat, ul.lon])
        mapInst.current?.fitBounds(L!.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 15 })
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

      {showFullscreenToggle && (
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
      )}
    </div>
  )
}
