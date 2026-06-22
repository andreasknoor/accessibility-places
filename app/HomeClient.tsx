"use client"

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react"
import { track } from "@/lib/analytics"
import * as Sentry from "@sentry/nextjs"
import { SlidersHorizontal, ChevronRight, ChevronLeft } from "lucide-react"
import dynamic from "next/dynamic"
import Script from "next/script"
import Link from "next/link"
import SplashOverlay   from "@/components/SplashOverlay"
import WheelchairRace  from "@/components/easter-eggs/WheelchairRace"
import ChatPanel       from "@/components/chat/ChatPanel"
import FilterPanel  from "@/components/filters/FilterPanel"
import ResultsList  from "@/components/results/ResultsList"
import LanguageSwitcher from "@/components/LanguageSwitcher"
import MobileLayout from "@/components/mobile/MobileLayout"
import SettingsSheet from "@/components/settings/SettingsSheet"
import { useIsMobile } from "@/hooks/useIsMobile"
import { useTranslations, useLocale } from "@/lib/i18n"
import { DEFAULT_RADIUS_KM, RADIUS_MAX_KM, regionForCoordinates } from "@/lib/config"
import { SEO_CATEGORY_TO_CHIP_IDX, SEO_CATEGORY_QUERY_TERM } from "@/lib/cities"
import { haversineMetres } from "@/lib/matching/match"
import { passesFiltersForSource } from "@/lib/matching/merge"
import { useSettings, loadSettings, DEFAULT_APP_SETTINGS } from "@/lib/settings"
import { markMountAndIsReturning, clearReturningFlag, loadActiveMode, saveActiveMode, loadSearchRun, saveSearchRun, clearSearchRun, clearSessionSearch } from "@/lib/session-restore"
import { getCurrentPosition, getBestPosition, isGeolocationAvailable } from "@/lib/native/geolocation"
import { consumePendingNativeAction } from "@/lib/native/actions"
import { cn } from "@/lib/utils"
import type { AppSettings } from "@/lib/settings"
import type { Place, ParkingSpot, AmenityFeature, AmenityType, SearchFilters, ActiveSources, SearchResult, SourceId, SourceState, FilterDebug } from "@/lib/types"

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
  alwaysShowToilets: false,
}

const DEFAULT_SOURCES: ActiveSources = {
  accessibility_cloud: true,
  osm:                 true,
  reisen_fuer_alle:    true,
  ginto:               true,
  acceslibre:          true,
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
    const s = loadSettings()
    const initialParking = s.alwaysShowParking
    const initialToilets = s.alwaysShowToilets
    if (!raw) return { filters: { ...DEFAULT_FILTERS, alwaysShowParking: initialParking, alwaysShowToilets: initialToilets }, sources: DEFAULT_SOURCES, radiusKm: DEFAULT_RADIUS_KM }
    const saved = JSON.parse(raw)
    return {
      // Spread saved values onto defaults so new keys added in future always
      // have a fallback. alwaysShowParking/alwaysShowToilets come from app settings, not prefs.
      filters:  { ...DEFAULT_FILTERS,  ...(saved.filters  ?? {}), alwaysShowParking: initialParking, alwaysShowToilets: initialToilets },
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
  // Arriving via an app-generated place deep-link (…?selectLat=…&selectLon=…, no
  // city). Like an SEO city link, this must start in "text" mode and must NOT fall
  // back to the user's default search mode: a "nearby" default would otherwise show
  // the wrong mode on desktop and, on mobile, auto-locate and run a GPS search that
  // races/overrides the deep-link place lookup (the linked place then only appears
  // when the device happens to be near it).
  const isPlaceDeepLink = !initialCity && initialSelectLat != null && initialSelectLon != null
  const isMobile = useIsMobile()

  const [settings, updateSettings] = useSettings()

  const [filters,       setFilters]      = useState<SearchFilters>(DEFAULT_FILTERS)
  const [sources,       setSources]      = useState<ActiveSources>(DEFAULT_SOURCES)
  const [radiusKm,      setRadiusKm]     = useState<number>(DEFAULT_RADIUS_KM)
  const [places,        setPlaces]       = useState<Place[]>([])
  const [parkingSpots,  setParkingSpots]  = useState<ParkingSpot[]>([])
  const [toiletSpots,   setToiletSpots]   = useState<AmenityFeature[]>([])
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
  // Venue name when the last search was a specific-venue lookup (placeSearch).
  // Drives the "Results for <name>" banner; undefined for area searches.
  const [placeSearchName, setPlaceSearchName] = useState<string | undefined>()
  // Category-only query mirroring ChatPanel's chip selection. Lets "search here"
  // run before any search exists (text mode, no location yet), respecting the chip.
  const [categoryQuery, setCategoryQuery] = useState<string>("")
  // SSR-safe init: the server has no localStorage (loadSettings → defaults), so
  // initialise to the same value the server renders. The stored preference is
  // applied post-hydration in the useLayoutEffect below to avoid a server/client
  // mismatch (React #418). initialCity is a prop → deterministic, safe here.
  const [chatMode,      setChatMode]     = useState<"text" | "nearby">(
    initialCity || isPlaceDeepLink ? "text" : (DEFAULT_APP_SETTINGS.defaultSearchMode ?? "nearby"),
  )
  const [filterCollapsed, setFilterCollapsed] = useState(true)
  const [sortBy,        setSortBy]       = useState<"confidence" | "distance">(() => loadSettings().sortOrder)
  const [resetKey,            setResetKey]            = useState(0)
  const [scrollToId,          setScrollToId]          = useState<string | undefined>()
  // Amenity focus mode: focus the map on GPS-radius amenity spots (parking
  // and/or WCs) within parkingRadiusKm of the user's GPS coords. Per-session.
  // `focusLayers` is the set of active layers — empty Set = not in focus mode.
  // `focusSpots` holds the GPS-radius fetch result, kept separate from the
  // result-nearby parkingSpots/toiletSpots so no backup/restore dance is needed.
  const [focusLayers,         setFocusLayers]         = useState<Set<AmenityType>>(new Set())
  const [focusSpots,          setFocusSpots]          = useState<AmenityFeature[]>([])
  // Non-null when the user ran "search this area" in focus mode (panned centre).
  // null = GPS-anchored focus. Drives whether the map fit includes the GPS dot.
  const [focusSearchCenter,   setFocusSearchCenter]   = useState<{ lat: number; lon: number } | null>(null)
  const [focusHints,          setFocusHints]          = useState<Partial<Record<AmenityType, string>>>({})
  const [focusLoadingLayer,   setFocusLoadingLayer]   = useState<AmenityType | null>(null)
  const [isFirstVisit,        setIsFirstVisit]        = useState(false)  // SSR-safe; real value read post-hydration (React #418)
  const [locateTriggerKey,    setLocateTriggerKey]    = useState(0)
  const [locatePanTrigger,    setLocatePanTrigger]    = useState(0)
  // ── Easter Eggs ────────────────────────────────────────────────────────────
  const [showRace,         setShowRace]         = useState(false)
  const logoTapCount  = useRef(0)
  const logoTapTimer  = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [hasGpsCoords,        setHasGpsCoords]        = useState(false)
  const [gpsCoords,           setGpsCoords]           = useState<{ lat: number; lon: number } | null>(null)
  const gpsCoordRef  = useRef<{ lat: number; lon: number } | null>(null)
  // Native home-screen quick action ("Rollstuhl-Parkplatz/-WC suchen") in flight.
  // `pendingFocusAction` holds the amenity to focus once GPS is available; the
  // ref-mirror lets handleSearch suppress its focus-reset so a concurrent
  // auto-search (nearby default mode) can't wipe the focus before it's applied.
  const [pendingFocusAction, setPendingFocusAction] = useState<AmenityType | null>(null)
  const quickActionActiveRef = useRef(false)
  const quickActionLocateRef = useRef(false)  // guards against a duplicate self-locate
  // Tracks whether the initial localStorage prefs have been loaded into state.
  // The persist effect must skip until the load effect has fired (otherwise
  // it would overwrite the user's saved prefs with defaults on first render).
  const prefsLoadedRef = useRef(false)
  // True once the startup search mode has been definitively established. Gates
  // the async default-mode effect so a late-resolving setting can't override a
  // manual mode switch (see the effect below for the iOS cold-start rationale).
  const modeResolvedRef = useRef(false)
  // Session restore (per-tab): true when home was remounted after navigating away
  // (e.g. FAQ → "Zurück"). Drives suppression of splash/auto-locate and the re-run
  // of the last search. sessionRestoreDoneRef gates the one-shot re-run; the
  // session-persist effects skip until sessionPersistReadyRef is set on mount.
  const sessionReturningRef   = useRef(false)
  const sessionRestoreDoneRef = useRef(false)
  const sessionPersistReadyRef = useRef(false)
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
  // Tracks the in-flight amenity-focus fetch so rapid chip toggling aborts the
  // previous request instead of letting a stale response win setFocusSpots.
  const focusAbortRef   = useRef<AbortController | null>(null)

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
    // Session restore: detect a return mount (and record it for ChatPanel's
    // auto-locate effect, which runs after this layout-effect). On a return, restore
    // the active mode instead of the default, and let modeResolvedRef pin it so the
    // async-settings effect can't reset it. SEO/deep-links keep their forced "text".
    const returning = !initialCity && !isPlaceDeepLink && markMountAndIsReturning()
    sessionReturningRef.current = returning
    if (initialCity || isPlaceDeepLink) { sessionPersistReadyRef.current = true; return }
    // Prefer the mode from the replayable search record — it was saved atomically
    // with the search, so it always matches the results we're about to restore
    // (avoids any K_MODE/K_SEARCH desync). Fall back to the standalone active mode
    // (mode switched but not searched), then to the user's default.
    const restoredMode = returning ? (loadSearchRun()?.chatMode ?? loadActiveMode()) : null
    if (restoredMode) {
      setChatMode(restoredMode)
      modeResolvedRef.current = true
    } else {
      setChatMode(loadSettings().defaultSearchMode ?? "nearby")
    }
    sessionPersistReadyRef.current = true
  }, [initialCity, isPlaceDeepLink])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Re-apply the default search mode once the async settings resolve. The
  // useLayoutEffect above reads localStorage synchronously, which works on the
  // web but is racy in the iOS standalone PWA: on cold start localStorage is not
  // yet readable at layout-effect time, so loadSettings() returns the default
  // ("nearby") and a saved "text" preference is lost. useSettings() loads in a
  // passive effect that fires after storage is ready, so we mirror the chip /
  // mobile-view fix and drive chatMode off that resolved value too. Only a
  // non-null preference acts (null = no preference / not yet loaded); guarded by
  // modeResolvedRef so it never overrides a manual mode switch.
  useEffect(() => {
    if (modeResolvedRef.current || initialCity || isPlaceDeepLink) return
    const pref = settings.defaultSearchMode
    if (pref == null) return
    setChatMode(pref)
    modeResolvedRef.current = true
  }, [settings.defaultSearchMode, initialCity, isPlaceDeepLink])

  // Persist filter/source/radius preferences across sessions.
  // alwaysShowParking + alwaysShowToilets are intentionally excluded — persisted via AppSettings.
  // Guard: skip until the load effect below has fired so we don't overwrite
  // the user's saved prefs with defaults on the first render.
  useEffect(() => {
    if (!prefsLoadedRef.current) return
    try {
      const { alwaysShowParking: _ap, alwaysShowToilets: _at, ...persistableFilters } = filters
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

  // Session restore — persist the active mode so a return mount restores it.
  useEffect(() => {
    if (!sessionPersistReadyRef.current || initialCity || isPlaceDeepLink) return
    saveActiveMode(chatMode)
  }, [chatMode, initialCity, isPlaceDeepLink])

  // Session restore — persist just enough to replay the last search (no results
  // array). Only records a real search (a query or a place lookup).
  useEffect(() => {
    if (!sessionPersistReadyRef.current || initialCity || isPlaceDeepLink) return
    const placeSearch = placeSearchName != null
    if (!lastQuery && !placeSearch) return
    saveSearchRun({
      chatMode,
      query:       lastQuery ?? "",
      coords:      lastCoords ?? null,
      nameHint:    lastNameHint ?? null,
      placeSearch,
    })
  }, [lastQuery, lastCoords, lastNameHint, placeSearchName, chatMode, initialCity, isPlaceDeepLink])

  // Lock the document scroll for the home route only (the app is a fixed-height
  // shell with its own internal scroll regions). Without this the native iOS
  // WKWebView rubber-bands the whole page, dragging the header/footer half off
  // screen and — unlike Safari/PWA — not snapping back. Scoped here so the long
  // scrolling routes (FAQ, Impressum, SEO pages) keep normal body scroll.
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyWidth:    body.style.width,
      bodyHeight:   body.style.height,
    }
    html.style.overflow = "hidden"
    body.style.overflow = "hidden"
    body.style.position = "fixed"
    body.style.width    = "100%"
    body.style.height   = "100%"
    return () => {
      html.style.overflow = prev.htmlOverflow
      body.style.overflow = prev.bodyOverflow
      body.style.position = prev.bodyPosition
      body.style.width    = prev.bodyWidth
      body.style.height   = prev.bodyHeight
    }
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
    setPlaceSearchName(placeSearch ? nameHint : undefined)
    setIsLoading(true)
    setError(undefined)
    setPlaces([])
    setParkingSpots([])
    setToiletSpots([])
    setSelectedId(undefined)
    setFilterDebug(undefined)
    // Normally a new search exits focus mode. But while a native quick action is
    // launching (which itself triggers a nearby auto-search in nearby-default
    // mode), suppress the reset so the about-to-be-applied focus layer survives.
    if (!quickActionActiveRef.current) {
      setFocusLayers(new Set())
      setFocusSpots([])
      setFocusSearchCenter(null)
      setFocusHints({})
      setFocusLoadingLayer(null)
    }
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
        body:    JSON.stringify({ userQuery: query, radiusKm: radiusKmOverride ?? radiusKm, filters: { ...filters, ...filtersOverride }, sources: { ...sources, ...sourcesOverride }, locale, coordinates: coords, nameHint, placeSearch, international: settings.internationalMode }),
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
            setToiletSpots(data.amenitySpots ?? [])
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
                } else if (next[id]?.status === "loading") {
                  // The result event is sent last, after every started adapter has
                  // already reported. A source still "loading" here was never
                  // started server-side (e.g. skipped outside DACH) — resolve it to
                  // an empty result so its spinner doesn't hang until the timeout.
                  next[id] = { status: "ok", rawCount: 0, finalCount: 0, durationMs: 0 }
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
      // Sources still "loading" never answered (timeout, 429, network error, …) —
      // mark them as errored so the FilterPanel shows the warning and the
      // results-header retry button appears (gated on hasSourceError), instead of
      // spinning forever.
      setSourceStates((prev) => {
        const next: Partial<Record<SourceId, SourceState>> = { ...prev }
        for (const id of Object.keys(next) as SourceId[]) {
          if (next[id]?.status === "loading") next[id] = { status: "error", error: t.results.networkError }
        }
        return next
      })
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
  }, [filters, sources, radiusKm, t, settings.internationalMode])

  const clearSearchState = useCallback(() => {
    setPlaces([])
    setParkingSpots([])
    setToiletSpots([])
    setSelectedId(undefined)
    setScrollToId(undefined)
    setLastQuery(undefined)
    setLastNameHint(undefined)
    setPlaceSearchName(undefined)
    setFilterDebug(undefined)
    setError(undefined)
    setSourceStates({})
    setFocusLayers(new Set())
    setFocusSpots([])
    setFocusSearchCenter(null)
    setFocusHints({})
    setFocusLoadingLayer(null)
    // Drop the restorable last-search: it no longer applies once the results/mode
    // change, so a later return mustn't replay a stale search. Keep the active mode.
    clearSearchRun()
  }, [])

  const handleSwitchMode = useCallback((mode: "text" | "nearby") => {
    modeResolvedRef.current = true
    clearSearchState()
    setChatMode(mode)
    setResetKey((k) => k + 1)
  }, [clearSearchState])

  const handleModeChange = useCallback((mode: "text" | "nearby") => {
    modeResolvedRef.current = true
    clearSearchState()
    setChatMode(mode)
  }, [clearSearchState])

  const handleReset = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS, alwaysShowParking: settings.alwaysShowParking, alwaysShowToilets: settings.alwaysShowToilets })
    setSources(DEFAULT_SOURCES)
    setRadiusKm(DEFAULT_RADIUS_KM)
    setPlaces([])
    setParkingSpots([])
    setToiletSpots([])
    setSelectedId(undefined)
    setLastQuery(undefined)
    setLastCoords(undefined)
    setLastNameHint(undefined)
    setPlaceSearchName(undefined)
    setSearchCenter(undefined)
    setFilterDebug(undefined)
    setError(undefined)
    setSourceStates({})
    setIsLoading(false)
    setFocusLayers(new Set())
    setFocusSpots([])
    setFocusSearchCenter(null)
    setFocusHints({})
    setFocusLoadingLayer(null)
    const dismissed = (() => { try { return !!localStorage.getItem("ap_welcome_dismissed") } catch { return false } })()
    if (!dismissed) setIsFirstVisit(true)
    setChatMode(settings.defaultSearchMode ?? "nearby")
    setSortBy(settings.sortOrder)
    setFilterCollapsed(true)
    try { localStorage.removeItem("ap_last_search") } catch { /* ignore */ }
    try { localStorage.removeItem("ap_visited") } catch { /* ignore */ }
    clearSessionSearch()  // full reset: drop restorable mode + last search
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
      if (settings.internationalMode) qs.set("intl", "1")
      const res = await fetch(`/api/geocode?${qs}`)
      if (res.status === 404) { track("place_not_found", { reason: "not_found" }); setError(t.chat.placeNotFound); setIsLoading(false); return }
      if (!res.ok)            { setError(t.chat.errorGeneric);  setIsLoading(false); return }
      const { lat, lon } = await res.json()
      await handleSearch("", undefined, { lat, lon }, nameHint, undefined, undefined, true)
    } catch {
      setError(t.chat.errorGeneric)
      setIsLoading(false)
    }
  }, [searchCenter, t, handleSearch, settings.internationalMode])

  const handleSearchHere = useCallback((coords: { lat: number; lon: number }) => {
    // Re-run the last search if there is one; otherwise (text mode, nothing
    // searched yet) run a fresh search at the panned point using the current
    // chip category. lastNameHint only applies to the re-run case.
    if (lastQuery) {
      handleSearch(lastQuery, undefined, coords, lastNameHint)
    } else if (categoryQuery) {
      handleSearch(categoryQuery, undefined, coords)
    }
  }, [lastQuery, lastNameHint, categoryQuery, handleSearch])

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
      { osm: true, accessibility_cloud: true, reisen_fuer_alle: true, ginto: true, acceslibre: true, google_places: true },
    )
  // Only run once on mount — URL params are stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Session restore — on a return mount (home remounted after a static page), replay
  // the last search at the stored coordinates. Reuses handleSearch (no new logic);
  // stored coords mean a nearby search does NOT re-locate. ChatPanel's auto-locate is
  // suppressed for this mount (isReturningNow), so only this re-run executes. SEO/
  // deep-links take precedence (handled by their own effects above).
  useEffect(() => {
    if (sessionRestoreDoneRef.current || autoSearchFiredRef.current) return
    if (initialCity || isPlaceDeepLink || !sessionReturningRef.current) return
    const run = loadSearchRun()
    if (!run || (!run.query && !run.placeSearch)) return
    sessionRestoreDoneRef.current = true
    handleSearch(
      run.query,
      undefined,
      run.coords ?? undefined,
      run.nameHint ?? undefined,
      undefined,
      undefined,
      run.placeSearch || undefined,
    )
  // Run once on mount — restore inputs are read from sessionStorage.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Clear the one-shot return signal after this mount has consumed it. This passive
  // effect runs after ChatPanel's auto-locate (child) passive effect, so a later
  // ChatPanel-only remount (reset / mode switch via resetKey, which does not remount
  // HomeClient) is correctly treated as a fresh start, not a return.
  useEffect(() => { clearReturningFlag() }, [])

  // Primary welcome CTA: start the nearby search (triggers ChatPanel locate) and
  // leave the welcome screen.
  const handleStartNearby = useCallback(() => {
    try { localStorage.setItem("ap_welcome_dismissed", "1") } catch { /* ignore */ }
    setIsFirstVisit(false)
    setLocateTriggerKey((k) => k + 1)
  }, [])

  // Secondary "don't show again": dismiss the welcome without starting a search.
  const handleDismissWelcome = useCallback(() => {
    try { localStorage.setItem("ap_welcome_dismissed", "1") } catch { /* ignore */ }
    setIsFirstVisit(false)
  }, [])

  const handleGpsResolved = useCallback((coords: { lat: number; lon: number }) => {
    markVisited()
    gpsCoordRef.current = coords
    setGpsCoords(coords)
    setHasGpsCoords(true)
  }, [])

  // Locate button: fetch GPS, set user dot, trigger pan in MapView (locatePanTrigger).
  // Also keeps gpsCoords in sync so nearby searches benefit from the fresh position.
  // Returns a promise so MapView can track loading/error state on the button itself.
  const handleLocate = useCallback(async () => {
    // getBestPosition watches briefly and keeps the most accurate fix (resolving
    // early at <=50 m) instead of the first, often-coarse one — avoids the "next
    // to me" / "where I just was" jumps a single getCurrentPosition can produce.
    // It forces highAccuracy + maximumAge:0, which is ideal on mobile GPS but
    // often fails on desktop (no GPS, network-only location): POSITION_UNAVAILABLE
    // or timeout. On failure, fall back to a relaxed fix that may reuse a recent
    // network position rather than surfacing "location unavailable".
    const codeOf = (e: unknown) => (e as { code?: number } | undefined)?.code
    let coords: { lat: number; lon: number }
    try {
      coords = await getBestPosition({ timeout: 20_000, windowMs: 4_000, desiredAccuracyM: 50 })
    } catch (primaryErr) {
      console.warn("[locate] precise fix failed (code", codeOf(primaryErr), ")", primaryErr)
      try {
        coords = await getCurrentPosition({ enableHighAccuracy: false, maximumAge: 600_000, timeout: 10_000 })
      } catch (fallbackErr) {
        console.error("[locate] fallback fix failed (code", codeOf(fallbackErr), ")", fallbackErr)
        Sentry.captureException(fallbackErr, {
          tags: { feature: "locate" },
          extra: { primaryCode: codeOf(primaryErr), fallbackCode: codeOf(fallbackErr) },
        })
        throw fallbackErr  // let the locate button show the error toast
      }
    }
    gpsCoordRef.current = coords
    setGpsCoords(coords)
    setHasGpsCoords(true)
    setLocatePanTrigger((k) => k + 1)
  }, [])

  // Amenity focus mode: toggle a layer (parking / WC) on or off. Adding the
  // first layer enters focus mode; removing the last exits it. Each toggle
  // re-fetches the GPS-radius amenities for the resulting layer set so a
  // combined "parking + WCs" view stays in sync. The fetch result lives in
  // `focusSpots` — result-nearby parkingSpots/toiletSpots are never touched, so
  // exiting focus mode restores the original view with no backup bookkeeping.
  const noneFoundFor = useCallback(
    (type: AmenityType) => type === "parking" ? t.chat.parkingNoneFound : t.chat.toiletsNoneFound,
    [t.chat.parkingNoneFound, t.chat.toiletsNoneFound],
  )

  // Shared focus fetch: loads amenity spots (parking/WC) around `coords` for the
  // given layers and updates focus state. Used both by the GPS-origin toggle and
  // by "search this area" (panned-centre re-fetch). Aborts any in-flight fetch so
  // a stale response can't win setFocusSpots.
  const fetchFocusSpotsAt = useCallback(async (
    coords: { lat: number; lon: number },
    layers: AmenityType[],
    primaryLayer: AmenityType,
    radiusKm: number = settings.parkingRadiusKm,
  ) => {
    focusAbortRef.current?.abort()
    const controller = new AbortController()
    focusAbortRef.current = controller
    setFocusLoadingLayer(primaryLayer)
    try {
      const res = await fetch(
        `/api/nearby-parking?lat=${coords.lat}&lon=${coords.lon}&radius=${radiusKm}&types=${layers.join(",")}${settings.internationalMode ? "&intl=1" : ""}`,
        { signal: controller.signal },
      )
      const spots: AmenityFeature[] = res.ok ? await res.json() : []
      setFocusSpots(spots)
      const hints: Partial<Record<AmenityType, string>> = {}
      for (const layer of layers) {
        if (!spots.some((s) => s.amenityType === layer)) hints[layer] = noneFoundFor(layer)
      }
      setFocusHints(hints)
    } catch (err) {
      // Aborted fetch: a newer request superseded this one — leave its state alone.
      if (err instanceof DOMException && err.name === "AbortError") return
      const hints: Partial<Record<AmenityType, string>> = {}
      for (const layer of layers) hints[layer] = noneFoundFor(layer)
      setFocusHints(hints)
    } finally {
      // Only the latest request clears the spinner; a superseded one must not.
      if (focusAbortRef.current === controller) setFocusLoadingLayer(null)
    }
  }, [settings.parkingRadiusKm, settings.internationalMode, noneFoundFor])

  const handleToggleFocusLayer = useCallback(async (type: AmenityType) => {
    const coords = gpsCoordRef.current ?? gpsCoords
    if (!coords) return

    // Single-select: clicking an active layer deactivates; clicking the other switches.
    const next = new Set<AmenityType>()
    if (!focusLayers.has(type)) next.add(type)
    setFocusLayers(next)
    // Toggling a layer re-anchors the focus search at the GPS location.
    setFocusSearchCenter(null)

    // Removing the last layer exits focus mode — clear the focus state.
    if (next.size === 0) {
      focusAbortRef.current?.abort()
      setFocusSpots([])
      setFocusSearchCenter(null)
      setFocusHints({})
      setFocusLoadingLayer(null)
      return
    }

    track("amenity_focus_enter", { layers: [...next].join(",") })
    await fetchFocusSpotsAt(coords, [...next], type)
  }, [focusLayers, gpsCoords, fetchFocusSpotsAt])

  // "Search this area" in amenity focus mode: re-fetch the active focus layers at
  // the panned map centre instead of GPS. Keeps focus mode active; the panned
  // centre is recorded so the map fit no longer forces the GPS dot into view.
  const handleFocusSearchHere = useCallback((center: { lat: number; lon: number }, radiusKm: number) => {
    const layers = [...focusLayers]
    if (layers.length === 0) return
    setFocusSearchCenter(center)
    track("amenity_focus_search_here", { layers: layers.join(",") })
    void fetchFocusSpotsAt(center, layers, layers[0], radiusKm)
  }, [focusLayers, fetchFocusSpotsAt])

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

  // Native bridges (iOS/Android shell):
  //  1. Quick Action — reads the action stored by AppDelegate
  //     (UIApplicationShortcutItem) via @capacitor/preferences. Rather than
  //     imperatively locating + toggling here (which races the ChatPanel
  //     auto-locate in nearby-default mode and loses the intent), it only sets
  //     `pendingFocusAction`; a dedicated effect below applies the focus once
  //     GPS is available. `quickActionActiveRef` keeps handleSearch from wiping
  //     the focus while the launch is in flight.
  //  2. Universal Links — since the shell loads a remote URL, an incoming
  //     place-detail link (…?selectLat=…) does NOT auto-navigate the WebView;
  //     appUrlOpen fires instead, so we navigate to the link and let page.tsx
  //     re-read the query params (which trigger the existing deep-link effect).
  useEffect(() => {
    let cancelled = false

    async function checkAction() {
      const action = await consumePendingNativeAction()
      if (!action || cancelled) return
      quickActionActiveRef.current = true
      quickActionLocateRef.current = false
      // A quick action is an explicit engagement — never let the welcome screen
      // block the resulting map/focus view on a first-ever launch.
      setIsFirstVisit(false)
      setChatMode("nearby")
      setPendingFocusAction(action)
    }

    checkAction()

    // Navigate the WebView to an incoming place-detail deep link so page.tsx
    // re-reads selectLat/selectLon/selectName. Only links carrying selectLat are
    // place-detail links (matches the AASA scope); everything else is ignored.
    function maybeFollowDeepLink(url: string) {
      try {
        const u = new URL(url)
        if (!u.searchParams.has("selectLat")) return
        const target = u.pathname + u.search
        if (target !== window.location.pathname + window.location.search) {
          window.location.href = u.href // full reload → page.tsx re-reads params
        }
      } catch { /* malformed URL — ignore */ }
    }

    const cleanups: Array<() => void> = []
    import("@capacitor/app").then(({ App: CapApp }) => {
      if (cancelled) return
      // Re-check the pending quick action whenever the app resumes (warm launch).
      CapApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) checkAction()
      }).then((handle) => { cleanups.push(() => handle.remove()) })

      // Universal Link arriving while/after the app is open (warm).
      CapApp.addListener("appUrlOpen", ({ url }) => maybeFollowDeepLink(url))
        .then((handle) => { cleanups.push(() => handle.remove()) })

      // Cold launch via Universal Link: appUrlOpen may have already fired before
      // this listener attached, so also consult the launch URL once.
      CapApp.getLaunchUrl().then((res) => {
        if (!cancelled && res?.url) maybeFollowDeepLink(res.url)
      }).catch(() => {/* no launch url */})
    }).catch(() => {/* not on native */})

    return () => {
      cancelled = true
      for (const c of cleanups) c()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Applies a pending native quick action once GPS is available. We always
  // resolve the position ourselves (deduped via quickActionLocateRef): HomeClient's
  // handleLocate only sets coords — it triggers no search — so it's safe even when
  // ChatPanel also auto-locates in nearby mode. Predicting ChatPanel's mount-time
  // auto-locate from the (just-changed) chatMode is unreliable, so we don't rely on
  // it. On iOS the OS permission dialog only appears once, so this is the single,
  // necessary prompt (finding nearby parking/WC requires a position).
  useEffect(() => {
    if (!pendingFocusAction) return
    const coords = gpsCoordRef.current ?? gpsCoords
    if (!coords) {
      if (!quickActionLocateRef.current) {
        quickActionLocateRef.current = true
        handleLocate().catch(() => {
          // Locate failed/denied — abandon the quick action cleanly.
          quickActionActiveRef.current = false
          setPendingFocusAction(null)
        })
      }
      return
    }
    // GPS is ready — enter focus mode for the requested amenity, then release
    // the search-suppression guard.
    const action = pendingFocusAction
    setPendingFocusAction(null)
    // handleToggleFocusLayer toggles: if the requested layer is already the active
    // one (e.g. warm-resume tapping the same shortcut), toggling would DEACTIVATE
    // it. A quick action must only ever enter/switch, never turn off — so skip the
    // call when it's already showing.
    if (focusLayers.has(action)) {
      quickActionActiveRef.current = false
      return
    }
    void handleToggleFocusLayer(action).finally(() => {
      quickActionActiveRef.current = false
    })
  }, [pendingFocusAction, gpsCoords, focusLayers, handleLocate, handleToggleFocusLayer])

  const focusActive = focusLayers.size > 0

  // Parking markers. In focus mode: the GPS-radius focusSpots, only if the
  // parking layer is active. Passively: the result-nearby parkingSpots, gated by
  // the alwaysShowParking display toggle. The weak "accessible" tier (yellow
  // markers) is additionally gated by showWeakParking in both modes, so a "find
  // disabled parking now" view never shows unreserved lots unasked.
  const parkingSource: ParkingSpot[] = focusActive
    ? (focusLayers.has("parking") ? focusSpots.filter((s) => s.amenityType === "parking") : [])
    : (filters.alwaysShowParking ? parkingSpots : [])
  const visibleParkingSpots = settings.showWeakParking
    ? parkingSource
    : parkingSource.filter((s) => s.tier !== "weak")

  // WC markers. Both the focus search and the passive map layer show ALL WCs
  // (standalone + venue) so a venue WC that appears as part of a found place
  // doesn't vanish when the WC layer is toggled. The publicToiletsOnly setting
  // is the single switch that restricts either view to standalone public WCs.
  const toiletSource: AmenityFeature[] = focusActive
    ? (focusLayers.has("toilet") ? focusSpots.filter((s) => s.amenityType === "toilet") : [])
    : (filters.alwaysShowToilets ? toiletSpots : [])
  const visibleToiletSpots = settings.publicToiletsOnly
    ? toiletSource.filter((s) => s.host?.kind === "standalone")
    : toiletSource

  // Data-coverage caveat banner: only when international mode is on AND the
  // resolved search centre is outside DACH. DACH searches never show it.
  const intlNotice = settings.internationalMode && searchCenter &&
    regionForCoordinates(searchCenter.lat, searchCenter.lon) !== "dach"
      ? t.results.intlNotice
      : undefined

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

  // Segmented map-layer control: sets parking + toilet display together.
  const handleSetMapLayers = useCallback((parking: boolean, toilets: boolean) => {
    if (parking) track("parking_shown")
    updateSettings({ alwaysShowParking: parking, alwaysShowToilets: toilets })
    setFilters((f) => ({ ...f, alwaysShowParking: parking, alwaysShowToilets: toilets }))
  }, [updateSettings])

  const handleUpdateSettings = useCallback((patch: Partial<AppSettings>) => {
    updateSettings(patch)
    if (patch.alwaysShowParking !== undefined) {
      setFilters((f) => ({ ...f, alwaysShowParking: patch.alwaysShowParking! }))
    }
    if (patch.alwaysShowToilets !== undefined) {
      setFilters((f) => ({ ...f, alwaysShowToilets: patch.alwaysShowToilets! }))
    }
    if (patch.sortOrder !== undefined) {
      setSortBy(patch.sortOrder)
    }
    if (patch.defaultSearchMode !== undefined) {
      setChatMode(patch.defaultSearchMode ?? "text")
    }
    if (patch.internationalMode === true) {
      setSources((s) => ({ ...s, google_places: true, acceslibre: true }))
    }
  }, [updateSettings])

  // Show the parking toggle whenever the server returned spots OR any result
  // has parking enriched from a nearby OSM node (nearbyOnly flag). Both signal
  // that disabled-parking data exists for this search area.
  const hasParkingToggle = parkingSpots.length > 0 || places.some(
    (p) => (p.accessibility.parking.details as { nearbyOnly?: boolean } | undefined)?.nearbyOnly === true,
  )

  // Amenity focus mode is only meaningful in Nearby mode with resolved GPS coords.
  const canEnterFocus = chatMode === "nearby" && (hasGpsCoords || gpsCoords !== null)

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
      <MobileLayout
        places={places}
        parkingSpots={visibleParkingSpots}
        toiletSpots={visibleToiletSpots.length > 0 ? visibleToiletSpots : undefined}
        selectedId={selectedId}
        onSelect={(p) => setSelectedId(p.id)}
        isLoading={isLoading}
        intlNotice={intlNotice}
        placeSearchName={placeSearchName}
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
        onLogoTap={handleLogoTap}
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
        onStartNearby={handleStartNearby}
        hasGpsCoords={hasGpsCoords}
        locateTrigger={locateTriggerKey}
        biasCoords={searchCenter ?? gpsCoords ?? undefined}
        onSwitchToText={() => handleSwitchMode("text")}
        chatMode={chatMode}
        onChatModeChange={handleModeChange}
        focusLayers={focusLayers}
        onToggleFocusLayer={canEnterFocus ? handleToggleFocusLayer : undefined}
        focusLoadingLayer={focusLoadingLayer}
        focusHints={focusHints}
        focusSearchCenter={focusSearchCenter}
        onFocusSearchHere={handleFocusSearchHere}
        showToilets={filters.alwaysShowToilets}
        onSetMapLayers={hasParkingToggle || toiletSpots.length > 0 ? handleSetMapLayers : undefined}
        hasToiletData={toiletSpots.length > 0}
        onSearchHere={handleSearchHere}
        onLocate={isGeolocationAvailable() ? handleLocate : undefined}
        locatePanTrigger={locatePanTrigger}
        gpsCoords={gpsCoords}
        onCategoryQueryChange={setCategoryQuery}
        activeSearchCoords={lastCoords}
      />
      </>
    )
  }

  // Desktop layout. Fullscreen is implemented via CSS class swap on the MapView
  // container — NOT a separate render path — so MapView stays mounted across
  // toggles and amenity focus mode survives. Header / ChatPanel / FilterPanel /
  // ResultsList are hidden via `display: none` so their internal state survives.
  return (
    <>
    <a
      href="#main-content"
      className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:px-4 focus-visible:py-2 focus-visible:rounded-md focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:shadow-lg"
    >
      {t.common.skipToContent}
    </a>
    <SplashOverlay />
    {showRace && <WheelchairRace onDone={() => setShowRace(false)} />}
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
        <h1 className="sr-only">{t.app.srHeading}</h1>
      </header>

      {/* ── Chat / search bar ── */}
      <div role="search" className={cn(isFullscreen && "hidden")}>
        <ChatPanel
          key={resetKey}
          onSearch={(query, coords, nameHint) => handleSearch(query, undefined, coords, nameHint)}
          onPlaceSearch={handlePlaceSearch}
          international={settings.internationalMode}
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
          focusLayers={focusLayers}
          onToggleFocusLayer={canEnterFocus ? handleToggleFocusLayer : undefined}
          focusLoadingLayer={focusLoadingLayer}
          focusHints={focusHints}
          onCategoryQueryChange={setCategoryQuery}
          activeSearchCoords={lastCoords}
        />
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div role="alert" className={cn("px-4 py-2 bg-destructive/10 text-destructive text-sm border-b border-destructive/20 shrink-0", isFullscreen && "hidden")}>
          {error}
        </div>
      )}

      {/* ── Main: filter | results | divider | map ── */}
      <main id="main-content" className="flex flex-1 min-h-0 overflow-hidden">
        {filterCollapsed ? (
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
            <div className={cn("relative flex flex-col shrink-0 min-h-0", isFullscreen && "hidden")}>
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
            intlNotice={intlNotice}
            searchCenter={chatMode === "nearby" ? searchCenter : undefined}
            placeSearchName={placeSearchName}
            parkingSpotCount={parkingSpots.length > 0 ? parkingSpots.length : undefined}
            sortBy={sortBy}
            onSortChange={(s) => { setSortBy(s); updateSettings({ sortOrder: s }) }}
            chatMode={chatMode}
            onSwitchToText={chatMode !== "text" ? () => handleSwitchMode("text") : undefined}
            isFirstVisit={isFirstVisit}
            onDismissWelcome={handleDismissWelcome}
            onStartNearby={handleStartNearby}
          />
          <footer className="shrink-0 border-t border-border px-4 py-2 flex justify-end gap-4">
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
          </footer>
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
            toiletSpots={visibleToiletSpots.length > 0 ? visibleToiletSpots : undefined}
            center={searchCenter}
            userLocation={gpsCoords ?? undefined}
            selectedId={selectedId}
            onSelect={(p) => { setSelectedId(p.id); setScrollToId(p.id) }}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen((v) => !v)}
            showParking={filters.alwaysShowParking}
            showToilets={filters.alwaysShowToilets}
            onSetMapLayers={hasParkingToggle || toiletSpots.length > 0 ? handleSetMapLayers : undefined}
            hasToiletData={toiletSpots.length > 0}
            isLoading={isLoading}
            autoZoom={settings.autoZoom}
            focusMode={focusActive}
            focusSearchCenter={focusSearchCenter}
            onFocusSearchHere={handleFocusSearchHere}
            showWeakParking={settings.showWeakParking}
            onSearchHere={handleSearchHere}
            onLocate={isGeolocationAvailable() ? handleLocate : undefined}
            locatePanTrigger={locatePanTrigger}
          />
        </div>
      </main>
    </div>
    </>
  )
}
