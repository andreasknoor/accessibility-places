"use client"

import { useEffect, useRef, useState } from "react"
import { Maximize2, Minimize2, Search, LocateFixed, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/lib/i18n"
import { SOURCE_LABELS } from "@/lib/config"
import { CATEGORY_ICONS } from "@/lib/category-icons"
import { openExternalUrl } from "@/lib/native/browser"
import { confidenceLabel } from "@/lib/matching/merge"
import { haversineMetres } from "@/lib/matching/match"
import type { Place, ParkingSpot, AmenityFeature, AmenityTier } from "@/lib/types"

// Leaflet is ESM-only — loaded dynamically to avoid SSR issues
let L: typeof import("leaflet") | null = null

const PLACE_CLUSTER_MAX_RADIUS = 50            // px — grouping radius at low zoom
const PLACE_CLUSTER_DISABLE_AT_ZOOM = 17       // street-level: always show every pin

interface Props {
  places:        Place[]
  parkingSpots?: ParkingSpot[]
  toiletSpots?:  AmenityFeature[]
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
  showToilets?:        boolean
  isLoading?:          boolean
  // Called when the user picks a segment in the map-layer control.
  // Replaces the old onToggleParking single-toggle.
  onSetMapLayers?:     (parking: boolean, toilets: boolean) => void
  hasToiletData?:      boolean   // controls whether WC segments are shown
  autoZoom?:           boolean
  // Amenity focus mode: when true, hides place markers and shows only the
  // GPS-radius amenity spots (parking and/or WCs). Triggered from the ChatPanel
  // layer chips in nearby mode. The caller decides which layers are active and
  // passes the already-filtered spots — MapView only needs the boolean.
  focusMode?:              boolean
  // Whether the weak "accessible" parking tier is enabled — drives the legend
  // (the yellow entry is only relevant when those markers can appear).
  showWeakParking?:        boolean
  // Called when the user pans the map and clicks "Search here". Receives the
  // new map centre; caller should re-run the last search at that location.
  onSearchHere?:           (center: { lat: number; lon: number }) => void
  // Called when the user taps the locate button. Should resolve with GPS coords
  // or reject on permission denial / timeout. MapView tracks loading + error state.
  onLocate?:               () => Promise<void>
  // Incrementing this key triggers MapView to pan to the current userLocation
  // at zoom 16. Stamped as programmatic so "search here" is NOT auto-shown by
  // moveend — instead the button is shown explicitly (Option 2).
  locatePanTrigger?:       number
}

const CONFIDENCE_COLORS = {
  high:   "#22c55e",   // green-500
  medium: "#eab308",   // yellow-500
  low:    "#ef4444",   // red-500
}

function markerColor(confidence: number): string {
  return CONFIDENCE_COLORS[confidenceLabel(confidence)]
}

// Parking marker colours per tier.
// "strong" (reserved disabled bays) = blue "P"; "weak" (wheelchair=yes lot) = amber with dark "P"
// (white-on-amber fails contrast — this is an accessibility app).
const PARKING_TIER_STYLE: Record<AmenityTier, { fill: string; text: string }> = {
  strong: { fill: "#1d4ed8", text: "white"   }, // blue-700, white P
  weak:   { fill: "#eab308", text: "#1f2937" }, // yellow-500, dark P
}

function svgParkingMarker(tier: AmenityTier = "strong") {
  const { fill, text } = PARKING_TIER_STYLE[tier]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 26 26">
    <rect x="1" y="1" width="24" height="24" rx="5" fill="${fill}" stroke="white" stroke-width="1.5"/>
    <text x="13" y="19" text-anchor="middle" font-size="15" font-weight="bold" fill="${text}" font-family="sans-serif">P</text>
  </svg>`
}

// WC marker colours encode the HOST type (not the tier): standalone public WCs
// = green, WCs inside a venue = violet — analogous to the parking blue/yellow
// split. The tier (designated vs. yes) is shown in the popup instead. Each has a
// darker border of its own hue so it reads as a solid badge on the map tiles.
type ToiletHost = "standalone" | "venue"
const TOILET_HOST_STYLE: Record<ToiletHost, { fill: string; stroke: string }> = {
  standalone: { fill: "#166534", stroke: "#14532d" }, // green-800 / green-900 border
  venue:      { fill: "#7c3aed", stroke: "#5b21b6" }, // violet-600 / violet-800 border
}

function svgToiletMarker(host: ToiletHost = "standalone") {
  const { fill, stroke } = TOILET_HOST_STYLE[host]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 30 30">
    <rect x="1.5" y="1.5" width="27" height="27" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="3"/>
    <text x="15" y="22" text-anchor="middle" font-size="16">🚻</text>
  </svg>`
}

// A moveend firing within this window after a programmatic move is treated as
// app-driven (animation tail, popup autoPan, etc.) rather than a user pan.
// Comfortably covers Leaflet's ~250 ms pan/zoom animations plus popup autoPan.
const PROGRAMMATIC_MOVE_WINDOW_MS = 700

function svgMarker(color: string, selected: boolean, emoji: string) {
  const w      = selected ? 41 : 30
  const h      = selected ? 54 : 39
  const stroke = selected ? "#1d4ed8" : "#fff"
  const sw     = selected ? 2.5 : 1.5
  // Pin shape: circular head (center ≈ 13,12) tapering to a tip at (13,32)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 26 34">
    <path d="M13,1.5 C7.2,1.5 2.5,6.2 2.5,12 C2.5,19.5 13,32.5 13,32.5 C13,32.5 23.5,19.5 23.5,12 C23.5,6.2 18.8,1.5 13,1.5 Z"
      fill="${color}" stroke="${stroke}" stroke-width="${sw}"/>
    <text x="13" y="15.5" text-anchor="middle" font-size="13">${emoji}</text>
  </svg>`
}

export default function MapView({
  places,
  parkingSpots,
  toiletSpots,
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
  showToilets,
  onSetMapLayers,
  hasToiletData = false,
  isLoading = false,
  autoZoom = true,
  focusMode = false,
  showWeakParking = false,
  onSearchHere,
  onLocate,
  locatePanTrigger,
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
  const toiletMarkersRef  = useRef<any[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userMarker = useRef<any>(null)
  const [mapReady, setMapReady] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  function esc(s: string) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  }

  const onShowInResultsRef  = useRef(onShowInResults)
  const placesRef           = useRef(places)
  const userLocationRef     = useRef(userLocation)
  const searchCenterRef     = useRef(center)
  const onSearchHereRef     = useRef(onSearchHere)
  const focusModeRef        = useRef(focusMode)
  useEffect(() => { onShowInResultsRef.current = onShowInResults }, [onShowInResults])
  useEffect(() => { placesRef.current = places }, [places])
  useEffect(() => { userLocationRef.current = userLocation }, [userLocation])
  useEffect(() => { searchCenterRef.current = center }, [center])
  useEffect(() => { onSearchHereRef.current = onSearchHere }, [onSearchHere])
  useEffect(() => { focusModeRef.current = focusMode }, [focusMode])

  // Floating "search here" button state — set when user pans away from search centre.
  const [searchHereCenter, setSearchHereCenter] = useState<{ lat: number; lon: number } | null>(null)
  // Locate button interaction state
  const [locating,          setLocating]          = useState(false)
  const [locateErrorVisible, setLocateErrorVisible] = useState(false)
  // Timestamp of the last programmatic move (setView/fitBounds/zoomToShowLayer).
  // A moveend within PROGRAMMATIC_MOVE_WINDOW_MS of this is treated as app-driven
  // and ignored; any later moveend must be a real user pan. This time-window
  // approach is self-healing: a programmatic move that fires 0, 1, or N moveends
  // (or a no-op move that fires none) can never desync a counter. Replaces the
  // old dragend flag, which iOS WKWebView fires unreliably for touch pans.
  const lastProgrammaticMoveRef = useRef(Date.now())
  // Last search center the pan-to-center effect has seen. Lets it recenter only on
  // a real center change (new search), not when a mode switch merely clears the
  // results/spots while the old center lingers.
  const prevCenterRef = useRef<{ lat: number; lon: number } | null>(null)

  // Dismiss the button whenever a new search result arrives (centre changed).
  useEffect(() => { setSearchHereCenter(null) }, [center])

  // Pan to userLocation when locatePanTrigger increments (locate button tapped).
  // Stamp the move as programmatic so moveend does NOT show "search here" via the
  // normal pan-detection path. Instead we show it explicitly below (Option 2):
  // the button is offered directly after a successful locate so the user can
  // repeat their last search at their position with one more tap.
  useEffect(() => {
    if (locatePanTrigger === undefined || !mapInst.current || !L) return
    // Read the prop directly (not the ref): the prop and the trigger update in the
    // same commit, so the closure value is fresh — no chance of centring on a stale
    // ref. animate:false lands exactly on the point (an interrupted pan animation
    // would otherwise stop slightly off-centre).
    const ul = userLocation
    if (!ul) return
    lastProgrammaticMoveRef.current = Date.now()
    mapInst.current.setView([ul.lat, ul.lon], 14, { animate: false })  // ~2 km radius visible
    // Option 2: show "search here" explicitly if a previous search exists
    if (onSearchHereRef.current) {
      setSearchHereCenter({ lat: ul.lat, lon: ul.lon })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locatePanTrigger, mapReady])

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

      // Refresh the suppression window now that the map exists — async imports may
      // have elapsed well over the window since the ref was first initialised.
      lastProgrammaticMoveRef.current = Date.now()

      // "Search here" — detect user-initiated pans via moveend (fires reliably on
      // both mouse and touch, unlike dragend). Every programmatic move stamps
      // lastProgrammaticMoveRef just before it runs; a moveend within the window
      // after that stamp is app-driven and ignored. Any later moveend is a user pan.
      map.on("moveend", () => {
        // No "search here" in amenity focus mode — it would re-run the venue
        // search and silently drop the parking/WC focus layers.
        if (focusModeRef.current) return
        if (Date.now() - lastProgrammaticMoveRef.current < PROGRAMMATIC_MOVE_WINDOW_MS) return
        if (!onSearchHereRef.current || !searchCenterRef.current) return
        const newCenter = map.getCenter()
        const bounds    = map.getBounds()
        const minSpan   = Math.min(
          bounds.getNorth() - bounds.getSouth(),
          bounds.getEast()  - bounds.getWest(),
        )
        const threshold = 0.25 * minSpan
        const sc = searchCenterRef.current
        if (Math.abs(newCenter.lat - sc.lat) > threshold ||
            Math.abs(newCenter.lng - sc.lon) > threshold) {
          setSearchHereCenter({ lat: newCenter.lat, lon: newCenter.lng })
        } else {
          setSearchHereCenter(null)
        }
      })

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
      const tier: AmenityTier = spot.tier === "weak" ? "weak" : "strong"
      const icon = L.divIcon({
        html:        svgParkingMarker(tier),
        className:   "",
        iconSize:    [21, 21],
        iconAnchor:  [10, 10],
        popupAnchor: [0, -11],
      })

      // Distance to nearest place in current results (placesRef updated before this effect runs)
      const nearest = placesRef.current.reduce<{ name: string; dist: number } | null>((best, p) => {
        const d = haversineMetres(spot, p.coordinates)
        return best === null || d < best.dist ? { name: p.name, dist: d } : best
      }, null)
      const distText = nearest !== null
        ? t.map.parkingDistanceTo(t.results.distanceFromHere(Math.round(nearest.dist)), esc(nearest.name))
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

      // Word-label per tier — colour alone must never carry the meaning (a11y).
      const title = tier === "weak"
        ? t.map.parkingAccessible
        : spot.capacity != null ? t.map.parkingSpots(spot.capacity) : t.map.parkingSpot
      const subtitle = tier === "weak" ? t.map.parkingAccessibleHint : null
      const mapsUrl = `https://www.google.com/maps?q=${spot.lat},${spot.lon}`

      const div = document.createElement("div")
      div.style.cssText = "font-family:sans-serif;font-size:12px;line-height:1.6;min-width:140px"
      div.innerHTML = `
        <div style="font-weight:600;margin-bottom:${subtitle ? "1px" : "5px"}">${title}</div>
        ${subtitle ? `<div style="color:#b45309;font-size:11px;margin-bottom:5px">${subtitle}</div>` : ""}
        <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:11px;margin-bottom:6px">
          ${distText     ? `<span style="color:#888">↔</span><span>${distText}</span>` : ""}
          ${feeText      ? `<span style="color:#888">€</span><span>${esc(feeText)}</span>` : ""}
          ${maxstayText  ? `<span style="color:#888">${t.map.parkingMaxstay}</span><span>${esc(maxstayText)}</span>` : ""}
          ${accessText   ? `<span style="color:#888">🔒</span><span style="color:#b45309">${accessText}</span>` : ""}
        </div>
        <span data-gmaps style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#2563eb;cursor:pointer;text-decoration:underline">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          ${t.results.googleMapsLink}
        </span>
        ${tier === "weak" ? `
        <span data-report style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#92400e;cursor:pointer;text-decoration:underline;margin-top:5px">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
          ${t.map.parkingReportButton}
        </span>` : ""}
      `
      // Use L.DomEvent.on (not addEventListener) — plain addEventListener and
      // inline onclick fail on mobile because Leaflet intercepts touchstart.
      const gmapsBtn = div.querySelector<HTMLElement>("[data-gmaps]")
      if (gmapsBtn) {
        L!.DomEvent.on(gmapsBtn, "click", (ev: Event) => {
          L!.DomEvent.stopPropagation(ev)
          void openExternalUrl(mapsUrl)
        })
      }

      const reportBtn = div.querySelector<HTMLElement>("[data-report]")
      if (reportBtn) {
        L!.DomEvent.on(reportBtn, "click", (ev: Event) => {
          L!.DomEvent.stopPropagation(ev)
          reportBtn.style.opacity = "0.5"
          reportBtn.style.pointerEvents = "none"
          fetch("/api/report-parking", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
              lat:              spot.lat,
              lon:              spot.lon,
              osmId:            spot.osmId,
              nearestPlaceName: nearest?.name,
            }),
          })
            .then((r) => {
              reportBtn.textContent = r.ok ? t.map.parkingReportDone : t.map.parkingReportError
              reportBtn.style.opacity = "1"
            })
            .catch(() => {
              reportBtn.textContent = t.map.parkingReportError
              reportBtn.style.opacity = "1"
            })
        })
      }

      const marker = L.marker([spot.lat, spot.lon], { icon, zIndexOffset: -200 })
        .bindPopup(div, { maxWidth: 240 })
        .addTo(mapInst.current)
      parkingMarkersRef.current.push(marker)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parkingSpots, mapReady, t])

  // Toilet (WC) spot markers — shown when toiletSpots is non-empty.
  useEffect(() => {
    if (!mapInst.current || !L) return
    for (const m of toiletMarkersRef.current) m.remove()
    toiletMarkersRef.current = []

    for (const spot of toiletSpots ?? []) {
      const tier: AmenityTier = spot.tier === "weak" ? "weak" : "strong"
      const host: ToiletHost  = spot.host?.kind === "venue" ? "venue" : "standalone"
      const accent = TOILET_HOST_STYLE[host].fill
      const icon = L.divIcon({
        html:        svgToiletMarker(host),
        className:   "",
        iconSize:    [24, 21],
        iconAnchor:  [12, 10],
        popupAnchor: [0, -11],
      })

      const yes      = t.a11y.yes
      const title    = tier === "strong" ? (t.map.toiletDesignated ?? "Rollstuhl-WC") : (t.map.toiletAccessible ?? "Barrierefreies WC")
      const isCustomers = spot.host?.access === "customers" || spot.access === "customers"
      const mapsUrl  = `https://www.google.com/maps?q=${spot.lat},${spot.lon}`

      // One property row: icon + muted label left, value right (optional accent colour).
      // Only called when we have a real value — no "k. A." rows are shown.
      const row = (icon: string, label: string, value: string, color?: string) =>
        `<div style="display:flex;justify-content:space-between;gap:14px;padding:3px 0">
          <span style="color:#6b7280">${icon}&thinsp;${label}</span>
          <span style="font-weight:500;text-align:right${color ? `;color:${color}` : ""}">${value}</span>
        </div>`

      const rows: string[] = []
      if (host === "venue") {
        const placeName = spot.host?.name ? esc(spot.host.name) : (t.map.toiletVenueGeneric ?? "Lokalität")
        rows.push(row("🏢", t.map.toiletAssociatedPlace ?? "Ort", placeName))
      }
      rows.push(row("♿", t.map.toiletWheelchairLabel ?? "Rollstuhlgerecht",
        tier === "strong" ? (t.map.toiletDesignatedValue ?? "Designiert") : yes))
      if (spot.euroKey)       rows.push(row("🔑", t.map.toiletEuroKey      ?? "Euroschlüssel", yes))
      if (spot.changingTable) rows.push(row("👶", t.map.toiletChangingTable ?? "Wickeltisch",   yes))
      if (isCustomers)        rows.push(row("🚪", t.map.toiletAccessLabel   ?? "Zugang",
        t.map.toiletCustomers ?? "Nur für Gäste", "#b45309"))

      const extLinkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`
      const linkStyle = `display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#2563eb;cursor:pointer;text-decoration:underline`

      // Wheelmap only indexes OSM nodes, not ways or relations
      const osmNodeId = spot.osmId?.startsWith("node/") ? spot.osmId.slice(5) : undefined
      const wheelmapUrl = osmNodeId ? `https://wheelmap.org/nodes/${osmNodeId}` : undefined

      const div = document.createElement("div")
      div.style.cssText = "font-family:sans-serif;font-size:12px;line-height:1.5;min-width:184px"
      div.innerHTML = `
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:7px">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:${accent};font-size:14px;flex-shrink:0">🚻</span>
          <span style="font-weight:600;font-size:13px">${title}</span>
        </div>
        <div style="font-size:11px;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;padding:2px 0;margin-bottom:7px">
          ${rows.join("")}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <span data-gmaps style="${linkStyle}">${extLinkSvg}${t.results.googleMapsLink}</span>
          ${wheelmapUrl ? `<span data-wheelmap style="${linkStyle}">${extLinkSvg}Wheelmap</span>` : ""}
        </div>
      `
      const gmapsBtn = div.querySelector<HTMLElement>("[data-gmaps]")
      if (gmapsBtn) {
        L.DomEvent.on(gmapsBtn, "click", () => void openExternalUrl(mapsUrl))
      }
      const wheelmapBtn = div.querySelector<HTMLElement>("[data-wheelmap]")
      if (wheelmapBtn && wheelmapUrl) {
        L.DomEvent.on(wheelmapBtn, "click", () => void openExternalUrl(wheelmapUrl))
      }

      const marker = L.marker([spot.lat, spot.lon], { icon })
        .bindPopup(div, { maxWidth: 220 })
        .addTo(mapInst.current)
      toiletMarkersRef.current.push(marker)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toiletSpots, mapReady, t])

  // Update markers when places change. In amenity focus mode the cluster is
  // cleared so only amenity spots and the user dot remain visible.
  useEffect(() => {
    if (!mapInst.current || !L || !placeClusterRef.current) return

    if (focusMode) {
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
      const emoji      = CATEGORY_ICONS[place.category] ?? "📍"
      const iconHtml   = svgMarker(color, isSelected, emoji)

      const pinW = isSelected ? 41 : 30
      const pinH = isSelected ? 54 : 39
      const icon = L!.divIcon({
        html:        iconHtml,
        className:   "",
        iconSize:    [pinW, pinH],
        iconAnchor:  [pinW / 2, pinH],
        popupAnchor: [0, -pinH],
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

        const categoryIcon  = CATEGORY_ICONS[place.category] ?? "📍"
        const categoryLabel = (t.categories as Record<string, string>)[place.category] ?? place.category

        div.innerHTML = `
          <strong style="display:block;margin-bottom:2px">${esc(place.name)} <span style="color:${markerColor(place.overallConfidence)};font-weight:normal">(${Math.round(place.overallConfidence * 100)}%)</span></strong>
          <div style="color:#666;font-size:11px;margin-bottom:4px">${categoryIcon} ${esc(categoryLabel)}</div>
          ${addr ? `<div style="color:#666;font-size:11px;margin-bottom:6px">${esc(addr)}</div>` : ""}
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
  }, [places, selectedId, mapReady, focusMode])

  // Fit bounds to show all results — runs only when places changes, not on marker click.
  // Separating this from the selectedId effect prevents fitBounds from firing when the
  // user clicks a marker (which changes selectedId but not places).
  // Skipped entirely when autoZoom is disabled.
  useEffect(() => {
    if (!mapInst.current || !L || places.length === 0 || !autoZoom) return
    if (focusMode) return  // focus-mode fit handled below
    const latlngs: [number, number][] = places.map((p) => [p.coordinates.lat, p.coordinates.lon])
    // Frame the SEARCH area, not the user's GPS dot. After "search here" in nearby
    // mode the search center diverges from the real user location; including the
    // (possibly far-away) dot would zoom out to span both. Fit to results + search
    // center so the searched area stays framed and the distant dot is left out.
    const sc = searchCenterRef.current
    if (sc) latlngs.push([sc.lat, sc.lon])
    lastProgrammaticMoveRef.current = Date.now()
    mapInst.current.fitBounds(L!.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 15 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, mapReady, autoZoom, focusMode])

  // Pan/zoom to selected — also re-fires when panTrigger increments so that
  // clicking the same result after manually panning the map still re-centers.
  // If the marker is currently inside a cluster, zoomToShowLayer animates the
  // map to a zoom level where the marker becomes individually visible, then
  // opens its popup. For uncluttered markers it pans without changing zoom.
  useEffect(() => {
    if (!mapInst.current || !selectedId) return
    const marker = markers.current.get(selectedId)
    if (!marker || !placeClusterRef.current) return
    lastProgrammaticMoveRef.current = Date.now()
    // Refresh the stamp in the callback too: opening the popup can autoPan the map,
    // firing a later moveend after the zoom animation already settled.
    placeClusterRef.current.zoomToShowLayer(marker, () => {
      lastProgrammaticMoveRef.current = Date.now()
      marker.openPopup()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, panTrigger, mapReady])

  // Pan to center — only when no results (e.g. failed search, initial state, or parking-only view)
  // When parking spots are visible without venue results, fit the view to all spots + GPS location.
  // In focus mode we always fit to spots regardless of how many places exist.
  // Suppressed while a search is in flight: resetting places/spots to [] while loading
  // triggers this effect with the stale center, causing a visible snap-back to the old
  // position before the new result arrives. Let the result's own fitBounds handle it.
  useEffect(() => {
    if (!mapInst.current || !L) return
    if (isLoading) return
    // Did the search center actually change since we last evaluated? Updated on
    // every (non-loading) run so a later mode switch — which keeps the old center
    // but clears places/spots — is correctly seen as "unchanged".
    const centerChanged = !prevCenterRef.current
      || center?.lat !== prevCenterRef.current.lat
      || center?.lon !== prevCenterRef.current.lon
    prevCenterRef.current = center ?? null
    if (!focusMode && places.length > 0) return
    const amenities = [...(parkingSpots ?? []), ...(toiletSpots ?? [])]
    if (amenities.length > 0) {
      const latlngs: [number, number][] = amenities.map((s) => [s.lat, s.lon])
      const ul = userLocationRef.current
      if (ul) latlngs.push([ul.lat, ul.lon])
      lastProgrammaticMoveRef.current = Date.now()
      mapInst.current.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 16 })
      return
    }
    if (!center) return
    // Option 1: only recenter on a genuine new search (center changed). A mode
    // switch (e.g. nearby → "search everywhere" with no location yet) clears
    // places/spots but keeps the old center — leave the user's view untouched.
    if (!centerChanged) return
    lastProgrammaticMoveRef.current = Date.now()
    mapInst.current.setView([center.lat, center.lon], 13)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, parkingSpots, toiletSpots, mapReady, focusMode, isLoading])

  // ESC exits fullscreen. Parkplatz-Modus has its own explicit toggle in the
  // ChatPanel, so no keyboard shortcut is needed for it.
  useEffect(() => {
    if (!isFullscreen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onToggleFullscreen()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isFullscreen, onToggleFullscreen])

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
      // Selection-driven reveal (e.g. "show on map" switched to this tab and set
      // selectedId in the same commit): don't fit to all results — that would
      // zoom back out and re-cluster the just-selected marker, closing its popup.
      // Show the selected marker instead. If it isn't built yet (fresh lazy mount,
      // markers not ready 50 ms in), the selection effect above re-fires on
      // mapReady and handles it — so we still skip the fit-to-all either way.
      if (selectedId) {
        const selMarker = placeClusterRef.current ? markers.current.get(selectedId) : undefined
        if (selMarker && placeClusterRef.current) {
          lastProgrammaticMoveRef.current = Date.now()
          placeClusterRef.current.zoomToShowLayer(selMarker, () => {
            lastProgrammaticMoveRef.current = Date.now()
            selMarker.openPopup()
          })
        }
        return
      }
      if (places.length > 0) {
        const latlngs: [number, number][] = places.map((p) => [p.coordinates.lat, p.coordinates.lon])
        // Frame the search area, not the user dot — see the results-fit effect above.
        const sc = searchCenterRef.current
        if (sc) latlngs.push([sc.lat, sc.lon])
        lastProgrammaticMoveRef.current = Date.now()
        mapInst.current?.fitBounds(L!.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 15 })
      } else {
        const spots = [...(parkingSpots ?? []), ...(toiletSpots ?? [])]
        if (spots.length > 0) {
          const latlngs: [number, number][] = spots.map((s) => [s.lat, s.lon])
          const ul = userLocationRef.current
          if (ul) latlngs.push([ul.lat, ul.lon])
          lastProgrammaticMoveRef.current = Date.now()
          mapInst.current?.fitBounds(L!.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 16 })
        } else if (center) {
          lastProgrammaticMoveRef.current = Date.now()
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

      {/* Locate button — pan to user's GPS position, then offer "search here".
          Sits left of the fullscreen toggle on desktop; on mobile (no toggle) it
          takes the top-right corner itself. */}
      {onLocate && !focusMode && (
        <div className={`absolute top-3 z-[1000] flex flex-col items-end gap-1 ${showFullscreenToggle ? "right-14" : "right-3"}`}>
          <Button
            variant="secondary"
            size="icon"
            onClick={async () => {
              setLocating(true)
              setLocateErrorVisible(false)
              try {
                await onLocate()
              } catch {
                setLocateErrorVisible(true)
                setTimeout(() => setLocateErrorVisible(false), 3000)
              } finally {
                setLocating(false)
              }
            }}
            disabled={locating}
            className="shadow-md"
            title={t.map.locate}
            aria-label={t.map.locate}
          >
            {locating
              ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              : <LocateFixed className="w-4 h-4" aria-hidden />
            }
          </Button>
          {locateErrorVisible && (
            <span className="rounded-md bg-background/95 backdrop-blur-sm border border-border px-2 py-1 text-xs shadow-md text-destructive whitespace-nowrap">
              {t.map.locateError}
            </span>
          )}
        </div>
      )}

      {/* Hidden in amenity focus mode: "search here" re-runs the venue search and
          resets the focus layers, which would silently exit the parking/WC view. */}
      {searchHereCenter && onSearchHere && !focusMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]">
          <button
            onClick={() => {
              onSearchHere(searchHereCenter)
              setSearchHereCenter(null)
            }}
            className="flex items-center gap-1.5 rounded-full border border-border bg-background/95 backdrop-blur-sm px-3 py-1.5 text-sm font-medium shadow-md hover:bg-muted transition-colors"
          >
            <Search className="w-3.5 h-3.5" aria-hidden />
            {t.map.searchHere}
          </button>
        </div>
      )}

      {/* ── Map-layer toggle pills (bottom-left) ── */}
      {/* Two independent toggles — parking and WC. Disabled in amenity focus mode. */}
      {onSetMapLayers && (
        <div
          aria-disabled={focusMode}
          className={`absolute bottom-3 left-3 z-[1000] flex items-center gap-1.5 ${focusMode ? "opacity-50 pointer-events-none" : ""}`}
        >
          <button
            onClick={() => onSetMapLayers(!(showParking ?? false), showToilets ?? false)}
            aria-pressed={showParking ?? false}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium shadow-md backdrop-blur-sm transition-colors
              ${showParking ? "bg-blue-600 text-white border-blue-600" : "bg-background/95 border-border text-muted-foreground hover:text-foreground hover:bg-muted"}`}
          >
            <span aria-hidden>🅿</span>
            <span>Parkplätze</span>
          </button>
          {hasToiletData && (
            <button
              onClick={() => onSetMapLayers(showParking ?? false, !(showToilets ?? false))}
              aria-pressed={showToilets ?? false}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium shadow-md backdrop-blur-sm transition-colors
                ${showToilets ? "bg-green-700 text-white border-green-700" : "bg-background/95 border-border text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            >
              <span aria-hidden>🚻</span>
              <span>WCs</span>
            </button>
          )}
        </div>
      )}

      {/* ── Marker legend (collapsible) — shown when parking or WC markers are present ── */}
      {((parkingSpots?.length ?? 0) > 0 || (toiletSpots?.length ?? 0) > 0) && (
        <div className="absolute bottom-3 right-3 z-[1000]">
          {legendOpen ? (
            <div className="rounded-lg bg-background/95 backdrop-blur-sm shadow-md border border-border p-2.5 text-xs">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <span className="font-semibold">{t.map.legend}</span>
                <button
                  onClick={() => setLegendOpen(false)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={t.common.close}
                >✕</button>
              </div>
              {(parkingSpots?.length ?? 0) > 0 && (<>
                <div className="flex items-center gap-2 py-0.5">
                  <span dangerouslySetInnerHTML={{ __html: svgParkingMarker("strong") }} />
                  <span>{t.map.legendDisabled}</span>
                </div>
                {showWeakParking && (
                  <div className="flex items-center gap-2 py-0.5">
                    <span dangerouslySetInnerHTML={{ __html: svgParkingMarker("weak") }} />
                    <span>{t.map.legendAccessible}</span>
                  </div>
                )}
              </>)}
              {(toiletSpots ?? []).some((s) => s.host?.kind !== "venue") && (
                <div className="flex items-center gap-2 py-0.5">
                  <span dangerouslySetInnerHTML={{ __html: svgToiletMarker("standalone") }} />
                  <span>{t.map.legendToiletStandalone ?? "Eigenständiges WC"}</span>
                </div>
              )}
              {(toiletSpots ?? []).some((s) => s.host?.kind === "venue") && (
                <div className="flex items-center gap-2 py-0.5">
                  <span dangerouslySetInnerHTML={{ __html: svgToiletMarker("venue") }} />
                  <span>{t.map.legendToiletVenue ?? "WC in Lokalität"}</span>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setLegendOpen(true)}
              title={t.map.legend}
              aria-label={t.map.legend}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium shadow-md border border-border bg-background/95 backdrop-blur-sm hover:bg-muted transition-colors"
            >
              <span dangerouslySetInnerHTML={{ __html: (parkingSpots?.length ?? 0) > 0 ? svgParkingMarker("strong") : svgToiletMarker("standalone") }} />
              <span>{t.map.legend}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
