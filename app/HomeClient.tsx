"use client"

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react"
import { track } from "@vercel/analytics"
import * as Sentry from "@sentry/nextjs"
import { SlidersHorizontal, ChevronRight, ChevronLeft } from "lucide-react"
import dynamic from "next/dynamic"
import Script from "next/script"
import Link from "next/link"
import SplashOverlay   from "@/components/SplashOverlay"
import WheelchairRace  from "@/components/easter-eggs/WheelchairRace"
import ChatPanel       from "@/components/chat/ChatPanel"
import { useShakeDetector } from "@/hooks/useShakeDetector"
import FilterPanel  from "@/components/filters/FilterPanel"
import ResultsList  from "@/components/results/ResultsList"
import LanguageSwitcher from "@/components/LanguageSwitcher"
import MobileLayout from "@/components/mobile/MobileLayout"
import SettingsSheet from "@/components/settings/SettingsSheet"
import { useIsMobile } from "@/hooks/useIsMobile"
import { useTranslations, useLocale } from "@/lib/i18n"
import { DEFAULT_RADIUS_KM, RADIUS_MAX_KM } from "@/lib/config"
import { SEO_CATEGORY_TO_CHIP_IDX, SEO_CATEGORY_QUERY_TERM } from "@/lib/cities"
import { haversineMetres } from "@/lib/matching/match"
import { passesFiltersForSource } from "@/lib/matching/merge"
import { useSettings, loadSettings, DEFAULT_APP_SETTINGS } from "@/lib/settings"
import { getCurrentPosition, isGeolocationAvailable } from "@/lib/native/geolocation"
import { cn } from "@/lib/utils"
import type { AppSettings } from "@/lib/settings"
import type { Place, ParkingSpot, SearchFilters, ActiveSources, SearchResult, SourceId, SourceState, FilterDebug } from "@/lib/types"

// Leaflet must not run on server
const MapView = dynamic(() => import("@/components/map/MapView"), { ssr: false })

const DEFAULT_FILTERS: SearchFilters = {
  entrance:         true,
  toilet:           true,
  parking:          false,
  // Default `true`: when the parking filter is enabled, nearby-only
  // enrichment counts as a pass — preserves the legacy behaviour before
  // parkingNearby became an explicit toggle. Migrated saved prefs without
  // this key fall through to this default.
  parkingNearby:    true,
  seating:          false,
  onlyVerified:     false,
  acceptUnknown:    false,
  alwaysShowParking: false,
}

const DEFAULT_SOURCES: ActiveSources = {
  accessibility_cloud: true,
  osm:                 true,
  reisen_fuer_alle:    true,
  ginto:               true,
  google_places:       false,
}

const PREFS_KEY = "ap_prefs"

// Overall client-side deadline for a search. The server's slowest legitimate
// path is Ginto (up to 2 × 20 s) + merge, so 45 s leaves margin for a real
// result while still catching a stalled stream (a hanging adapter that holds
// the pipeline open with no result event).
const SEARCH_TIMEOUT_MS = 45_000

function loadSavedPrefs(): { filters: SearchFilters; sources: ActiveSources; radiusKm: number } {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    const initialParking = loadSettings().alwaysShowParking
    if (!raw) return { filters: { ...DEFAULT_FILTERS, alwaysShowParking: initialParking }, sources: DEFAULT_SOURCES, radiusKm: DEFAULT_RADIUS_KM }
    const saved = JSON.parse(raw)
    return {
      // Spread saved values onto defaults so new keys added in future always
      // have a fallback. alwaysShowParking comes from app settings, not prefs.
      filters:  { ...DEFAULT_FILTERS,  ...(saved.filters  ?? {}), alwaysShowParking: initialParking },
      sources:  { ...DEFAULT_SOURCES,  ...(saved.sources  ?? {}) },
      radiusKm: typeof saved.radiusKm === "number" ? saved.radiusKm : DEFAULT_RADIUS_KM,
    }
  } catch {
    return { filters: DEFAULT_FILTERS, sources: DEFAULT_SOURCES, radiusKm: DEFAULT_RADIUS_KM }
  }
}

interface Props {
  initialCity?:       string
  initialCategory?:   string
  initialSelectLat?:  number
  initialSelectLon?:  number
  initialSelectName?: string
}

export default function HomeClient({ initialCity, initialCategory, initialSelectLat, initialSelectLon, initialSelectName }: Props) {
  const t        = useTranslations()
  const { locale } = useLocale()
  const isMobile = useIsMobile()

  const [settings, updateSettings] = useSettings()

  const [filters,       setFilters]      = useState<SearchFilters>(DEFAULT_FILTERS)
  const [sources,       setSources]      = useState<ActiveSources>(DEFAULT_SOURCES)
  const [radiusKm,      setRadiusKm]     = useState<number>(DEFAULT_RADIUS_KM)
  const [places,        setPlaces]       = useState<Place[]>([])
  const [parkingSpots,  setParkingSpots]  = useState<ParkingSpot[]>([])
  const [selectedId,    setSelectedId]   = useState<string | undefined>()
  const [isLoading,     setIsLoading]    = useState(false)
  const [searchCenter,  setSearchCenter] = useState<{ lat: number; lon: number } | undefined>()
  const [filterDebug,   setFilterDebug]  = useState<FilterDebug | undefined>()
  const [isFullscreen,  setIsFullscreen] = useState(false)
  const [error,         setError]        = useState<string | undefined>()
  const [sourceStates,  setSourceStates] = useState<Partial<Record<SourceId, SourceState>>>({})
  const [resultsWidth,  setResultsWidth] = useState(504)
  const [lastQuery,     setLastQuery]    = useState<string | undefined>()
  const [lastCoords,    setLastCoords]   = useState<{ lat: number; lon: number } | undefined>()
  const [lastNameHint,  setLastNameHint] = useState<string | undefined>()
  // SSR-safe init: the server has no localStorage (loadSettings → defaults), so
  // initialise to the same value the server renders. The stored preference is
  // applied post-hydration in the useLayoutEffect below to avoid a server/client
  // mismatch (React #418). initialCity is a prop → deterministic, safe here.
  const [chatMode,      setChatMode]     = useState<"text" | "nearby" | "place">(
    initialCity ? "text" : (DEFAULT_APP_SETTINGS.defaultSearchMode ?? "nearby"),
  )
  const [filterCollapsed, setFilterCollapsed] = useState(true)
  const [sortBy,        setSortBy]       = useState<"confidence" | "distance">(() => loadSettings().sortOrder)
  const [resetKey,            setResetKey]            = useState(0)
  const [scrollToId,          setScrollToId]          = useState<string | undefined>()
  const [isParkingLoading,    setIsParkingLoading]    = useState(false)
  // Parkplatz-Modus (proposal #6): focus the map on disabled-parking spots
  // within parkingRadiusKm of the user's GPS coords. Per-session only.
  const [parkingFocusMode,    setParkingFocusMode]    = useState(false)
  const [parkingFocusHint,    setParkingFocusHint]    = useState<string | null>(null)
  const [isFirstVisit,        setIsFirstVisit]        = useState(false)  // SSR-safe; real value read post-hydration (React #418)
  const [locateTriggerKey,    setLocateTriggerKey]    = useState(0)
  // ── Easter Eggs ────────────────────────────────────────────────────────────
  const [showRace,         setShowRace]         = useState(false)
  const [shuffleKey,       setShuffleKey]       = useState(0)
  const [showMotionToast,  setShowMotionToast]  = useState(false)
  const logoTapCount  = useRef(0)
  const logoTapTimer  = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [hasGpsCoords,        setHasGpsCoords]        = useState(false)
  const [gpsCoords,           setGpsCoords]           = useState<{ lat: number; lon: number } | null>(null)
  const gpsCoordRef  = useRef<{ lat: number; lon: number } | null>(null)
  // Snapshot of the result-nearby parkingSpots (500m server-derived) taken right
  // before entering Parkplatz-Modus. Restored on exit so the toggle returns to
  // its pre-focus content — focus mode loads GPS-radius spots that would
  // otherwise overwrite the originals.
  const parkingSpotsBackupRef = useRef<ParkingSpot[] | null>(null)
  // Tracks whether the initial localStorage prefs have been loaded into state.
  // The persist effect must skip until the load effect has fired (otherwise
  // it would overwrite the user's saved prefs with defaults on first render).
  const prefsLoadedRef = useRef(false)
  const isDragging   = useRef(false)
  const dragStart    = useRef({ x: 0, width: 0 })
  const selectTarget = useRef(
    initialSelectLat != null && initialSelectLon != null
      ? { lat: initialSelectLat, lon: initialSelectLon }
      : null,
  )
  const hasAutoSelected = useRef(false)
  // Tracks the in-flight /api/search request so rapid re-fires (filter toggle, source
  // toggle, radius change) abort the previous stream instead of racing it to setState.
  const searchAbortRef  = useRef<AbortController | null>(null)

  // ── Easter Egg #2: logo tap counter ────────────────────────────────────────
  function handleLogoTap() {
    logoTapCount.current += 1
    clearTimeout(logoTapTimer.current)
    if (logoTapCount.current >= 7) {
      logoTapCount.current = 0
      setShowRace(true)
    } else {
      logoTapTimer.current = setTimeout(() => { logoTapCount.current = 0 }, 1500)
    }
  }

  // ── Easter Egg #3: shuffle ──────────────────────────────────────────────────
  function handleShuffle() {
    if (places.length === 0) return
    setPlaces((prev) => [...prev].sort(() => Math.random() - 0.5))
    setShuffleKey((k) => k + 1)
  }

  const { needsIOSPermission, requestPermission } = useShakeDetector(handleShuffle, !showRace)

  // Show iOS permission toast once when the app has results and permission not yet requested
  useEffect(() => {
    if (!needsIOSPermission || places.length === 0) return
    try {
      if (localStorage.getItem("ap_motion_perm")) return
    } catch { /* ignore */ }
    setShowMotionToast(true)
  }, [needsIOSPermission, places.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  function markVisited() {
    try { localStorage.setItem("ap_visited", "1") } catch { /* ignore */ }
    setIsFirstVisit(false)
  }

  // Apply client-only initial state after hydration. The server renders the
  // SSR-safe defaults above (no localStorage); this useLayoutEffect runs
  // synchronously before paint, so the real values appear without a visible
  // flash (same pattern as useIsMobile). Fixes the server/client hydration
  // mismatch (React #418) for first-time visitors and users whose stored
  // search mode differs from the default.
  /* eslint-disable react-hooks/set-state-in-effect -- intentional: hydration-safe sync of localStorage-derived state, mirrors useIsMobile */
  useLayoutEffect(() => {
    try {
      setIsFirstVisit(!localStorage.getItem("ap_visited") && !localStorage.getItem("ap_welcome_dismissed"))
    } catch { /* localStorage unavailable */ }
    if (!initialCity) setChatMode(loadSettings().defaultSearchMode ?? "nearby")
  }, [initialCity])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist filter/source/radius preferences across sessions.
  // alwaysShowParking is intentionally excluded — it's a per-session display toggle.
  // Guard: skip until the load effect below has fired so we don't overwrite
  // the user's saved prefs with defaults on the first render.
  useEffect(() => {
    if (!prefsLoadedRef.current) return
    try {
      const { alwaysShowParking: _ap, ...persistableFilters } = filters
      localStorage.setItem(PREFS_KEY, JSON.stringify({ filters: persistableFilters, sources, radiusKm }))
    } catch { /* ignore — localStorage unavailable (private mode, quota) */ }
  }, [filters, sources, radiusKm])

  // Load persisted prefs from localStorage after hydration.
  // Declared AFTER the persist effect so it executes second on mount —
  // persist skips (prefsLoadedRef=false), then this sets the ref to true
  // and applies the saved values; the subsequent re-render triggers persist
  // with the correct state.
  useEffect(() => {
    const prefs = loadSavedPrefs()
    prefsLoadedRef.current = true
    setFilters(prefs.filters)
    setSources(prefs.sources)
    setRadiusKm(prefs.radiusKm)
  }, [])

  const handleSearch = useCallback(async (query: string, radiusKmOverride?: number, coords?: { lat: number; lon: number }, nameHint?: string, filtersOverride?: Partial<SearchFilters>, sourcesOverride?: Partial<ActiveSources>, placeSearch?: boolean) => {
    // Cancel any in-flight search so its NDJSON stream cannot overwrite this one's state.
    searchAbortRef.current?.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller

    // Overall deadline: if the stream stalls (slow/hanging adapter) and no result
    // arrives, abort and surface an error rather than spinning forever. `timedOut`
    // lets the catch distinguish this from a newer-search abort (which bails silently).
    let timedOut = false
    const timeoutId = setTimeout(() => { timedOut = true; controller.abort() }, SEARCH_TIMEOUT_MS)

    markVisited()
    setLastQuery(query)
    setLastCoords(coords)
    setLastNameHint(nameHint)
    setIsLoading(true)
    setError(undefined)
    setPlaces([])
    setParkingSpots([])
    setSelectedId(undefined)
    setFilterDebug(undefined)
    setParkingFocusMode(false)
    parkingSpotsBackupRef.current = null
    // Initialise per-source loading state for each active source so the
    // FilterPanel renders spinners immediately.
    const initial: Partial<Record<SourceId, SourceState>> = {}
    for (const id of Object.keys(sources) as (keyof ActiveSources)[]) {
      if (sources[id]) initial[id] = { status: "loading" }
    }
    setSourceStates(initial)

    try {
      const res = await fetch("/api/search", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ userQuery: query, radiusKm: radiusKmOverride ?? radiusKm, filters: { ...filters, ...filtersOverride }, sources: { ...sources, ...sourcesOverride }, locale, coordinates: coords, nameHint, placeSearch }),
        signal:  controller.signal,
      })

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? "Search failed")
      }

      // Parse NDJSON stream: one JSON object per `\n`-terminated line.
      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer    = ""
      let placesReceived = false

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        // If a newer search aborted us between iterations, drop any buffered data
        // rather than calling setState with stale results.
        if (controller.signal.aborted) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          let event: { type: string; [k: string]: unknown }
          try { event = JSON.parse(line) } catch { continue }

          if (event.type === "source") {
            const sid = event.sourceId as SourceId
            const update: SourceState = event.status === "ok"
              ? { status: "ok",    rawCount: event.count as number, durationMs: event.durationMs as number }
              : { status: "error", error: event.error as string,    durationMs: event.durationMs as number }
            setSourceStates((prev) => ({ ...prev, [sid]: update }))
          } else if (event.type === "result") {
            // Result arrived — the stream is no longer at risk of stalling.
            clearTimeout(timeoutId)
            const data = event.payload as SearchResult
            placesReceived = data.places.length > 0
            setPlaces(data.places)
            setParkingSpots(data.parkingSpots ?? [])
            setSearchCenter(data.location)
            setFilterDebug(data.filterDebug)
            track("search", { mode: chatMode, result_count: data.places.length })
            if (data.places.length === 0) {
              track("search_no_results", { mode: chatMode, radius_km: radiusKmOverride ?? radiusKm })
            }

            // Auto-select single result for place search
            if (placeSearch && data.places.length === 1) {
              setSelectedId(data.places[0].id)
              setScrollToId(data.places[0].id)
            }

            // Auto-select place from SEO deep-link (closest within 100 m)
            if (selectTarget.current && !hasAutoSelected.current) {
              let best: (typeof data.places)[0] | undefined
              let bestDist = Infinity
              for (const p of data.places) {
                const d = haversineMetres(selectTarget.current, p.coordinates)
                if (d < bestDist) { bestDist = d; best = p }
              }
              if (best && bestDist < 100) {
                hasAutoSelected.current = true
                setSelectedId(best.id)
                setScrollToId(best.id)
              }
            }
            // Per-source count = places that would still pass the filter if
            // ONLY this source were active. This makes the displayed number
            // predictive: disabling all other sources should yield this count.
            // Sums may exceed total result count when a place could pass
            // standalone via multiple sources — that's the honest answer.
            const finalCounts: Partial<Record<SourceId, number>> = {}
            for (const p of data.places) {
              for (const sid of Object.keys(sources) as (keyof ActiveSources)[]) {
                if (!sources[sid]) continue
                if (passesFiltersForSource(p, sid, filters)) {
                  finalCounts[sid] = (finalCounts[sid] ?? 0) + 1
                }
              }
            }
            setSourceStates((prev) => {
              const next: Partial<Record<SourceId, SourceState>> = { ...prev }
              for (const id of Object.keys(prev) as SourceId[]) {
                if (next[id]?.status === "ok") {
                  next[id] = { ...next[id]!, finalCount: finalCounts[id] ?? 0 }
                }
              }
              return next
            })
          } else if (event.type === "fatal") {
            throw new Error(event.error as string)
          }
        }
      }

      // Place found by geocoding but no adapter returned data
      if (placeSearch && !placesReceived) {
        track("place_not_found", { reason: "no_data" })
        setError(t.chat.placeNoData(nameHint ?? ""))
      }
    } catch (err) {
      // Aborted by a newer search — silently bail; the newer request owns the UI
      // state. A timeout also aborts the controller, but must NOT bail silently:
      // it surfaces an error and clears loading below.
      if (controller.signal.aborted && !timedOut) return
      setError(timedOut ? t.chat.errorTimeout : t.chat.errorGeneric)
      if (timedOut) {
        // Sources still "loading" never answered before the deadline — mark them
        // as errored so the FilterPanel shows the warning and the results-header
        // retry button appears (gated on hasSourceError).
        setSourceStates((prev) => {
          const next: Partial<Record<SourceId, SourceState>> = { ...prev }
          for (const id of Object.keys(next) as SourceId[]) {
            if (next[id]?.status === "loading") next[id] = { status: "error", error: t.results.networkError }
          }
          return next
        })
      }
      console.error(err)
      const e = err instanceof Error ? err : new Error(String(err))
      // Report to GlitchTip (caught here, so it would not be picked up by the
      // SDK's global handlers). A timeout is a strong signal that a source is
      // stalling server-side — tag it so it stands out from generic failures.
      Sentry.captureException(e, { tags: { context: "search", reason: timedOut ? "timeout" : "error" } })
    } finally {
      clearTimeout(timeoutId)
      // Clear the loading flag for the current request OR a timed-out one. An
      // aborted *older* request (newer search took over) must not toggle it off
      // while the newer one runs — but a timeout has no successor, so it must.
      if (!controller.signal.aborted || timedOut) setIsLoading(false)
    }
  }, [filters, sources, radiusKm, t])

  const clearSearchState = useCallback(() => {
    setPlaces([])
    setParkingSpots([])
    setSelectedId(undefined)
    setScrollToId(undefined)
    setLastQuery(undefined)
    setLastNameHint(undefined)
    setFilterDebug(undefined)
    setError(undefined)
    setSourceStates({})
    setParkingFocusMode(false)
    parkingSpotsBackupRef.current = null
  }, [])

  const handleSwitchMode = useCallback((mode: "text" | "nearby" | "place") => {
    clearSearchState()
    setChatMode(mode)
    setResetKey((k) => k + 1)
  }, [clearSearchState])

  const handleModeChange = useCallback((mode: "text" | "nearby" | "place") => {
    clearSearchState()
    setChatMode(mode)
  }, [clearSearchState])

  const handleReset = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS, alwaysShowParking: settings.alwaysShowParking })
    setSources(DEFAULT_SOURCES)
    setRadiusKm(DEFAULT_RADIUS_KM)
    setPlaces([])
    setParkingSpots([])
    setSelectedId(undefined)
    setLastQuery(undefined)
    setLastCoords(undefined)
    setLastNameHint(undefined)
    setSearchCenter(undefined)
    setFilterDebug(undefined)
    setError(undefined)
    setSourceStates({})
    setIsLoading(false)
    setParkingFocusMode(false)
    parkingSpotsBackupRef.current = null
    const dismissed = (() => { try { return !!localStorage.getItem("ap_welcome_dismissed") } catch { return false } })()
    if (!dismissed) setIsFirstVisit(true)
    setChatMode(settings.defaultSearchMode ?? "nearby")
    setSortBy(settings.sortOrder)
    setFilterCollapsed(true)
    try { localStorage.removeItem("ap_last_search") } catch { /* ignore */ }
    try { localStorage.removeItem("ap_visited") } catch { /* ignore */ }
    // Clean up any deep-link or SEO params from the URL without a page reload
    window.history.replaceState({}, "", locale === "en" ? "/en/" : "/")
    setResetKey((k) => k + 1)
  }, [settings, locale])

  const handlePlaceSearch = useCallback(async (nameHint: string, preResolvedCoords?: { lat: number; lon: number }) => {
    if (!nameHint.trim()) return
    setIsLoading(true)
    setError(undefined)
    try {
      // When Photon already returned coordinates (via place-suggest), skip Nominatim
      if (preResolvedCoords) {
        await handleSearch("", undefined, preResolvedCoords, nameHint, undefined, undefined, true)
        return
      }
      // Best-effort location bias: existing search center → cached GPS → fresh GPS
      const getCoords = (): Promise<{ lat: number; lon: number } | null> => {
        if (searchCenter) return Promise.resolve(searchCenter)
        if (gpsCoordRef.current) return Promise.resolve(gpsCoordRef.current)
        return getCurrentPosition({ timeout: 20_000, enableHighAccuracy: false, maximumAge: 60_000 })
          .then((c) => c)
          .catch(() => null)
      }
      const coords = await getCoords()
      const qs = new URLSearchParams({ q: nameHint })
      if (coords) { qs.set("lat", String(coords.lat)); qs.set("lon", String(coords.lon)) }
      const res = await fetch(`/api/geocode?${qs}`)
      if (res.status === 404) { track("place_not_found", { reason: "not_found" }); setError(t.chat.placeNotFound); setIsLoading(false); return }
      if (!res.ok)            { setError(t.chat.errorGeneric);  setIsLoading(false); return }
      const { lat, lon } = await res.json()
      await handleSearch("", undefined, { lat, lon }, nameHint, undefined, undefined, true)
    } catch {
      setError(t.chat.errorGeneric)
      setIsLoading(false)
    }
  }, [searchCenter, t, handleSearch])

  const handleExpandRadius = useCallback(() => {
    if (!lastQuery) return
    const newRadius = Math.min(radiusKm * 2, RADIUS_MAX_KM)
    setRadiusKm(newRadius)
    handleSearch(lastQuery, newRadius, lastCoords, lastNameHint)
  }, [lastQuery, radiusKm, lastCoords, lastNameHint, handleSearch])

  const handleRadiusChange = useCallback((km: number) => {
    setRadiusKm(km)
    if (lastQuery) handleSearch(lastQuery, km, lastCoords, lastNameHint)
  }, [lastQuery, lastCoords, lastNameHint, handleSearch])

  // Auto-trigger search when arriving from an SEO landing page CTA
  const autoSearchFiredRef = useRef(false)
  useEffect(() => {
    if (!initialCity || !initialCategory || autoSearchFiredRef.current) return
    const term = SEO_CATEGORY_QUERY_TERM[initialCategory]
    if (!term) return
    autoSearchFiredRef.current = true
    const queryTerm = locale === "en" ? term.en : term.de
    handleSearch(`${queryTerm} in ${initialCity}`, undefined, undefined, initialSelectName ?? undefined)
  // Only run once on mount — initialCity/initialCategory are stable URL-derived values
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-trigger search when arriving via a place deep-link (selectLat/selectLon without a
  // city query). nameHint = place name bypasses passesFilters server-side, so the linked place
  // always appears regardless of its accessibility values or the receiver's filter settings.
  useEffect(() => {
    if (initialCity || !initialSelectLat || !initialSelectLon || autoSearchFiredRef.current) return
    autoSearchFiredRef.current = true
    const query = initialCategory
      ? initialCategory.replace(/_/g, " ")
      : (initialSelectName ?? "orte")
    handleSearch(
      query,
      undefined,
      { lat: initialSelectLat, lon: initialSelectLon },
      initialSelectName,
      undefined,
      { osm: true, accessibility_cloud: true, reisen_fuer_alle: true, ginto: true, google_places: true },
    )
  // Only run once on mount — URL params are stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDismissWelcome = useCallback(() => {
    try { localStorage.setItem("ap_welcome_dismissed", "1") } catch { /* ignore */ }
    setIsFirstVisit(false)
    setLocateTriggerKey((k) => k + 1)
  }, [])

  const handleGpsResolved = useCallback((coords: { lat: number; lon: number }) => {
    markVisited()
    gpsCoordRef.current = coords
    setGpsCoords(coords)
    setHasGpsCoords(true)
  }, [])

  // Silently pre-fetch GPS when entering place-search mode so coords are
  // available immediately when the user submits (avoids mid-submit delay).
  useEffect(() => {
    if (chatMode !== "place") return
    if (gpsCoordRef.current) return
    if (!isGeolocationAvailable()) return
    getCurrentPosition({ timeout: 20_000, enableHighAccuracy: false, maximumAge: 60_000 })
      .then((c) => { gpsCoordRef.current = c; setGpsCoords(c) })
      .catch(() => { /* silently ignored — place search has other fallbacks */ })
  }, [chatMode])

  // Parkplatz-Modus enter: fetch spots for the user's GPS location, then activate
  // the mode. Doesn't toggle alwaysShowParking (focus mode overrides display so
  // the toggle state stays preserved for after-exit).
  const handleEnterParkingFocus = useCallback(async () => {
    const coords = gpsCoordRef.current ?? gpsCoords
    if (!coords) return
    track("parking_focus_enter")
    parkingSpotsBackupRef.current = parkingSpots
    setParkingFocusHint(null)
    setIsParkingLoading(true)
    try {
      const res = await fetch(`/api/nearby-parking?lat=${coords.lat}&lon=${coords.lon}&radius=${settings.parkingRadiusKm}`)
      if (res.ok) {
        const spots = await res.json()
        setParkingSpots(spots)
        if (spots.length === 0) setParkingFocusHint(t.chat.parkingNoneFound)
      } else {
        setParkingFocusHint(t.chat.parkingNoneFound)
      }
    } catch {
      setParkingFocusHint(t.chat.parkingNoneFound)
    } finally {
      setIsParkingLoading(false)
      setParkingFocusMode(true)
    }
  }, [gpsCoords, parkingSpots, settings.parkingRadiusKm, t.chat.parkingNoneFound])

  const handleExitParkingFocus = useCallback(() => {
    if (parkingSpotsBackupRef.current !== null) {
      setParkingSpots(parkingSpotsBackupRef.current)
      parkingSpotsBackupRef.current = null
    }
    setParkingFocusMode(false)
    setParkingFocusHint(null)
  }, [])

  const handleToggleParkingFocus = useCallback(() => {
    if (parkingFocusMode) handleExitParkingFocus()
    else handleEnterParkingFocus()
  }, [parkingFocusMode, handleEnterParkingFocus, handleExitParkingFocus])

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    dragStart.current  = { x: e.clientX, width: resultsWidth }
    e.preventDefault()
  }, [resultsWidth])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isDragging.current) return
      const delta    = e.clientX - dragStart.current.x
      const next     = Math.max(240, Math.min(800, dragStart.current.width + delta))
      setResultsWidth(next)
    }
    function onUp() { isDragging.current = false }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup",   onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup",   onUp)
    }
  }, [])

  // In Parkplatz-Modus we always show all loaded spots regardless of the display
  // toggle. The weak "accessible" tier (yellow markers) is additionally gated by
  // the showWeakParking setting — applies in both normal display and focus mode,
  // so a "find disabled parking now" view never shows unreserved lots unasked.
  const baseParkingSpots = parkingFocusMode || filters.alwaysShowParking ? parkingSpots : []
  const visibleParkingSpots = settings.showWeakParking
    ? baseParkingSpots
    : baseParkingSpots.filter((s) => s.tier !== "accessible")

  const handleFilters = useCallback((next: SearchFilters) => {
    const activated = (["entrance", "toilet", "parking", "seating", "onlyVerified"] as const)
      .filter((k) => next[k] && !filters[k])
    if (activated.length > 0) track("filter_apply", { criteria: activated.join(",") })
    setFilters(next)
  }, [filters])

  const handleToggleParking = useCallback(() => {
    setFilters((f) => {
      const next = !f.alwaysShowParking
      if (next) track("parking_shown")
      updateSettings({ alwaysShowParking: next })
      return { ...f, alwaysShowParking: next }
    })
  }, [updateSettings])

  const handleUpdateSettings = useCallback((patch: Partial<AppSettings>) => {
    updateSettings(patch)
    if (patch.alwaysShowParking !== undefined) {
      setFilters((f) => ({ ...f, alwaysShowParking: patch.alwaysShowParking! }))
    }
    if (patch.sortOrder !== undefined) {
      setSortBy(patch.sortOrder)
    }
    if (patch.defaultSearchMode !== undefined) {
      setChatMode(patch.defaultSearchMode ?? "text")
    }
  }, [updateSettings])

  // Show the parking toggle whenever the server returned spots OR any result
  // has parking enriched from a nearby OSM node (nearbyOnly flag). Both signal
  // that disabled-parking data exists for this search area.
  const hasParkingToggle = parkingSpots.length > 0 || places.some(
    (p) => (p.accessibility.parking.details as { nearbyOnly?: boolean } | undefined)?.nearbyOnly === true,
  )

  // Parkplatz-Modus is only meaningful in Nearby mode with resolved GPS coords.
  const canEnterParkingFocus = chatMode === "nearby" && (hasGpsCoords || gpsCoords !== null)

  // True when at least one source errored/timed out — gates the results-header
  // retry button so it only appears when retrying is actually useful (frees the
  // header width in the normal all-OK case).
  const hasSourceError = Object.values(sourceStates).some((s) => s?.status === "error")

  // Mobile layout
  if (isMobile) {
    return (
      <>
      {/* SplashOverlay must be the first child in BOTH return paths so React
          reconciles it by position and keeps the SAME instance across the
          isMobile flip (useIsMobile starts false, flips true pre-paint).
          Otherwise it unmounts mid-animation and never plays on mobile. */}
      <SplashOverlay />
      {showRace && <WheelchairRace onDone={() => setShowRace(false)} />}
      {showMotionToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[9996] flex items-center gap-3 bg-card border border-border rounded-2xl px-4 py-3 shadow-xl text-sm pointer-events-auto">
          <span>🌀 Schütteln zum Mischen?</span>
          <button
            className="text-primary font-semibold"
            onClick={async () => {
              const granted = await requestPermission()
              setShowMotionToast(false)
              if (granted) window.location.reload()
            }}
          >
            Aktivieren
          </button>
          <button className="text-muted-foreground" onClick={() => setShowMotionToast(false)}>✕</button>
        </div>
      )}
      <MobileLayout
        places={places}
        parkingSpots={visibleParkingSpots}
        selectedId={selectedId}
        onSelect={(p) => setSelectedId(p.id)}
        isLoading={isLoading}
        filters={filters}
        sources={sources}
        radiusKm={radiusKm}
        onFilters={handleFilters}
        onSources={setSources}
        onRadius={setRadiusKm}
        sourceStates={sourceStates}
        searchCenter={searchCenter}
        onSearch={(query, coords, nameHint) => handleSearch(query, undefined, coords, nameHint)}
        onPlaceSearch={handlePlaceSearch}
        onRerun={lastQuery ? () => handleSearch(lastQuery, undefined, lastCoords, lastNameHint) : undefined}
        hasSourceError={hasSourceError}
        onExpandRadius={lastQuery && radiusKm < RADIUS_MAX_KM ? handleExpandRadius : undefined}
        onRadiusChange={handleRadiusChange}
        hasSearched={!!(lastQuery || lastNameHint)}
        error={error}
        onReset={handleReset}
        resetKey={resetKey}
        filterDebug={filterDebug}
        initialLocation={resetKey === 0 ? initialCity : undefined}
        initialChipIdx={initialCategory && resetKey === 0 ? SEO_CATEGORY_TO_CHIP_IDX[initialCategory] : settings.defaultChipIdx ?? undefined}
        scrollToId={scrollToId}
        showParking={filters.alwaysShowParking}
        onToggleParking={hasParkingToggle ? handleToggleParking : undefined}
        parkingSpotCount={parkingSpots.length > 0 ? parkingSpots.length : undefined}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        sortBy={sortBy}
        onSortChange={(s) => { setSortBy(s); updateSettings({ sortOrder: s }) }}
        defaultMobileView={settings.defaultMobileView}
        onGpsResolved={handleGpsResolved}
        isFirstVisit={isFirstVisit}
        onResetOnboarding={() => { try { localStorage.removeItem("ap_visited"); localStorage.removeItem("ap_welcome_dismissed") } catch { /* ignore */ }; setIsFirstVisit(true) }}
        onDismissWelcome={handleDismissWelcome}
        hasGpsCoords={hasGpsCoords}
        locateTrigger={locateTriggerKey}
        biasCoords={searchCenter ?? gpsCoords ?? undefined}
        onSwitchToText={() => handleSwitchMode("text")}
        onSwitchToPlace={() => handleSwitchMode("place")}
        chatMode={chatMode}
        onChatModeChange={handleModeChange}
        parkingFocusMode={parkingFocusMode}
        onToggleParkingFocus={canEnterParkingFocus ? handleToggleParkingFocus : undefined}
        isParkingFocusLoading={isParkingLoading}
        parkingFocusHint={parkingFocusHint}
        shuffleKey={shuffleKey}
      />
      </>
    )
  }

  // Desktop layout. Fullscreen is implemented via CSS class swap on the MapView
  // container — NOT a separate render path — so MapView stays mounted across
  // toggles and parkingFocusMode survives. Header / ChatPanel / FilterPanel /
  // ResultsList are hidden via `display: none` so their internal state survives.
  return (
    <>
    <SplashOverlay />
    {showRace && <WheelchairRace onDone={() => setShowRace(false)} />}
    {showMotionToast && (
      <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[9996] flex items-center gap-3 bg-card border border-border rounded-2xl px-4 py-3 shadow-xl text-sm pointer-events-auto">
        <span>🌀 Schütteln zum Mischen?</span>
        <button
          className="text-primary font-semibold"
          onClick={async () => {
            const granted = await requestPermission()
            setShowMotionToast(false)
            if (granted) window.location.reload()
          }}
        >
          Aktivieren
        </button>
        <button className="text-muted-foreground" onClick={() => setShowMotionToast(false)}>✕</button>
      </div>
    )}
    <Script src="https://tally.so/widgets/embed.js" strategy="lazyOnload" />
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      {/* ── Top bar ── */}
      <header className={cn("flex items-center justify-between px-5 py-3 border-b border-border bg-card shrink-0", isFullscreen && "hidden")}>
        <button
          onClick={() => { handleLogoTap(); handleReset() }}
          className="flex items-center gap-2.5 hover:opacity-75 transition-opacity cursor-pointer"
          title="Reset"
        >
          <img src="/icons/icon-preview.svg" className="w-11 h-11 rounded-xl" alt="" aria-hidden />
          <div className="text-left">
            <span className="font-bold text-xl leading-none block">{t.app.title}</span>
            <p className="text-xs text-muted-foreground mt-1">{t.app.subtitle}</p>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <SettingsSheet settings={settings} onUpdate={handleUpdateSettings} onResetOnboarding={() => { try { localStorage.removeItem("ap_visited"); localStorage.removeItem("ap_welcome_dismissed") } catch { /* ignore */ }; setIsFirstVisit(true) }} />
          <LanguageSwitcher />
        </div>
      </header>

      <h1 className="sr-only">{t.app.srHeading}</h1>

      {/* ── Chat / search bar ── */}
      <div className={cn(isFullscreen && "hidden")}>
        <ChatPanel
          key={resetKey}
          onSearch={(query, coords, nameHint) => handleSearch(query, undefined, coords, nameHint)}
          onPlaceSearch={handlePlaceSearch}
          isLoading={isLoading}
          onModeChange={handleModeChange}
          autoFocus
          initialLocation={resetKey === 0 ? initialCity : undefined}
          initialChipIdx={initialCategory && resetKey === 0 ? SEO_CATEGORY_TO_CHIP_IDX[initialCategory] : settings.defaultChipIdx ?? undefined}
          initialMode={chatMode}
          onGpsResolved={handleGpsResolved}
          skipAutoLocate={isFirstVisit}
          hasGpsCoords={hasGpsCoords}
          locateTrigger={locateTriggerKey}
          biasCoords={searchCenter ?? gpsCoords ?? undefined}
          parkingFocusMode={parkingFocusMode}
          onToggleParkingFocus={canEnterParkingFocus ? handleToggleParkingFocus : undefined}
          isParkingFocusLoading={isParkingLoading}
          parkingFocusHint={parkingFocusHint}
        />
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className={cn("px-4 py-2 bg-destructive/10 text-destructive text-sm border-b border-destructive/20 shrink-0", isFullscreen && "hidden")}>
          {error}
        </div>
      )}

      {/* ── Main: filter | results | divider | map ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {chatMode !== "place" && (
          filterCollapsed ? (
            <button
              onClick={() => setFilterCollapsed(false)}
              className={cn("shrink-0 w-12 border-r border-border flex flex-col items-center justify-center gap-3 py-6 hover:bg-muted/50 transition-colors cursor-pointer", isFullscreen && "hidden")}
              aria-label={t.filters.title}
            >
              <span className="relative">
                <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
                {[filters.entrance, filters.toilet, filters.parking, filters.seating, filters.onlyVerified].filter(Boolean).length > 0 && (
                  <span className="absolute -top-3 -right-1.5 min-w-[1.125rem] h-[1.125rem] rounded-full bg-red-500 text-white text-[10px] font-bold leading-none flex items-center justify-center px-1">
                    {[filters.entrance, filters.toilet, filters.parking, filters.seating, filters.onlyVerified].filter(Boolean).length}
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground font-medium [writing-mode:vertical-rl] rotate-180 tracking-wide">{t.filters.title}</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          ) : (
            <div className={cn("relative flex flex-col shrink-0", isFullscreen && "hidden")}>
              <FilterPanel
                filters={filters}
                sources={sources}
                radiusKm={radiusKm}
                onFilters={handleFilters}
                onSources={setSources}
                onRadius={setRadiusKm}
                sourceStates={sourceStates}
                onRerun={chatMode === "nearby" && lastQuery ? () => handleSearch(lastQuery, undefined, lastCoords, lastNameHint) : undefined}
                isLoading={isLoading}
              />
              <button
                onClick={() => setFilterCollapsed(true)}
                className="absolute top-2 right-2 z-10 p-1 rounded bg-card border border-border hover:bg-muted transition-colors"
                aria-label={t.filters.title}
              >
                <ChevronLeft className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          )
        )}

        <div
          className={cn("shrink-0 border-r border-border flex flex-col min-h-0", isFullscreen && "hidden")}
          style={{ width: resultsWidth }}
        >
          <ResultsList
            places={places}
            filters={filters}
            selectedId={selectedId}
            onSelect={(p) => setSelectedId(p.id)}
            isLoading={isLoading}
            onRerun={lastQuery ? () => handleSearch(lastQuery, undefined, lastCoords, lastNameHint) : undefined}
            hasSourceError={hasSourceError}
            onExpandRadius={lastQuery && radiusKm < RADIUS_MAX_KM ? handleExpandRadius : undefined}
            radiusKm={radiusKm}
            onRadiusChange={handleRadiusChange}
            hasSearched={!!(lastQuery || lastNameHint)}
            scrollToId={scrollToId}
            filterDebug={filterDebug}
            searchCenter={chatMode === "nearby" ? searchCenter : undefined}
            parkingSpotCount={parkingSpots.length > 0 ? parkingSpots.length : undefined}
            sortBy={sortBy}
            onSortChange={(s) => { setSortBy(s); updateSettings({ sortOrder: s }) }}
            chatMode={chatMode}
            onSwitchToPlace={chatMode !== "place" ? () => handleSwitchMode("place") : undefined}
            onSwitchToText={chatMode !== "text" ? () => handleSwitchMode("text") : undefined}
            isFirstVisit={isFirstVisit}
            onDismissWelcome={handleDismissWelcome}
            shuffleKey={shuffleKey}
          />
          <div className="shrink-0 border-t border-border px-4 py-2 flex justify-end gap-4">
            <Link href={locale === "en" ? "/en/faq" : "/faq"} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t.faq.linkLabel}
            </Link>
            <Link href={locale === "en" ? "/en/legal-notice" : "/impressum"} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t.impressum.linkLabel}
            </Link>
            <Link href={locale === "en" ? "/en/about" : "/ueber-uns"} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t.about.linkLabel}
            </Link>
            <Link href={locale === "en" ? "/en/privacy" : "/datenschutz"} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t.privacy.linkLabel}
            </Link>
            <button
              data-tally-open={locale === "en" ? "vGEMjQ" : "Zjv94z"}
              data-tally-emoji-text="👋"
              data-tally-emoji-animation="wave"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              {t.faq.feedbackLabel}
            </button>
          </div>
        </div>

        {/* Draggable divider */}
        <div
          className={cn("w-1.5 shrink-0 bg-border hover:bg-primary/40 cursor-col-resize transition-colors", isFullscreen && "hidden")}
          onMouseDown={handleDividerMouseDown}
        />
        <div className={cn(
          isFullscreen
            ? "fixed inset-0 z-50 bg-background"
            : "flex-1 min-h-0 relative isolate",
        )}>
          <MapView
            places={places}
            parkingSpots={visibleParkingSpots}
            center={searchCenter}
            userLocation={chatMode === "nearby" ? searchCenter : undefined}
            selectedId={selectedId}
            onSelect={(p) => { setSelectedId(p.id); setScrollToId(p.id) }}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen((v) => !v)}
            showParking={filters.alwaysShowParking}
            onToggleParking={hasParkingToggle ? handleToggleParking : undefined}
            autoZoom={settings.autoZoom}
            parkingFocusMode={parkingFocusMode}
            showWeakParking={settings.showWeakParking}
          />
        </div>
      </div>
    </div>
    </>
  )
}
