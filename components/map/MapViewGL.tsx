"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import * as maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { Maximize2, Minimize2, Search, LocateFixed, Loader2, Layers, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import PlaceDebugSheet from "@/components/results/PlaceDebugSheet"
import { useTranslations } from "@/lib/i18n"
import { CATEGORY_ICONS } from "@/lib/category-icons"
import { openExternalUrl } from "@/lib/native/browser"
import { startDefaultNavigation } from "@/lib/native/navigation"
import { hapticLight } from "@/lib/native/haptics"
import { confidenceLabel } from "@/lib/matching/merge"
import { haversineMetres } from "@/lib/matching/match"
import { popupMaxHeight, isWithinProgrammaticMoveWindow, viewportRadiusKm } from "@/lib/map/geometry"
import { ensureMaplibreWorkerConfigured } from "@/lib/map/maplibre-worker"
import { drawPlacePin, drawParkingBadge, drawToiletBadge, drawGpsDot, MARKER_PIXEL_RATIO } from "@/lib/map/marker-images"
import { buildVenuePopupHtml, buildParkingPopupHtml, buildToiletPopupHtml } from "@/lib/map/popup-content"
import type { MapViewProps } from "@/lib/map/types"
import type { Place, AmenityFeature, AmenityTier } from "@/lib/types"

// MapLibre + OpenFreeMap implementation (issue #48 migration). Kept alongside
// MapViewLeaflet.tsx behind the internal engine flag in MapView.tsx until
// Phase 4 verification is complete — see that file's header comment.
//
// Architecture vs. the Leaflet version, per the R1 decision (native symbol
// layers, chosen 2026-07-31): individual markers are NOT DOM elements. Every
// unique (category, confidence, selected) combination is rasterised once to a
// canvas image (lib/map/marker-images.ts) and registered via map.addImage();
// places live in one GeoJSON source with native `cluster: true` clustering
// (GPU-side, not leaflet.markercluster's DOM-tree clustering). Popups are
// still plain HTML strings bound via maplibregl.Popup — MapLibre popups are
// ordinary DOM outside the WebGL canvas, so plain addEventListener works
// (unlike Leaflet, which needed L.DomEvent.on to survive its own touch
// interception — R11, to be verified on real touch devices).

const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty"
// OpenFreeMap's own style already carries the OSM/OpenMapTiles attribution
// entries; this is the extra credit their usage terms ask hosts to add
// (openfreemap.org/quick_start#attribution).
const OPENFREEMAP_EXTRA_ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>'

const PLACE_SOURCE_ID    = "ap-places"
const PARKING_SOURCE_ID  = "ap-parking"
const TOILET_SOURCE_ID   = "ap-toilets"
const GPS_SOURCE_ID      = "ap-gps"
const PLACE_CLUSTER_MAX_RADIUS = 50            // px — grouping radius at low zoom (matches Leaflet)
const PLACE_CLUSTER_DISABLE_AT_ZOOM = 17       // street-level: always show every pin (matches Leaflet)
const LAYERS_COLLAPSED_KEY = "ap_layers_collapsed"

const CONF_RANK: Record<"high" | "medium" | "low", number> = { low: 0, medium: 1, high: 2 }
const CONF_COLOR: Record<"high" | "medium" | "low", string> = { high: "#00c853", medium: "#ffd600", low: "#ff1744" }
const RANK_TO_COLOR = ["#ff1744", "#ffd600", "#00c853"] // index by CONF_RANK

function markerColor(confidence: number): string {
  return CONF_COLOR[confidenceLabel(confidence)]
}

function placeIconKey(place: Place, selected: boolean): string {
  return `place__${place.category}__${confidenceLabel(place.overallConfidence)}__${selected ? "sel" : "base"}`
}

// Conditional popup positioning (issue #48 follow-up): the popup's own anchor
// is fixed to "bottom" (always above the point, horizontally centred — never
// MapLibre's default per-side "auto" placement, which is what made popups
// feel like they appeared "somewhere"). The map only recentres first when the
// marker is close enough to an edge that the popup would otherwise be
// clipped — not on every open, which would add an unwanted pan/zoom
// animation to markers already comfortably in view.
//
// When a recentre IS needed, the target is pushed as close to the BOTTOM of
// the container as the margin allows — not just "the dead centre" (only half
// the container height above it, provably not enough — the original bug)
// and not a fixed fraction either (also provably not enough: a fixed 72%
// bias still came up short in the Quickstart mini-map, ~265px tall, because
// it didn't account for the popup constructor's own `offset` — the gap
// between the marker and the popup's tip — on top of the popup's height).
// Maximising headroom is the only version of this that's robust across wildly
// different container sizes (desktop map vs. a ~265px, or even the
// documented SPLIT_PANE_MIN_PX=90px, mini-map); the CSS maxHeight cap
// (popupMaxHeight) is still the real safety net for the case where the
// popup genuinely cannot fit even with maximum headroom.

function openSmartPopup(
  map: maplibregl.Map,
  lngLat: [number, number],
  html: string,
  opts: { maxWidthPx: number; estimatedHeightPx: number; offsetPx: number; lastProgrammaticMoveRef: { current: number }; onReady: (el: HTMLElement) => void },
): maplibregl.Popup {
  const popup = new maplibregl.Popup({ anchor: "bottom", offset: opts.offsetPx, maxWidth: `${opts.maxWidthPx}px`, className: "ap-popup-gl", closeButton: true })
    .setLngLat(lngLat)
    .setHTML(html)

  // Fires exactly once the popup's DOM exists and is attached, regardless of
  // whether addTo() below runs synchronously or after a recentre animation —
  // querying popup.getElement() right after this function returns raced that
  // timing and silently found nothing (no maxHeight cap applied, no button
  // click handlers wired) whenever a recentre was needed.
  //
  // maxHeight is applied HERE, not by a second .once("open", ...) at the call
  // site (trackPopup) — Popup#addTo() fires "open" SYNCHRONOUSLY for the
  // non-recentre path, so a listener registered after openSmartPopup()
  // already returned (i.e. after addTo() already ran) would silently never
  // fire. This was a real bug: the maxHeight cap was only ever applied on
  // the recentre path, never on the (far more common) direct-open path.
  popup.once("open", () => {
    const el = popup.getElement()
    if (!el) return
    applyPopupMaxHeight(popup, map.getContainer().clientHeight)
    opts.onReady(el)
  })

  const point = map.project(lngLat)
  const container = map.getContainer()
  const margin = 16
  const overflowsLeft = point.x - opts.maxWidthPx / 2 - margin < 0
  const overflowsRight = point.x + opts.maxWidthPx / 2 + margin > container.clientWidth
  const needsRecenter =
    point.y - opts.estimatedHeightPx - margin < 0 || overflowsLeft || overflowsRight

  if (needsRecenter) {
    opts.lastProgrammaticMoveRef.current = Date.now()
    // Deliberately NOT `easeTo({ center: lngLat, offset: [...] })` — verified
    // live that this is a no-op whenever the map's current center already
    // equals lngLat (e.g. right after a cluster-expansion zoom that already
    // centred on this exact point): MapLibre doesn't recompute the transform
    // from `offset` alone when `center` itself doesn't change, so the target
    // stayed exactly where it was despite a non-zero offset being passed.
    // Instead compute the destination geographic centre directly via
    // project()/unproject() pixel math, which has no such dependency on
    // whether `center` happens to differ from the current one.
    //
    // X is shifted independently of Y (only when actually needed) — an
    // earlier version of this function only ever adjusted Y, so a marker
    // near the left/right edge (common once international mode adds
    // non-DACH cities the initial viewport isn't centred on) had its
    // overflow correctly DETECTED by needsRecenter above but never
    // corrected: the popup still poked off the side of the map. Found live
    // in Paris (internationalMode) — confirmed via getBoundingClientRect
    // that the popup's right edge sat 76px past the map container's edge.
    const desiredY = container.clientHeight - margin
    const currentCenterPoint = map.project(map.getCenter())
    let newX = currentCenterPoint.x
    if (overflowsLeft) {
      const desiredX = opts.maxWidthPx / 2 + margin
      newX = currentCenterPoint.x + (point.x - desiredX)
    } else if (overflowsRight) {
      const desiredX = container.clientWidth - opts.maxWidthPx / 2 - margin
      newX = currentCenterPoint.x + (point.x - desiredX)
    }
    const newCenterPoint = new maplibregl.Point(newX, currentCenterPoint.y + (point.y - desiredY))
    const newCenter = map.unproject(newCenterPoint)
    map.easeTo({ center: newCenter, duration: 300 })
    map.once("moveend", () => {
      opts.lastProgrammaticMoveRef.current = Date.now()
      popup.addTo(map)
    })
  } else {
    popup.addTo(map)
  }
  return popup
}

function applyPopupMaxHeight(popup: maplibregl.Popup | null, mapHeightPx: number): void {
  if (!popup) return
  const el = popup.getElement()?.querySelector<HTMLElement>(".maplibregl-popup-content")
  if (!el) return
  const max = popupMaxHeight(mapHeightPx)
  el.style.maxHeight = `${max}px`
  el.style.overflowY = "auto"
}

export default function MapViewGL({
  places,
  parkingSpots,
  toiletSpots,
  center,
  userLocation,
  selectedId,
  panTrigger,
  onSelect,
  onShowInResults,
  onOpenDetails,
  isFullscreen,
  onToggleFullscreen,
  showFullscreenToggle = true,
  visible,
  showParking,
  showToilets,
  onSetMapLayers,
  hasToiletData = false,
  isLoading = false,
  focusMode = false,
  focusSearchCenter = null,
  onFocusSearchHere,
  showWeakParking = false,
  onSearchHere,
  hideSearchHereButton = false,
  onPanned,
  onViewportChange,
  onLocate,
  locatePanTrigger,
  searchRadiusKm,
  amenityPanTarget = null,
  amenityPanTrigger,
  onAmenityMarkerClick,
  onShowAmenityInResults,
  amenityType = null,
  onPopupOpenChange,
}: MapViewProps) {
  const t = useTranslations()
  const mapRef  = useRef<HTMLDivElement>(null)
  const mapInst = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const registeredImages = useRef<Set<string>>(new Set())
  const currentPopupRef  = useRef<maplibregl.Popup | null>(null)
  // Set right before a direct marker click opens its own popup (with smart
  // positioning), so the separate selectedId-driven "pan to selected" effect
  // below — which ALSO fires for this same click, since onSelect(place)
  // changes the selectedId prop this component receives — can tell it was
  // already fully handled and skip its own competing pan + popup-reopen.
  // Without this, a direct click raced two independent easeTo calls against
  // each other (mine with careful margin-aware positioning, the effect's own
  // dumb dead-centre pan), and the LATER one silently won, discarding the
  // smart positioning — a real bug, found by comparing exact map.project()
  // coordinates before/after, not by eye.
  const directClickPlaceIdRef = useRef<string | null>(null)

  const [layersCollapsed, setLayersCollapsed] = useState(() => {
    if (typeof window === "undefined") return true
    return window.localStorage.getItem(LAYERS_COLLAPSED_KEY) !== "0"
  })
  function toggleLayersCollapsed() {
    setLayersCollapsed((prev) => {
      const next = !prev
      try { window.localStorage.setItem(LAYERS_COLLAPSED_KEY, next ? "1" : "0") } catch {
        // localStorage unavailable — collapse state just won't persist.
      }
      return next
    })
  }

  const [detailPlace, setDetailPlace] = useState<Place | null>(null)
  function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  }

  const onShowInResultsRef  = useRef(onShowInResults)
  const onOpenDetailsRef    = useRef(onOpenDetails)
  const onShowAmenityInResultsRef = useRef(onShowAmenityInResults)
  // Popup HTML is built inside functions (openPlacePopup et al.) that are
  // called from "click" listeners registered once in the map-init effect
  // ([] deps) — those listeners permanently close over whichever render's
  // scope existed at mount, so reading `t` directly would freeze every
  // popup's language at mount time. A locale switch updates `t` via a
  // normal (always re-run) effect below; reading it through this ref
  // instead keeps popups built after a language switch correct without
  // needing MapView itself to remount.
  const tRef = useRef(t)
  const placesRef        = useRef(places)
  const parkingSpotsRef  = useRef(parkingSpots)
  const toiletSpotsRef   = useRef(toiletSpots)
  const userLocationRef  = useRef(userLocation)
  const searchCenterRef  = useRef(center)
  const onSearchHereRef  = useRef(onSearchHere)
  const onFocusSearchHereRef = useRef(onFocusSearchHere)
  const onPannedRef      = useRef(onPanned)
  const onViewportChangeRef = useRef(onViewportChange)
  const focusModeRef     = useRef(focusMode)
  const amenityTypeRef   = useRef(amenityType)
  useEffect(() => { onPannedRef.current = onPanned }, [onPanned])
  useEffect(() => { onViewportChangeRef.current = onViewportChange }, [onViewportChange])
  useEffect(() => { onShowInResultsRef.current = onShowInResults }, [onShowInResults])
  useEffect(() => { onOpenDetailsRef.current = onOpenDetails }, [onOpenDetails])
  useEffect(() => { onShowAmenityInResultsRef.current = onShowAmenityInResults }, [onShowAmenityInResults])
  useEffect(() => { tRef.current = t }, [t])
  useEffect(() => { placesRef.current = places }, [places])
  useEffect(() => { parkingSpotsRef.current = parkingSpots }, [parkingSpots])
  useEffect(() => { toiletSpotsRef.current = toiletSpots }, [toiletSpots])
  useEffect(() => { userLocationRef.current = userLocation }, [userLocation])
  useEffect(() => { searchCenterRef.current = center }, [center])
  useEffect(() => { onSearchHereRef.current = onSearchHere }, [onSearchHere])
  useEffect(() => { onFocusSearchHereRef.current = onFocusSearchHere }, [onFocusSearchHere])
  useEffect(() => { focusModeRef.current = focusMode }, [focusMode])
  useEffect(() => { amenityTypeRef.current = amenityType }, [amenityType])

  const [searchHereCenter, setSearchHereCenter] = useState<{ lat: number; lon: number } | null>(null)
  const searchHereOriginRef = useRef<"drag" | "locate">("drag")

  useEffect(() => {
    const notify = onPannedRef.current
    const report = onViewportChangeRef.current

    if (focusMode) {
      if (onFocusSearchHereRef.current) {
        notify?.(() => {
          const map = mapInst.current
          if (!map) return
          const c = map.getCenter()
          const ne = map.getBounds().getNorthEast()
          const radiusKm = viewportRadiusKm({ lat: c.lat, lon: c.lng }, { lat: ne.lat, lon: ne.lng })
          onFocusSearchHereRef.current?.({ lat: c.lat, lon: c.lng }, radiusKm)
        })
      } else {
        notify?.(null)
      }
      report?.(null)
      return
    }

    const panPending = !!(searchHereCenter && onSearchHereRef.current)
    if (panPending && searchHereCenter) {
      const map = mapInst.current
      const radiusKm = map
        ? viewportRadiusKm({ lat: map.getCenter().lat, lon: map.getCenter().lng }, { lat: map.getBounds().getNorthEast().lat, lon: map.getBounds().getNorthEast().lng })
        : 5
      const panned = searchHereCenter
      const panOrigin = searchHereOriginRef.current
      notify?.(() => {
        onSearchHereRef.current?.(panned, radiusKm, panOrigin)
        setSearchHereCenter(null)
      })
      report?.({ center: panned, radiusKm })
    } else {
      notify?.(null)
      report?.(null)
    }
  }, [searchHereCenter, focusMode])

  const [locating, setLocating] = useState(false)
  const [locateErrorVisible, setLocateErrorVisible] = useState(false)
  const [popupOpen, setPopupOpen] = useState(false)
  const lastProgrammaticMoveRef = useRef(Date.now())
  const userPannedRef = useRef(false)
  const prevCenterRef = useRef<{ lat: number; lon: number } | null>(null)

  useEffect(() => { setSearchHereCenter(null) }, [center])
  useEffect(() => { if (visible === false) setSearchHereCenter(null) }, [visible])

  // ── Locate button: pan to userLocation, zoomed to fit searchRadiusKm ──────
  useEffect(() => {
    if (locatePanTrigger === undefined || !mapInst.current) return
    const ul = userLocation
    if (!ul) return
    const map = mapInst.current
    lastProgrammaticMoveRef.current = Date.now()
    const km = searchRadiusKm && searchRadiusKm > 0 ? searchRadiusKm : 5
    const half = km / Math.SQRT2
    const latDelta = half / 111.32
    const lonDelta = half / (111.32 * Math.cos((ul.lat * Math.PI) / 180))
    const bounds = new maplibregl.LngLatBounds(
      [ul.lon - lonDelta, ul.lat - latDelta],
      [ul.lon + lonDelta, ul.lat + latDelta],
    )
    const fit = map.cameraForBounds(bounds, { padding: 0 })
    const zoom = fit?.zoom !== undefined ? Math.max(3, Math.min(fit.zoom, 18)) : 14
    map.jumpTo({ center: [ul.lon, ul.lat], zoom })
    if (onSearchHereRef.current && !focusModeRef.current) {
      searchHereOriginRef.current = "locate"
      setSearchHereCenter({ lat: ul.lat, lon: ul.lon })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locatePanTrigger, mapReady])

  // ── Init map once ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInst.current) return
    ensureMaplibreWorkerConfigured()

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: OPENFREEMAP_STYLE,
      center: [10.451526, 51.165691],
      zoom: 6,
      attributionControl: { compact: true, customAttribution: OPENFREEMAP_EXTRA_ATTRIBUTION },
      // R7: rotation/pitch disabled — getBounds()/project() assume a
      // north-up, unpitched map everywhere else in this file (viewport
      // radius math, the smart-popup edge check).
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    })
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left")

    mapInst.current = map
    lastProgrammaticMoveRef.current = Date.now()

    // `compact: true` above still starts EXPANDED — MapLibre's own
    // AttributionControl opens the <details> and adds
    // "maplibregl-compact-show" synchronously in its onAdd() (verified in
    // maplibre-gl-dev.mjs: _updateCompact() sets both `open` and
    // "maplibregl-compact-show" on first run), only collapsing to the bare
    // i-icon after the user drags the map (_updateCompactMinimize, bound to
    // the "drag" event). Force it collapsed from the start instead — later
    // internal re-runs of _updateCompact() (on resize / style load) only
    // re-expand it when the "maplibregl-compact" class is ABSENT, which it
    // never is here, so this stays collapsed until the user clicks the icon.
    const attribEl = map.getContainer().querySelector<HTMLElement>(".maplibregl-ctrl-attrib")
    attribEl?.classList.remove("maplibregl-compact-show")
    attribEl?.removeAttribute("open")

    // MapLibre's default behaviour for an unhandled "error" event is to log
    // it to the console itself — which Next.js's dev overlay then surfaces
    // as a big red "Console Error" for what is usually just a single failed
    // tile fetch against OpenFreeMap's public (no-SLA) mirror (R9). A tile
    // source retries/recovers on its own; this only needs a soft warning,
    // not an uncaught-looking error.
    map.on("error", (e: maplibregl.ErrorEvent) => {
      console.warn("[MapViewGL] map error (likely a transient tile-fetch failure):", e.error?.message ?? e.error)
    })

    map.on("dragstart", () => { userPannedRef.current = true })
    map.on("moveend", () => {
      const wasUserPan = userPannedRef.current
      userPannedRef.current = false
      if (focusModeRef.current) return
      if (!wasUserPan) return
      if (isWithinProgrammaticMoveWindow(lastProgrammaticMoveRef.current, Date.now())) return
      if (!onSearchHereRef.current || !searchCenterRef.current) return
      const newCenter = map.getCenter()
      const bounds = map.getBounds()
      const minSpan = Math.min(
        bounds.getNorth() - bounds.getSouth(),
        bounds.getEast() - bounds.getWest(),
      )
      const threshold = 0.25 * minSpan
      const sc = searchCenterRef.current
      if (Math.abs(newCenter.lat - sc.lat) > threshold || Math.abs(newCenter.lng - sc.lon) > threshold) {
        searchHereOriginRef.current = "drag"
        setSearchHereCenter({ lat: newCenter.lat, lon: newCenter.lng })
      }
    })

    map.on("load", () => {
      // Base images that don't depend on search results.
      const gps = drawGpsDot()
      map.addImage("gps-dot", { width: gps.width, height: gps.height, data: gps.data }, { pixelRatio: MARKER_PIXEL_RATIO })

      map.addSource(PLACE_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: PLACE_CLUSTER_DISABLE_AT_ZOOM - 1,
        clusterRadius: PLACE_CLUSTER_MAX_RADIUS,
        clusterProperties: { maxConf: ["max", ["get", "confRank"]] },
      })
      map.addLayer({
        id: "clusters", type: "circle", source: PLACE_SOURCE_ID, filter: ["has", "point_count"],
        paint: {
          "circle-radius": ["step", ["get", "point_count"], 17, 10, 21],
          "circle-color": "#ffffff",
          "circle-stroke-width": 3,
          "circle-stroke-color": ["match", ["get", "maxConf"], 2, RANK_TO_COLOR[2], 1, RANK_TO_COLOR[1], RANK_TO_COLOR[0]],
        },
      })
      map.addLayer({
        id: "cluster-count", type: "symbol", source: PLACE_SOURCE_ID, filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 13, "text-font": ["Noto Sans Bold"], "text-allow-overlap": true },
        paint: { "text-color": "#3a332c" },
      })
      map.addLayer({
        id: "unclustered-point", type: "symbol", source: PLACE_SOURCE_ID, filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": ["get", "iconKey"],
          "icon-size": 1,
          "icon-anchor": "bottom",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      })

      map.addSource(PARKING_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } })
      map.addLayer({
        id: "parking-points", type: "symbol", source: PARKING_SOURCE_ID,
        layout: { "icon-image": ["get", "iconKey"], "icon-size": 1, "icon-anchor": "center", "icon-allow-overlap": true, "icon-ignore-placement": true },
      })

      map.addSource(TOILET_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } })
      map.addLayer({
        id: "toilet-points", type: "symbol", source: TOILET_SOURCE_ID,
        layout: { "icon-image": ["get", "iconKey"], "icon-size": 1, "icon-anchor": "center", "icon-allow-overlap": true, "icon-ignore-placement": true },
      })

      map.addSource(GPS_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } })
      map.addLayer({
        id: "gps-dot", type: "symbol", source: GPS_SOURCE_ID,
        layout: { "icon-image": "gps-dot", "icon-size": 1, "icon-anchor": "center", "icon-allow-overlap": true },
      })

      map.on("click", "clusters", (e: maplibregl.MapLayerMouseEvent) => {
        const feats = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })
        const clusterId = feats[0]?.properties?.cluster_id
        const src = map.getSource(PLACE_SOURCE_ID) as maplibregl.GeoJSONSource
        if (clusterId === undefined) return
        currentPopupRef.current?.remove()
        src.getClusterExpansionZoom(clusterId).then((zoom: number) => {
          const coords = (feats[0].geometry as GeoJSON.Point).coordinates as [number, number]
          lastProgrammaticMoveRef.current = Date.now()
          map.easeTo({ center: coords, zoom })
        }).catch(() => {})
      })

      map.on("click", "unclustered-point", (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0]
        const placeId = f?.properties?.id as string | undefined
        if (!placeId) return
        const place = placesRef.current.find((p) => p.id === placeId)
        if (!place) return
        directClickPlaceIdRef.current = placeId
        onSelect(place)
        openPlacePopup(place)
      })

      map.on("click", "parking-points", (e: maplibregl.MapLayerMouseEvent) => {
        const idx = e.features?.[0]?.properties?.idx as number | undefined
        if (idx === undefined) return
        const spot = parkingSpotsRef.current?.[idx]
        if (!spot) return
        onAmenityMarkerClick?.({ osmId: spot.osmId, lat: spot.lat, lon: spot.lon })
        openParkingPopup(spot, idx)
      })
      map.on("click", "toilet-points", (e: maplibregl.MapLayerMouseEvent) => {
        const idx = e.features?.[0]?.properties?.idx as number | undefined
        if (idx === undefined) return
        const spot = toiletSpotsRef.current?.[idx]
        if (!spot) return
        onAmenityMarkerClick?.({ osmId: spot.osmId, lat: spot.lat, lon: spot.lon })
        openToiletPopup(spot, idx)
      })

      for (const layer of ["clusters", "unclustered-point", "parking-points", "toilet-points"]) {
        map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer" })
        map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = "" })
      }

      setMapReady(true)
    })

    return () => {
      map.remove()
      mapInst.current = null
      registeredImages.current.clear()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function ensureImage(key: string, factory: () => { data: Uint8ClampedArray; width: number; height: number }): void {
    const map = mapInst.current
    if (!map || registeredImages.current.has(key)) return
    const img = factory()
    if (!map.hasImage(key)) map.addImage(key, { width: img.width, height: img.height, data: img.data }, { pixelRatio: MARKER_PIXEL_RATIO })
    registeredImages.current.add(key)
  }

  function trackPopup(popup: maplibregl.Popup): void {
    // MapLibre popups don't auto-close each other the way Leaflet's did
    // (Leaflet's Map tracks a single "open popup" and closes it before
    // opening the next) — without this, clicking a second marker while a
    // popup is already open left both stacked on screen.
    if (currentPopupRef.current && currentPopupRef.current !== popup) {
      currentPopupRef.current.remove()
    }
    currentPopupRef.current = popup
    setPopupOpen(true)
    onPopupOpenChange?.(true)
    popup.on("close", () => {
      if (currentPopupRef.current === popup) currentPopupRef.current = null
      setPopupOpen(false)
      onPopupOpenChange?.(false)
    })
  }

  function wireVenuePopupButtons(el: HTMLElement, place: Place): void {
    el.querySelector<HTMLElement>("[data-show-details]")?.addEventListener("click", (ev: Event) => {
      ev.stopPropagation()
      const p = placesRef.current.find((pl) => pl.id === place.id)
      if (!p) return
      if (onOpenDetailsRef.current) onOpenDetailsRef.current(p)
      else setDetailPlace(p)
    })
    el.querySelector<HTMLElement>("[data-navigate]")?.addEventListener("click", (ev: Event) => {
      ev.stopPropagation()
      startDefaultNavigation({ lat: place.coordinates.lat, lon: place.coordinates.lon })
    })
    el.querySelector<HTMLElement>("[data-show-id]")?.addEventListener("click", (ev: Event) => {
      ev.stopPropagation()
      const p = placesRef.current.find((pl) => pl.id === place.id)
      if (p) onShowInResultsRef.current?.(p)
    })
  }

  function openPlacePopup(place: Place): void {
    const map = mapInst.current
    if (!map) return
    const html = buildVenuePopupHtml(place, tRef.current, { showResults: !!onShowInResults })
    const popup = openSmartPopup(map, [place.coordinates.lon, place.coordinates.lat], html, {
      maxWidthPx: 296, estimatedHeightPx: 230, offsetPx: 44, lastProgrammaticMoveRef,
      onReady: (el) => wireVenuePopupButtons(el, place),
    })
    trackPopup(popup)
  }

  function openParkingPopup(spot: NonNullable<typeof parkingSpots>[number], idx: number): void {
    const map = mapInst.current
    if (!map) return
    const nearest = placesRef.current.reduce<{ name: string; dist: number } | null>((best, p) => {
      const d = haversineMetres(spot, p.coordinates)
      return best === null || d < best.dist ? { name: p.name, dist: d } : best
    }, null)
    const showResults = !!onShowAmenityInResultsRef.current && amenityTypeRef.current === "parking"
    const html = buildParkingPopupHtml(spot, tRef.current, { nearestName: nearest?.name, nearestDistM: nearest?.dist, showResults })
    const popup = openSmartPopup(map, [spot.lon, spot.lat], html, {
      maxWidthPx: 260, estimatedHeightPx: 180, offsetPx: 22, lastProgrammaticMoveRef,
      onReady: (el) => {
        el.querySelector<HTMLElement>("[data-navigate]")?.addEventListener("click", (ev: Event) => { ev.stopPropagation(); startDefaultNavigation({ lat: spot.lat, lon: spot.lon }) })
        el.querySelector<HTMLElement>("[data-show-results]")?.addEventListener("click", (ev: Event) => {
          ev.stopPropagation()
          onShowAmenityInResultsRef.current?.({ osmId: spot.osmId, lat: spot.lat, lon: spot.lon })
        })
        el.querySelector<HTMLElement>("[data-report]")?.addEventListener("click", (ev: Event) => {
          ev.stopPropagation()
          const btn = ev.currentTarget as HTMLElement
          btn.style.opacity = "0.5"
          btn.style.pointerEvents = "none"
          fetch("/api/report-parking", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: spot.lat, lon: spot.lon, osmId: spot.osmId, nearestPlaceName: nearest?.name }),
          }).then((r) => {
            btn.textContent = r.ok ? t.map.parkingReportDone : t.map.parkingReportError
            btn.style.opacity = "1"
          }).catch(() => { btn.textContent = t.map.parkingReportError; btn.style.opacity = "1" })
        })
      },
    })
    trackPopup(popup)
    void idx
  }

  function openToiletPopup(spot: AmenityFeature, idx: number): void {
    const map = mapInst.current
    if (!map) return
    const showResults = !!onShowAmenityInResultsRef.current && amenityTypeRef.current === "toilet"
    const osmNodeId = spot.osmId?.startsWith("node/") ? spot.osmId.slice(5) : undefined
    const wheelmapUrl = osmNodeId ? `https://wheelmap.org/nodes/${osmNodeId}` : undefined
    const html = buildToiletPopupHtml(spot, tRef.current, { showResults, wheelmapUrl })
    const popup = openSmartPopup(map, [spot.lon, spot.lat], html, {
      maxWidthPx: 260, estimatedHeightPx: 180, offsetPx: 22, lastProgrammaticMoveRef,
      onReady: (el) => {
        el.querySelector<HTMLElement>("[data-navigate]")?.addEventListener("click", (ev: Event) => { ev.stopPropagation(); startDefaultNavigation({ lat: spot.lat, lon: spot.lon }) })
        el.querySelector<HTMLElement>("[data-wheelmap]")?.addEventListener("click", (ev: Event) => { ev.stopPropagation(); if (wheelmapUrl) void openExternalUrl(wheelmapUrl) })
        el.querySelector<HTMLElement>("[data-show-results]")?.addEventListener("click", (ev: Event) => {
          ev.stopPropagation()
          onShowAmenityInResultsRef.current?.({ osmId: spot.osmId, lat: spot.lat, lon: spot.lon })
        })
      },
    })
    trackPopup(popup)
    void idx
  }

  // ── GPS dot ────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady) return
    const src = map.getSource(GPS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (!src) return
    src.setData({
      type: "FeatureCollection",
      features: userLocation ? [{ type: "Feature", geometry: { type: "Point", coordinates: [userLocation.lon, userLocation.lat] }, properties: {} }] : [],
    })
  }, [userLocation, mapReady])

  // ── Parking markers ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady) return
    const src = map.getSource(PARKING_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (!src) return
    const spots = parkingSpots ?? []
    const features = spots.map((spot, idx) => {
      const tier: AmenityTier = spot.tier === "weak" ? "weak" : "strong"
      const key = `parking__${tier}`
      ensureImage(key, () => drawParkingBadge(tier))
      return { type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [spot.lon, spot.lat] }, properties: { idx, iconKey: key } }
    })
    src.setData({ type: "FeatureCollection", features })
  }, [parkingSpots, mapReady])

  // ── Toilet markers ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady) return
    const src = map.getSource(TOILET_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (!src) return
    const spots = toiletSpots ?? []
    const features = spots.map((spot, idx) => {
      const host = spot.host?.kind === "venue" ? "venue" : "standalone"
      const euroKey = spot.euroKey === true
      const key = `toilet__${host}__${euroKey ? "euro" : "plain"}`
      ensureImage(key, () => drawToiletBadge(host, euroKey))
      return { type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [spot.lon, spot.lat] }, properties: { idx, iconKey: key } }
    })
    src.setData({ type: "FeatureCollection", features })
  }, [toiletSpots, mapReady])

  // ── Close any open popup when the result set changes ───────────────────
  // A popup is a plain DOM element MapLibre knows nothing about once opened
  // — it has no link back to the GeoJSON source, so replacing the source
  // data (a new search, a category-chip change, switching amenity type...)
  // left a stale popup open showing a place/spot that may no longer even be
  // in the current results. Leaflet's version got this "for free" in the
  // common case: removing a marker whose popup is open auto-closes it there.
  // Skipped on the very first mount (mapReady flip) — nothing is open yet.
  const firstResultsRunRef = useRef(true)
  useEffect(() => {
    if (!mapReady) return
    if (firstResultsRunRef.current) { firstResultsRunRef.current = false; return }
    currentPopupRef.current?.remove()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, parkingSpots, toiletSpots, mapReady])

  // ── Close any open popup on a locale switch ─────────────────────────────
  // tRef above fixes the language of popups opened AFTER a switch; an
  // already-open popup is a static HTML blob MapLibre never revisits, so it
  // would otherwise keep showing the old language until the user happens to
  // close and reopen it. Skips the initial mount (nothing is open yet) via
  // the same guard style as the results-change effect above; unlike that
  // effect this one doesn't need `mapReady` gating since it can't fire
  // before first render anyway (t is always defined).
  const firstLocaleRunRef = useRef(true)
  useEffect(() => {
    if (firstLocaleRunRef.current) { firstLocaleRunRef.current = false; return }
    currentPopupRef.current?.remove()
  }, [t])

  // ── Place markers + clustering ────────────────────────────────────────
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady) return
    const src = map.getSource(PLACE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (!src) return

    if (focusMode) {
      src.setData({ type: "FeatureCollection", features: [] })
      return
    }

    const features = places.map((place) => {
      const selected = place.id === selectedId
      const key = placeIconKey(place, selected)
      const emoji = CATEGORY_ICONS[place.category] ?? "📍"
      ensureImage(key, () => drawPlacePin(markerColor(place.overallConfidence), emoji, selected))
      const level = confidenceLabel(place.overallConfidence)
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [place.coordinates.lon, place.coordinates.lat] },
        properties: { id: place.id, iconKey: key, confRank: CONF_RANK[level] },
      }
    })
    src.setData({ type: "FeatureCollection", features })
  }, [places, selectedId, mapReady, focusMode])

  // ── Fit bounds to all results ─────────────────────────────────────────
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady || places.length === 0 || focusMode) return
    const bounds = new maplibregl.LngLatBounds()
    for (const p of places) bounds.extend([p.coordinates.lon, p.coordinates.lat])
    const sc = searchCenterRef.current
    if (sc) bounds.extend([sc.lon, sc.lat])
    lastProgrammaticMoveRef.current = Date.now()
    map.fitBounds(bounds, { padding: 40, maxZoom: 15 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, mapReady, focusMode])

  // ── Pan/zoom to selected place ("show on map") ────────────────────────
  // MapLibre's native clustering has no zoomToShowLayer equivalent (R3): we
  // approximate its OUTCOME (the marker ends up individually visible, popup
  // open) with a synchronous heuristic instead of the async
  // getClusterLeaves()/getClusterExpansionZoom() dance — if the marker is
  // already rendered as an unclustered point at the current zoom, just
  // recentre; otherwise jump straight to the zoom level clustering is
  // disabled at, guaranteeing it un-clusters. This can over-zoom relative to
  // the true minimal expansion zoom in the "was clustered" branch — a known,
  // deliberate simplification, not parity — flagged for Phase 4 manual
  // verification rather than the higher-risk async implementation.
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady || !selectedId) return
    // Already fully handled by the direct marker-click handler above (which
    // opens its own smart-positioned popup) — running this effect's own pan
    // too would race it. Only skip THIS ONE firing, not future ones: an
    // external re-selection of the same id later (e.g. "Zur Karte") must
    // still go through the normal path below.
    if (directClickPlaceIdRef.current === selectedId) {
      directClickPlaceIdRef.current = null
      return
    }
    const place = placesRef.current.find((p) => p.id === selectedId)
    if (!place) return
    const coords: [number, number] = [place.coordinates.lon, place.coordinates.lat]
    const alreadyUnclustered = map.queryRenderedFeatures(undefined, { layers: ["unclustered-point"] })
      .some((f: maplibregl.MapGeoJSONFeature) => f.properties?.id === selectedId)
    lastProgrammaticMoveRef.current = Date.now()
    if (alreadyUnclustered) {
      map.easeTo({ center: coords })
    } else {
      map.easeTo({ center: coords, zoom: Math.max(map.getZoom(), PLACE_CLUSTER_DISABLE_AT_ZOOM) })
    }
    map.once("moveend", () => {
      lastProgrammaticMoveRef.current = Date.now()
      openPlacePopup(place)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, panTrigger, mapReady])

  // ── "Zur Karte" from an amenity result card ───────────────────────────
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady || !amenityPanTarget) return
    const EPS = 1e-6
    const pIdx = (parkingSpotsRef.current ?? []).findIndex((s) => Math.abs(s.lat - amenityPanTarget.lat) < EPS && Math.abs(s.lon - amenityPanTarget.lon) < EPS)
    const tIdx = (toiletSpotsRef.current ?? []).findIndex((s) => Math.abs(s.lat - amenityPanTarget.lat) < EPS && Math.abs(s.lon - amenityPanTarget.lon) < EPS)
    lastProgrammaticMoveRef.current = Date.now()
    map.easeTo({ center: [amenityPanTarget.lon, amenityPanTarget.lat], zoom: Math.max(map.getZoom(), 17) })
    map.once("moveend", () => {
      lastProgrammaticMoveRef.current = Date.now()
      if (pIdx >= 0) openParkingPopup(parkingSpotsRef.current![pIdx], pIdx)
      else if (tIdx >= 0) openToiletPopup(toiletSpotsRef.current![tIdx], tIdx)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amenityPanTrigger, mapReady])

  // ── Pan to center when there are no results ───────────────────────────
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady) return
    if (isLoading) return
    const centerChanged = !prevCenterRef.current || center?.lat !== prevCenterRef.current.lat || center?.lon !== prevCenterRef.current.lon
    prevCenterRef.current = center ?? null
    if (focusSearchCenter) return
    if (!focusMode && places.length > 0) return
    const amenities = [...(parkingSpots ?? []), ...(toiletSpots ?? [])]
    if (amenities.length > 0) {
      const bounds = new maplibregl.LngLatBounds()
      for (const s of amenities) bounds.extend([s.lon, s.lat])
      lastProgrammaticMoveRef.current = Date.now()
      map.fitBounds(bounds, { padding: 40, maxZoom: 16 })
      return
    }
    if (!center) return
    if (!centerChanged) return
    lastProgrammaticMoveRef.current = Date.now()
    map.jumpTo({ center: [center.lon, center.lat], zoom: 13 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, parkingSpots, toiletSpots, mapReady, focusMode, isLoading, focusSearchCenter])

  // ── ESC exits fullscreen ───────────────────────────────────────────────
  useEffect(() => {
    if (!isFullscreen) return
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onToggleFullscreen() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isFullscreen, onToggleFullscreen])

  // ── Re-measure on visibility/fullscreen change (first-mount resize invariant) ──
  useEffect(() => {
    const isVisible = visible !== false
    if (!isVisible || !mapInst.current) return
    const id = setTimeout(() => {
      const map = mapInst.current
      if (!map) return
      map.resize()
      if (currentPopupRef.current) applyPopupMaxHeight(currentPopupRef.current, map.getContainer().clientHeight)
      if (selectedId) return // selection effect above (re-fires on mapReady) handles this case
      if (places.length > 0) {
        const bounds = new maplibregl.LngLatBounds()
        for (const p of places) bounds.extend([p.coordinates.lon, p.coordinates.lat])
        const sc = searchCenterRef.current
        if (sc) bounds.extend([sc.lon, sc.lat])
        lastProgrammaticMoveRef.current = Date.now()
        map.fitBounds(bounds, { padding: 40, maxZoom: 15 })
      } else {
        const spots = [...(parkingSpots ?? []), ...(toiletSpots ?? [])]
        if (spots.length > 0) {
          const bounds = new maplibregl.LngLatBounds()
          for (const s of spots) bounds.extend([s.lon, s.lat])
          lastProgrammaticMoveRef.current = Date.now()
          map.fitBounds(bounds, { padding: 40, maxZoom: 16 })
        } else if (center) {
          lastProgrammaticMoveRef.current = Date.now()
          map.jumpTo({ center: [center.lon, center.lat], zoom: 13 })
        }
      }
    }, 50)
    return () => clearTimeout(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, isFullscreen, mapReady])

  // ── Continuous container-size sync (free-form resizable split panes) ──
  // Debounced (trailing), not just rAF-gated: a bare rAF gate still lets
  // resize() fire on every animation frame (~60/s) for the whole duration of
  // a pointer drag (Quickstart's map/list split handle) — each call forces
  // MapLibre to redo symbol placement/collision for the new viewport size,
  // which reads as constant marker/label flicker while dragging (reported
  // live on both mobile and desktop). Deferring resize() until motion pauses
  // eliminates the mid-drag redraws entirely; the map only visually snaps to
  // the exact new size once the pointer stops moving or is released, which
  // is well within the debounce window.
  useEffect(() => {
    if (!mapRef.current) return
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const RESIZE_DEBOUNCE_MS = 120
    const ro = new ResizeObserver(() => {
      if (timeoutId != null) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        timeoutId = null
        mapInst.current?.resize()
        if (currentPopupRef.current && mapInst.current) applyPopupMaxHeight(currentPopupRef.current, mapInst.current.getContainer().clientHeight)
      }, RESIZE_DEBOUNCE_MS)
    })
    ro.observe(mapRef.current)
    return () => { ro.disconnect(); if (timeoutId != null) clearTimeout(timeoutId) }
  }, [])

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} role="region" aria-label={t.map.regionLabel} className="w-full h-full" />

      {showFullscreenToggle && (
        <Button
          size="icon"
          variant="secondary"
          onClick={onToggleFullscreen}
          className={`absolute top-3 right-3 z-[1000] shadow-md transition-opacity ${popupOpen ? "opacity-0 pointer-events-none" : ""}`}
          title={isFullscreen ? t.map.exitFullscreen : t.map.fullscreen}
          aria-label={isFullscreen ? t.map.exitFullscreen : t.map.fullscreen}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </Button>
      )}

      {onLocate && (
        <div className={`absolute top-3 z-[1000] flex flex-col items-end gap-1 transition-opacity ${showFullscreenToggle ? "right-14" : "right-3"} ${popupOpen ? "opacity-0 pointer-events-none" : ""}`}>
          <Button
            variant="secondary"
            size="icon"
            onClick={async () => {
              hapticLight()
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
            className="w-11 h-11 rounded-full bg-background hover:bg-muted border border-border shadow-lg"
            title={t.map.locate}
            aria-label={t.map.locate}
          >
            {locating ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden /> : <LocateFixed className="w-5 h-5" aria-hidden />}
          </Button>
          {locateErrorVisible && (
            <span className="rounded-md bg-background/95 backdrop-blur-sm border border-border px-2 py-1 text-xs shadow-md text-destructive whitespace-nowrap">
              {t.map.locateError}
            </span>
          )}
        </div>
      )}

      {searchHereCenter && onSearchHere && !focusMode && !hideSearchHereButton && (
        <div className={`absolute top-3 left-1/2 -translate-x-1/2 z-[1000] transition-opacity ${popupOpen ? "opacity-0 pointer-events-none" : ""}`}>
          <button
            onClick={() => {
              hapticLight()
              const map = mapInst.current
              const radiusKm = map
                ? viewportRadiusKm({ lat: map.getCenter().lat, lon: map.getCenter().lng }, { lat: map.getBounds().getNorthEast().lat, lon: map.getBounds().getNorthEast().lng })
                : 5
              onSearchHere(searchHereCenter, radiusKm, searchHereOriginRef.current)
              setSearchHereCenter(null)
            }}
            className="flex items-center gap-1.5 rounded-full border border-border bg-background/95 backdrop-blur-sm px-3 py-1.5 text-sm font-medium shadow-md hover:bg-muted transition-colors"
          >
            <Search className="w-3.5 h-3.5" aria-hidden />
            {t.map.searchHere}
          </button>
        </div>
      )}

      {focusMode && onFocusSearchHere && !hideSearchHereButton && (
        <div className={`absolute top-3 left-1/2 -translate-x-1/2 z-[1000] transition-opacity ${popupOpen ? "opacity-0 pointer-events-none" : ""}`}>
          <button
            onClick={() => {
              const map = mapInst.current
              if (!map) return
              const c = map.getCenter()
              const radiusKm = viewportRadiusKm({ lat: c.lat, lon: c.lng }, { lat: map.getBounds().getNorthEast().lat, lon: map.getBounds().getNorthEast().lng })
              hapticLight()
              onFocusSearchHere({ lat: c.lat, lon: c.lng }, radiusKm)
            }}
            className="flex items-center gap-1.5 rounded-full border border-border bg-background/95 backdrop-blur-sm px-3 py-1.5 text-sm font-medium shadow-md hover:bg-muted transition-colors"
          >
            <Search className="w-3.5 h-3.5" aria-hidden />
            {t.map.searchHereFocus}
          </button>
        </div>
      )}

      {onSetMapLayers && (
        layersCollapsed ? (
          <button
            type="button"
            aria-disabled={focusMode}
            aria-label={[
              t.map.layersExpand,
              showParking ? t.chat.focusChipParking : null,
              hasToiletData && showToilets ? t.chat.focusChipToilet : null,
            ].filter(Boolean).join(" · ")}
            onClick={toggleLayersCollapsed}
            disabled={focusMode}
            className={`absolute bottom-3 left-3 z-[1000] flex items-center gap-1.5 rounded-xl border border-border bg-background/95 backdrop-blur-sm shadow-md px-2.5 py-1.5 ${focusMode ? "opacity-50 pointer-events-none" : "hover:bg-muted transition-colors"}`}
          >
            <Layers className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden />
            {showParking && (
              <span aria-hidden className="flex items-center justify-center w-5 h-5 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-600/10 rounded-full">🅿</span>
            )}
            {hasToiletData && showToilets && (
              <span aria-hidden className="flex items-center justify-center w-5 h-5 text-xs font-semibold text-pink-700 dark:text-pink-400 bg-pink-700/10 rounded-full">🚻</span>
            )}
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden />
          </button>
        ) : (
          <div
            aria-disabled={focusMode}
            role="group"
            aria-label={t.map.layersLabel}
            className={`absolute bottom-3 left-3 z-[1000] rounded-xl border border-border bg-background/95 backdrop-blur-sm shadow-md text-xs overflow-hidden ${focusMode ? "opacity-50 pointer-events-none" : ""}`}
          >
            <div className="flex items-center justify-between gap-3 px-2.5 py-1.5 border-b border-border">
              <span className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
                <Layers className="w-3.5 h-3.5" aria-hidden />
                {t.map.layersLabel}
              </span>
              <button
                type="button"
                onClick={toggleLayersCollapsed}
                aria-label={t.map.layersCollapse}
                className="shrink-0 -mr-1 p-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <ChevronDown className="w-3.5 h-3.5 rotate-180" aria-hidden />
              </button>
            </div>
            <div className="p-2 space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!showParking}
                  onChange={(e) => onSetMapLayers(e.target.checked, !!showToilets)}
                  className="w-3.5 h-3.5"
                />
                <span aria-hidden className="w-4 h-4 rounded-full bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center text-[10px] font-bold">🅿</span>
                {t.chat.focusChipParking}
                {showWeakParking && (
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="w-2 h-2 rounded-full bg-orange-500" aria-hidden />
                    {t.map.parkingAccessible}
                  </span>
                )}
              </label>
              {hasToiletData && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!showToilets}
                    onChange={(e) => onSetMapLayers(!!showParking, e.target.checked)}
                    className="w-3.5 h-3.5"
                  />
                  <span aria-hidden className="w-4 h-4 rounded-full bg-pink-700/10 text-pink-700 dark:text-pink-400 flex items-center justify-center text-[10px]">🚻</span>
                  {t.chat.focusChipToilet}
                </label>
              )}
            </div>
          </div>
        )
      )}

      {detailPlace && typeof document !== "undefined" && createPortal(
        <PlaceDebugSheet place={detailPlace} onClose={() => setDetailPlace(null)} />,
        document.body,
      )}
    </div>
  )
}
