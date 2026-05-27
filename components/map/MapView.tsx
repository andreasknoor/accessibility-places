"use client"

import { useEffect, useRef, useState } from "react"
import { Maximize2, Minimize2, CircleParking, X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/lib/i18n"
import { SOURCE_LABELS } from "@/lib/config"
import { confidenceLabel } from "@/lib/matching/merge"
import { haversineMetres } from "@/lib/matching/match"
import type { Place, ParkingSpot } from "@/lib/types"

// Leaflet is ESM-only — loaded dynamically to avoid SSR issues
let L: typeof import("leaflet") | null = null

const PLACE_CLUSTER_MAX_RADIUS = 50            // px — grouping radius at low zoom
const PLACE_CLUSTER_DISABLE_AT_ZOOM = 17       // street-level: always show every pin

interface Props {
  places:        Place[]
  parkingSpots?: ParkingSpot[]
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
  showParking?:        boolean
  onToggleParking?:    () => void
  autoZoom?:           boolean
  // Parkplatz-Modus: focuses the map on disabled-parking spots within
  // `parkingFocusRadiusKm` of the user's GPS location. Place pins are hidden,
  // a banner indicates the mode. Only shown when in nearby search mode with GPS.
  parkingFocusMode?:       boolean
  onEnterParkingFocus?:    () => void
  onExitParkingFocus?:     () => void
  parkingFocusRadiusKm?:   number
  isParkingFocusLoading?:  boolean
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
  showParking,
  onToggleParking,
  autoZoom = true,
  parkingFocusMode = false,
  onEnterParkingFocus,
  onExitParkingFocus,
  parkingFocusRadiusKm,
  isParkingFocusLoading = false,
}: Props) {
  const t        = useTranslations()
  const mapRef   = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInst  = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const placeClusterRef = useRef<any>(null)
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
      // Marker clustering: behavior CSS only — the default theme is replaced
      // by our custom .ap-cluster-* styles below.
      await import("leaflet.markercluster")
      await import("leaflet.markercluster/dist/MarkerCluster.css")

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Lany = L as any
      placeClusterRef.current = Lany.markerClusterGroup({
        maxClusterRadius:         PLACE_CLUSTER_MAX_RADIUS,
        disableClusteringAtZoom:  PLACE_CLUSTER_DISABLE_AT_ZOOM,
        spiderfyOnMaxZoom:        true,
        spiderfyDistanceMultiplier: 1.5,
        showCoverageOnHover:      false,
        removeOutsideVisibleBounds: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        iconCreateFunction: (cluster: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const children = cluster.getAllChildMarkers() as any[]
          const best = children.reduce(
            (m: number, c) => Math.max(m, (c.options.placeConfidence ?? 0) as number),
            0,
          )
          const color = markerColor(best)
          const count = cluster.getChildCount()
          const sizeClass = count >= 100 ? "lg" : count >= 10 ? "md" : "sm"
          const size      = count >= 100 ? 48  : count >= 10 ? 42  : 36
          return L!.divIcon({
            html: `<div class="ap-cluster ap-cluster-${sizeClass}" style="background:${color}"><span>${count}</span></div>`,
            className: "ap-cluster-divicon",
            iconSize:  [size, size],
            iconAnchor:[size / 2, size / 2],
          })
        },
      })
      placeClusterRef.current.addTo(map)

      setMapReady(true)
    }
    init()

    return () => {
      cancelled = true
      if (mapInst.current) {
        mapInst.current.remove()
        mapInst.current = null
      }
      placeClusterRef.current = null
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
      .ap-cluster-divicon { background:transparent; border:0; }
      .ap-cluster {
        width:100%; height:100%; border-radius:50%;
        display:flex; align-items:center; justify-content:center;
        color:#fff; font-family:sans-serif; font-weight:600;
        border:3px solid #fff;
        box-shadow:0 1px 4px rgba(0,0,0,0.3);
        cursor:pointer;
      }
      .ap-cluster-sm { font-size:13px; }
      .ap-cluster-md { font-size:14px; }
      .ap-cluster-lg { font-size:15px; }
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

  // Parking spot markers — shown only when parkingSpots is a non-empty array.
  // In focus mode all spots render regardless of the showParking toggle.
  useEffect(() => {
    if (!mapInst.current || !L) return
    for (const m of parkingMarkersRef.current) m.remove()
    parkingMarkersRef.current = []

    for (const spot of parkingSpots ?? []) {
      const icon = L.divIcon({
        html:        svgParkingMarker(),
        className:   "",
        iconSize:    [21, 21],
        iconAnchor:  [10, 10],
        popupAnchor: [0, -11],
      })

      // Distance to nearest place in current results (placesRef updated before this effect runs)
      const nearestDist = placesRef.current.reduce((min, p) => {
        const d = haversineMetres(spot, p.coordinates)
        return d < min ? d : min
      }, Infinity)
      const distText = Number.isFinite(nearestDist)
        ? t.results.distanceFromHere(Math.round(nearestDist))
        : null

      // Fee badge: show only when tag is present
      const feeText = spot.fee === "no"  ? t.map.parkingFree
                    : spot.fee === "yes" ? t.map.parkingPaid
                    : spot.fee ?? null   // raw value (rare price strings like "EUR 1.00")

      // Access badge: show only when non-public restriction is present
      const accessText = spot.access === "private"   ? t.map.parkingPrivate
                       : spot.access === "customers" ? t.map.parkingCustomers
                       : null

      // Max-stay label + raw OSM value (already human-readable: "2 hours", "30 minutes")
      const maxstayText = spot.maxstay ?? null

      const title   = spot.capacity != null ? t.map.parkingSpots(spot.capacity) : t.map.parkingSpot
      const mapsUrl = `https://www.google.com/maps?q=${spot.lat},${spot.lon}`

      const div = document.createElement("div")
      div.style.cssText = "font-family:sans-serif;font-size:12px;line-height:1.6;min-width:140px"
      div.innerHTML = `
        <div style="font-weight:600;margin-bottom:5px">${title}</div>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:11px;margin-bottom:6px">
          ${distText     ? `<span style="color:#888">↔</span><span>${distText}</span>` : ""}
          ${feeText      ? `<span style="color:#888">€</span><span>${feeText}</span>` : ""}
          ${maxstayText  ? `<span style="color:#888">${t.map.parkingMaxstay}</span><span>${maxstayText}</span>` : ""}
          ${accessText   ? `<span style="color:#888">🔒</span><span style="color:#b45309">${accessText}</span>` : ""}
        </div>
        <span data-gmaps style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#2563eb;cursor:pointer;text-decoration:underline">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          ${t.results.googleMapsLink}
        </span>
      `
      // Use L.DomEvent.on (not addEventListener) — plain addEventListener and
      // inline onclick fail on mobile because Leaflet intercepts touchstart.
      const gmapsBtn = div.querySelector<HTMLElement>("[data-gmaps]")
      if (gmapsBtn) {
        L!.DomEvent.on(gmapsBtn, "click", (ev: Event) => {
          L!.DomEvent.stopPropagation(ev)
          window.open(mapsUrl, "_blank", "noopener,noreferrer")
        })
      }

      const marker = L.marker([spot.lat, spot.lon], { icon, zIndexOffset: -200 })
        .bindPopup(div, { maxWidth: 240 })
        .addTo(mapInst.current)
      parkingMarkersRef.current.push(marker)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parkingSpots, mapReady])

  // Update markers when places change. In Parkplatz-Modus the cluster is
  // cleared so only parking spots and the user dot remain visible.
  useEffect(() => {
    if (!mapInst.current || !L || !placeClusterRef.current) return

    if (parkingFocusMode) {
      placeClusterRef.current.clearLayers()
      markers.current.clear()
      return
    }

    // Remove stale markers
    const currentIds = new Set(places.map((p) => p.id))
    for (const [id, m] of markers.current) {
      if (!currentIds.has(id)) {
        placeClusterRef.current.removeLayer(m)
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
          // placeConfidence is read by the cluster's iconCreateFunction so the
          // cluster colour reflects the best contained confidence.
          { icon, placeConfidence: place.overallConfidence } as L.MarkerOptions & { placeConfidence: number },
        )
          .bindPopup(popup)
          .on("click", () => onSelect(place))

        placeClusterRef.current.addLayer(marker)
        markers.current.set(place.id, marker)
      }
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, selectedId, mapReady, parkingFocusMode])

  // Fit bounds to show all results — runs only when places changes, not on marker click.
  // Separating this from the selectedId effect prevents fitBounds from firing when the
  // user clicks a marker (which changes selectedId but not places).
  // Skipped entirely when autoZoom is disabled.
  useEffect(() => {
    if (!mapInst.current || !L || places.length === 0 || !autoZoom) return
    if (parkingFocusMode) return  // focus-mode fit handled below
    const latlngs: [number, number][] = places.map((p) => [p.coordinates.lat, p.coordinates.lon])
    const ul = userLocationRef.current
    if (ul) latlngs.push([ul.lat, ul.lon])
    mapInst.current.fitBounds(L!.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 15 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, mapReady, autoZoom, parkingFocusMode])

  // Pan/zoom to selected — also re-fires when panTrigger increments so that
  // clicking the same result after manually panning the map still re-centers.
  // If the marker is currently inside a cluster, zoomToShowLayer animates the
  // map to a zoom level where the marker becomes individually visible, then
  // opens its popup. For uncluttered markers it pans without changing zoom.
  useEffect(() => {
    if (!mapInst.current || !selectedId) return
    const marker = markers.current.get(selectedId)
    if (!marker || !placeClusterRef.current) return
    placeClusterRef.current.zoomToShowLayer(marker, () => marker.openPopup())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, panTrigger, mapReady])

  // Pan to center — only when no results (e.g. failed search, initial state, or parking-only view)
  // When parking spots are visible without venue results, fit the view to all spots + GPS location.
  // In focus mode we always fit to spots regardless of how many places exist.
  useEffect(() => {
    if (!mapInst.current) return
    if (!parkingFocusMode && places.length > 0) return
    const spots = parkingSpots ?? []
    if (spots.length > 0) {
      const latlngs: [number, number][] = spots.map((s) => [s.lat, s.lon])
      const ul = userLocationRef.current
      if (ul) latlngs.push([ul.lat, ul.lon])
      mapInst.current.fitBounds(L!.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 16 })
      return
    }
    if (!center) return
    mapInst.current.setView([center.lat, center.lon], 13)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, parkingSpots, mapReady, parkingFocusMode])

  // ESC key exits Parkplatz-Modus.
  useEffect(() => {
    if (!parkingFocusMode || !onExitParkingFocus) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onExitParkingFocus!()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [parkingFocusMode, onExitParkingFocus])

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
      } else {
        const spots = parkingSpots ?? []
        if (spots.length > 0) {
          const latlngs: [number, number][] = spots.map((s) => [s.lat, s.lon])
          const ul = userLocationRef.current
          if (ul) latlngs.push([ul.lat, ul.lon])
          mapInst.current?.fitBounds(L!.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 16 })
        } else if (center) {
          mapInst.current?.setView([center.lat, center.lon], 13)
        }
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

      {/* ── Parkplatz-Modus banner (top) ── */}
      {parkingFocusMode && (
        <div
          role="status"
          aria-live="polite"
          className="absolute top-3 left-3 right-14 z-[1000] flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium shadow-md border border-blue-200 bg-blue-50 text-blue-900"
        >
          <CircleParking className="w-4 h-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate">
            {(parkingSpots?.length ?? 0) === 0 && !isParkingFocusLoading
              ? t.map.parkingFocusEmpty
              : t.map.parkingFocusActive(parkingFocusRadiusKm ?? 1)}
          </span>
          {onExitParkingFocus && (
            <button
              onClick={onExitParkingFocus}
              className="shrink-0 rounded p-1 hover:bg-blue-100 transition-colors"
              aria-label={t.map.parkingFocusExit}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* ── Bottom-left controls (stacked) ── */}
      <div className="absolute bottom-3 left-3 z-[1000] flex flex-col gap-2 items-start">
        {onEnterParkingFocus && !parkingFocusMode && (
          <button
            onClick={onEnterParkingFocus}
            disabled={isParkingFocusLoading}
            title={t.map.parkingFocusEnter}
            className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium shadow-md border border-border bg-background/95 backdrop-blur-sm transition-colors hover:bg-muted disabled:opacity-60 disabled:cursor-wait"
          >
            {isParkingFocusLoading
              ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              : <CircleParking className="w-4 h-4" aria-hidden />
            }
            <span>{t.map.parkingFocusEnter}</span>
          </button>
        )}

        {onToggleParking && (
          <button
            onClick={parkingFocusMode ? undefined : onToggleParking}
            role="switch"
            aria-checked={showParking}
            aria-disabled={parkingFocusMode}
            disabled={parkingFocusMode}
            title={t.map.toggleParking}
            className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium shadow-md border border-border bg-background/95 backdrop-blur-sm transition-colors hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-background/95"
          >
            <span aria-hidden>🅿</span>
            <span className="hidden sm:inline">{t.map.nearbyParking}</span>
            {/* Toggle track */}
            <span className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors ${showParking || parkingFocusMode ? "bg-blue-600" : "bg-muted-foreground/40"}`}>
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${showParking || parkingFocusMode ? "translate-x-3" : "translate-x-0.5"}`} />
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
