"use client"

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from "react"
import { track, getPlatform } from "@/lib/analytics"
import { getUserId, clearUserStats, incrementLocalSearchCount } from "@/lib/user-id"
import * as Sentry from "@sentry/nextjs"
import { SlidersHorizontal, ChevronRight, ChevronLeft } from "lucide-react"
import dynamic from "next/dynamic"
import Script from "next/script"
import Link from "next/link"
import SplashOverlay   from "@/components/SplashOverlay"
import IntlHintBanner  from "@/components/IntlHintBanner"
import WheelchairRace  from "@/components/easter-eggs/WheelchairRace"
import ChatPanel       from "@/components/chat/ChatPanel"
import FilterPanel  from "@/components/filters/FilterPanel"
import ResultsList  from "@/components/results/ResultsList"
import LanguageSwitcher from "@/components/LanguageSwitcher"
import MobileLayout from "@/components/mobile/MobileLayout"
import SettingsSheet from "@/components/settings/SettingsSheet"
import { useIsMobile } from "@/hooks/useIsMobile"
import { useTranslations, useLocale } from "@/lib/i18n"
import { DEFAULT_RADIUS_KM, RADIUS_MAX_KM, regionForCoordinates, accessTierForCountry } from "@/lib/config"
import { clampVenueRadiusKm, clampAmenityRadiusKm, snapAmenityRadiusKm, snapVenueRadiusKm, rerunTarget, expandRadiusTarget, canShowResultsRadiusPicker, amenitySpotKey, type ViewportOrigin } from "@/lib/search-ui"
import { SEO_CATEGORY_SLUGS, SEO_CATEGORY_QUERY_TERM } from "@/lib/cities"
import { haversineMetres } from "@/lib/matching/match"
import { passesFiltersForSource } from "@/lib/matching/merge"
import { useSettings, loadSettings, DEFAULT_APP_SETTINGS, SETTINGS_PARKING_RADIUS_MAX_KM } from "@/lib/settings"
import { markMountAndIsReturning, clearReturningFlag, loadActiveMode, saveActiveMode, loadSearchRun, saveSearchRun, clearSearchRun, clearSearchInput, clearSessionSearch } from "@/lib/session-restore"
import { getCurrentPosition, getBestPosition, isGeolocationAvailable } from "@/lib/native/geolocation"
import { consumePendingNativeAction } from "@/lib/native/actions"
import { Capacitor } from "@capacitor/core"
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

// Module-scoped one-shot guard for the native LAUNCH deep link (getLaunchUrl).
// getLaunchUrl() returns the same launch URL for the whole WebView lifetime, so
// without this it would re-fire on every HomeClient remount (e.g. FAQ → back),
// overriding whatever the user navigated to since launch. Module scope (not a
// ref) so it survives remounts but resets on a genuine cold start (new WebView
// re-evaluates the module). Warm deep links via appUrlOpen are a separate,
// per-tap intent and are deliberately NOT gated by this.
let launchDeepLinkConsumed = false

interface Props {
  initialCity?:       string
  initialCategory?:   string
  initialSelectLat?:  number
  initialSelectLon?:  number
  initialSelectName?: string
  initialCountry?:    string | null
}

export default function HomeClient({ initialCity, initialCategory, initialSelectLat, initialSelectLon, initialSelectName, initialCountry }: Props) {
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
  // True once the CURRENT lastQuery completed with a result event. Gates the
  // run persistence below: only successful searches are replayable on a return
  // mount / reload — a failing query must never enter the replay loop.
  const [lastSearchOk,  setLastSearchOk] = useState(false)
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
  // Native place deep-links never populate initialSelectLat (see isPlaceDeepLink
  // above) — page.tsx's searchParams are always empty in the native shell, so
  // the check above can't detect a pending deep link at initial-state time. On
  // native, ChatPanel's own cold-start nearby auto-locate is a CHILD effect and
  // therefore flushes BEFORE this component's native-bridge effect (children's
  // passive effects always precede the parent's in the same commit) — it was
  // winning the race and firing a "locate + search everything" nearby search
  // before the async appUrlOpen/getLaunchUrl deep-link check could even run,
  // clobbering the correct place-search result. Capacitor.isNativePlatform() is
  // synchronous (no plugin round-trip), so this can gate from the very first
  // render: true on native (deferred) until the bridge effect below confirms
  // there is/isn't a pending deep link; always false on web (no change there).
  const [deferNearbyAutoLocate, setDeferNearbyAutoLocate] = useState(() => {
    try { return Capacitor.isNativePlatform() } catch { return false }
  })
  const [filterCollapsed, setFilterCollapsed] = useState(true)
  const [sortBy,        setSortBy]       = useState<"confidence" | "distance">(() => loadSettings().sortOrder)
  const [resetKey,            setResetKey]            = useState(0)
  const [scrollToId,          setScrollToId]          = useState<string | undefined>()
  // Amenity search: parking / WC as a first-class search (single-select, driven by
  // the front chips), not a hidden focus mode. `amenitySearch` is the active type
  // (null = normal venue search). `amenitySpots` holds the fetched results, shown
  // both as map markers (via the parking/toilet sources below) and as list cards.
  const [amenitySearch,       setAmenitySearch]       = useState<AmenityType | null>(null)
  // Mirror of amenitySearch readable inside handleAmenitySearch without adding it to
  // the callback's deps: lets the handler tell a fresh ENTRY into amenity mode (was
  // null) from a "search this area" refine (already active), so only the latter keeps
  // the map fixed while entry fits to the found spots.
  const amenitySearchRef = useRef<AmenityType | null>(null)
  const [amenitySpots,        setAmenitySpots]        = useState<AmenityFeature[]>([])
  // Non-null when the user ran "search this area" (panned centre) during an amenity
  // search. null = anchored at the origin coords. Drives whether the map re-fits.
  const [amenityPanned,       setAmenityPanned]       = useState<{ lat: number; lon: number } | null>(null)
  // "None found" hint for the active amenity search (empty result).
  const [amenityHint,         setAmenityHint]         = useState<string | null>(null)
  // Dedicated small-scale radius for the amenity search (parking/WC), distinct
  // from the venue radiusKm (1-50km) — sharing one radius value meant any chip
  // switch silently reverted to whatever radiusKm happened to be (finding F3/F4).
  // Seeded from the persisted parkingRadiusKm setting (mirrors the `sortBy`
  // pattern above: loadSettings() is SSR-safe and returns defaults on the
  // server, so no hydration-mismatch dance is needed for this value).
  const [amenityRadiusKm,     setAmenityRadiusKm]     = useState<number>(() => clampAmenityRadiusKm(loadSettings().parkingRadiusKm))
  // "Zur Karte" on an amenity result card: pan/zoom target for MapView, distinct
  // from selectedId/panTrigger (which only track Place markers).
  const [amenityPanTarget,    setAmenityPanTarget]    = useState<{ lat: number; lon: number } | null>(null)
  const [amenityPanTrigger,   setAmenityPanTrigger]   = useState(0)
  // Selected amenity spot (amenitySpotKey) — the single source of truth shared by
  // the result list (highlight) and the map. Mirrors `selectedId` for places.
  const [selectedAmenityKey,  setSelectedAmenityKey]  = useState<string | undefined>()
  // "Zur Karte" on a result card: highlight it + pan/zoom the map to the spot.
  const handleAmenitySelect = useCallback((spot: AmenityFeature) => {
    setSelectedAmenityKey(amenitySpotKey(spot))
    setAmenityPanTarget({ lat: spot.lat, lon: spot.lon })
    setAmenityPanTrigger((n) => n + 1)
  }, [])
  // Reverse direction: clicking a parking/WC marker on the map highlights the
  // matching list card and scrolls it into view (reusing scrollToId — amenity
  // keys and place ids never coexist). Does NOT re-pan the map: the user is
  // already looking at the marker they tapped.
  const handleAmenityMarkerSelect = useCallback((spot: { osmId?: string; lat: number; lon: number }) => {
    const key = amenitySpotKey(spot)
    setSelectedAmenityKey(key)
    setScrollToId(key)
  }, [])
  const [isFirstVisit,        setIsFirstVisit]        = useState(false)  // SSR-safe; real value read post-hydration (React #418)
  const [locateTriggerKey,    setLocateTriggerKey]    = useState(0)
  // Bumped by handleSearchHere so ChatPanel leaves nearby mode after an explicit
  // "Hier suchen" — otherwise a following chip pick re-runs at the GPS fix instead
  // of refining the panned area (viewport-origin bug).
  const [exitNearbyTriggerKey, setExitNearbyTriggerKey] = useState(0)
  const [locatePanTrigger,    setLocatePanTrigger]    = useState(0)
  // Reverse-geocoded district for the map locate button's GPS fix, resolved
  // asynchronously after handleLocate acquires coords (see handleLocate below).
  // ChatPanel uses this to populate its own nearbyPhase/location-token display —
  // the map locate button no longer runs a search itself, but the token still
  // needs a place to get its "Suche um <Bezirk>" label from. mapLocateFixKey is
  // bumped only once the district resolves (not when coords/locatePanTrigger
  // fire), so ChatPanel's effect never reads a stale/empty district.
  const [mapLocateFix,    setMapLocateFix]    = useState<{ lat: number; lon: number; district: string } | null>(null)
  const [mapLocateFixKey, setMapLocateFixKey] = useState(0)
  // ── Easter Eggs ────────────────────────────────────────────────────────────
  const [showRace,         setShowRace]         = useState(false)
  const logoTapCount  = useRef(0)
  const logoTapTimer  = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [gpsCoords,           setGpsCoords]           = useState<{ lat: number; lon: number } | null>(null)
  const gpsCoordRef  = useRef<{ lat: number; lon: number } | null>(null)
  // Live map viewport when the user has panned, reported by MapView's onViewportChange
  // (null otherwise — cold map / after a search recentres / focus mode). Held in a
  // ref, not state: it updates on every pan but is only ever read at chip-click time
  // (getViewportOrigin), so it must not trigger re-renders. Lets a category/amenity
  // chip use the visible area as its search origin (issue: map-viewport-as-origin).
  const viewportRef = useRef<ViewportOrigin | null>(null)
  // Boolean mirror of viewportRef for the UI: true while a genuine pan is pending.
  // Unlike viewportRef (read at click time), this drives a render — ChatPanel hides
  // the green "at my location" badge while panned. Toggles only on a threshold-cross
  // pan (a few times per gesture), not per pixel, so the re-render cost is negligible.
  const [mapPanned, setMapPanned] = useState(false)
  useEffect(() => { amenitySearchRef.current = amenitySearch }, [amenitySearch])
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
  // Tracks the in-flight amenity fetch so rapid chip switching aborts the previous
  // request instead of letting a stale response win setAmenitySpots.
  const amenityAbortRef = useRef<AbortController | null>(null)

  // ── Easter Egg #2: logo tap counter ────────────────────────────────────────
  function handleLogoTap() {
    logoTapCount.current += 1
    clearTimeout(logoTapTimer.current)
    if (logoTapCount.current >= 4) {
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
  // array). Only records a real search (a query or a place lookup) and only
  // AFTER it succeeded (lastSearchOk): a search that starts and fails keeps the
  // previous successful run in the store instead of poisoning it.
  useEffect(() => {
    if (!sessionPersistReadyRef.current || initialCity || isPlaceDeepLink) return
    if (!lastSearchOk) return
    const placeSearch = placeSearchName != null
    if (!lastQuery && !placeSearch) return
    saveSearchRun({
      chatMode,
      query:       lastQuery ?? "",
      coords:      lastCoords ?? null,
      nameHint:    lastNameHint ?? null,
      placeSearch,
    })
  }, [lastSearchOk, lastQuery, lastCoords, lastNameHint, placeSearchName, chatMode, initialCity, isPlaceDeepLink])

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

  const handleSearch = useCallback(async (query: string, radiusKmOverride?: number, coords?: { lat: number; lon: number }, nameHint?: string, filtersOverride?: Partial<SearchFilters>, sourcesOverride?: Partial<ActiveSources>, placeSearch?: boolean, isReplay?: boolean) => {
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
    setLastSearchOk(false)  // success-gates the run persistence (see persist effect)
    setPlaceSearchName(placeSearch ? nameHint : undefined)
    setIsLoading(true)
    setError(undefined)
    setPlaces([])
    setParkingSpots([])
    setToiletSpots([])
    setSelectedId(undefined)
    setFilterDebug(undefined)
    // A venue search exits amenity mode. But while a native quick action is
    // launching (which itself triggers a nearby auto-search in nearby-default
    // mode), suppress the reset so the about-to-be-applied amenity search survives.
    if (!quickActionActiveRef.current) {
      amenityAbortRef.current?.abort()
      setAmenitySearch(null)
      setAmenitySpots([])
      setSelectedAmenityKey(undefined)
      setAmenityPanned(null)
      setAmenityHint(null)
    }
    // Initialise per-source loading state for each active source so the
    // FilterPanel renders spinners immediately.
    const initial: Partial<Record<SourceId, SourceState>> = {}
    for (const id of Object.keys(sources) as (keyof ActiveSources)[]) {
      if (sources[id]) initial[id] = { status: "loading" }
    }
    setSourceStates(initial)

    if (settings.usageStats) incrementLocalSearchCount()

    try {
      const res = await fetch("/api/search", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ userQuery: query, radiusKm: radiusKmOverride ?? radiusKm, filters: { ...filters, ...filtersOverride }, sources: { ...sources, ...sourcesOverride }, locale, coordinates: coords, nameHint, placeSearch, international: settings.internationalMode, userId: getUserId(settings.usageStats), platform: getPlatform() }),
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
      let resultReceived = false

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
            // Known machine codes → localized message; anything else is shown
            // as-is (upstream error strings are already short and technical).
            const errText = event.error === "rate_limited"
              ? t.results.sourceRateLimited
              : event.error as string
            const update: SourceState = event.status === "ok"
              ? { status: "ok",    rawCount: event.count as number, durationMs: event.durationMs as number }
              : { status: "error", error: errText,                  durationMs: event.durationMs as number }
            setSourceStates((prev) => ({ ...prev, [sid]: update }))
          } else if (event.type === "result") {
            // Result arrived — the stream is no longer at risk of stalling.
            clearTimeout(timeoutId)
            const data = event.payload as SearchResult
            resultReceived = true
            placesReceived = data.places.length > 0
            setPlaces(data.places)
            setParkingSpots(data.parkingSpots ?? [])
            setToiletSpots(data.amenitySpots ?? [])
            setSearchCenter(data.location)
            setFilterDebug(data.filterDebug)
            track("search", { mode: chatMode, result_count: data.places.length })
            if (chatMode === "nearby") track("nearby_search", { result_count: data.places.length })
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
            const fatal = new Error(event.error as string) as Error & { code?: string }
            fatal.code = event.code as string | undefined
            throw fatal
          }
        }
      }

      // Place found by geocoding but no adapter returned data
      if (placeSearch && !placesReceived) {
        track("place_not_found", { reason: "no_data" })
        setError(t.chat.placeNoData(nameHint ?? ""))
      }
      // Mark this run as replayable ONLY once a result actually arrived (a
      // 0-hit result is still a valid, replayable search). The abort guard
      // matters: a newer search already set the flag to false for ITS run —
      // a stale success must not flip it back and persist the wrong query.
      if (resultReceived && !controller.signal.aborted) setLastSearchOk(true)
    } catch (err) {
      // Aborted by a newer search — silently bail; the newer request owns the UI
      // state. A timeout also aborts the controller, but must NOT bail silently:
      // it surfaces an error and clears loading below.
      if (controller.signal.aborted && !timedOut) return
      const fatalCode = (err as { code?: string })?.code
      setError(
        timedOut                                  ? t.chat.errorTimeout
        : fatalCode === "location_not_found"      ? t.chat.errorLocationNotFound
        : fatalCode === "geocoding_unavailable"   ? t.chat.errorGeocodingUnavailable
        : t.chat.errorGeneric,
      )
      // The run store is success-gated (persisted only when lastSearchOk flips
      // true), so a failing MANUAL query never enters it — and the previous
      // successful run stays replayable (reload after a typo replays the last
      // good search instead of nothing). The one gap gating can't cover: a run
      // that was successful at save time but fails deterministically on replay
      // (backend changed, stale pre-gating entry). Clearing on a failed REPLAY
      // closes that loop without touching manual-search failures.
      if (isReplay) clearSearchRun()
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
      // Known geocoding outcomes are expected operating conditions, not app
      // bugs — log as warning so the dev overlay doesn't trap the session in a
      // red error screen on every auto-restored search while Nominatim is
      // rate-limiting.
      if (fatalCode === "location_not_found" || fatalCode === "geocoding_unavailable") console.warn(err)
      else console.error(err)
      const e = err instanceof Error ? err : new Error(String(err))
      // Report to GlitchTip (caught here, so it would not be picked up by the
      // SDK's global handlers). A timeout is a strong signal that a source is
      // stalling server-side — tag it so it stands out from generic failures.
      // Known geocoding outcomes are expected (typos, Nominatim rate limits) —
      // don't flood the tracker with them.
      if (fatalCode !== "location_not_found" && fatalCode !== "geocoding_unavailable") {
        Sentry.captureException(e, { tags: { context: "search", reason: timedOut ? "timeout" : "error" } })
      }
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
    amenityAbortRef.current?.abort()
    setAmenitySearch(null)
    setAmenitySpots([])
    setSelectedAmenityKey(undefined)
    setAmenityPanned(null)
    setAmenityHint(null)
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
    amenityAbortRef.current?.abort()
    setAmenitySearch(null)
    setAmenitySpots([])
    setSelectedAmenityKey(undefined)
    setAmenityPanned(null)
    setAmenityHint(null)
    const dismissed = (() => { try { return !!localStorage.getItem("ap_welcome_dismissed") } catch { return false } })()
    if (!dismissed) setIsFirstVisit(true)
    setChatMode(settings.defaultSearchMode ?? "nearby")
    setSortBy(settings.sortOrder)
    setFilterCollapsed(true)
    clearSearchInput()
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

  const handleSearchHere = useCallback((coords: { lat: number; lon: number }, viewportRadiusKm: number, origin: "drag" | "locate" = "drag") => {
    // Use the viewport-derived radius so the search covers exactly what the user
    // sees, not the last user-setting radius. (Amenity "search here" is wired
    // separately via MapView's onFocusSearchHere → handleAmenitySearchHere.)
    const clampedRadius = clampVenueRadiusKm(viewportRadiusKm)
    if (origin === "locate") {
      // The pill was armed by the locate button, not a drag: this IS "near me" —
      // stay in (or enter) nearby mode so distance display and the location
      // token reflect a genuine GPS-origin search. Do NOT bump
      // exitNearbyTriggerKey here — that would reset ChatPanel's nearbyPhase
      // (and hide the token) that mapLocateFix just populated.
      setChatMode("nearby")
    } else {
      // Searching an explicitly panned area means the results are no longer "near me":
      // leave nearby mode so a subsequent chip pick refines THIS area (activeSearchCoords)
      // rather than snapping back to the still-active GPS fix.
      // setChatMode("text") runs in this same batch as handleSearch so that
      // exitNearbyTrigger's ChatPanel effect can safely skip onModeChange (and therefore
      // clearSearchState), which would otherwise wipe lastQuery after handleSearch set it.
      setExitNearbyTriggerKey((k) => k + 1)
      setChatMode("text")
    }
    track("search_here", { radius_km: Math.round(clampedRadius), origin })
    // Sync radiusKm so the header radius pill (RadiusPresetPopover, both the
    // mobile header and ResultsList's desktop header) reflects the radius that
    // was ACTUALLY searched — otherwise it silently keeps showing the pre-pan
    // value while the query underneath used the viewport-derived one. Mirrors
    // handleExpandRadius just below, the other radius-changing search path,
    // which already does this. Only set (like handleExpandRadius) when a
    // search actually fires, not unconditionally.
    if (lastQuery) {
      setRadiusKm(clampedRadius)
      handleSearch(lastQuery, clampedRadius, coords, lastNameHint)
    } else if (categoryQuery) {
      setRadiusKm(clampedRadius)
      handleSearch(categoryQuery, clampedRadius, coords)
    }
  }, [lastQuery, lastNameHint, categoryQuery, handleSearch])

  // Read the live map viewport for the chip handlers (ChatPanel.getViewportOrigin).
  // Stable identity (only reads a ref) so passing it to ChatPanel never re-renders
  // on map pans. Returns the raw report; the chip path clamps it to the venue or
  // amenity radius domain via the lib/search-ui helpers. Null when no pan is pending
  // — the cold-map gate lives in MapView (it only reports once the map is positioned).
  const getViewportOrigin = useCallback(() => viewportRef.current, [])

  const handleExpandRadius = useCallback(() => {
    if (!lastQuery) return
    const newRadius = Math.min(radiusKm * 2, RADIUS_MAX_KM)
    track("expand_radius", { from_km: radiusKm, to_km: newRadius })
    setRadiusKm(newRadius)
    handleSearch(lastQuery, newRadius, lastCoords, lastNameHint)
  }, [lastQuery, radiusKm, lastCoords, lastNameHint, handleSearch])

  const handleRadiusChange = useCallback((km: number) => {
    track("radius_change", { km })
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

  // Runs a place deep-link (selectLat/selectLon, optional selectName/cat). nameHint =
  // place name bypasses passesFilters server-side, so the linked place always appears
  // regardless of its accessibility values or the receiver's filter settings. Callers
  // are responsible for their own dedup (this is deliberately NOT gated by
  // autoSearchFiredRef — unlike the one-shot mount effects, this can legitimately run
  // more than once per app session: a warm app can receive a second, different deep
  // link later, and that tap must still search, not be silently swallowed by a
  // permanent "already fired" flag left over from the first one). Two entry points:
  // the mount-time effect below (props from page.tsx, the only route that ever
  // populates them on Android/web) and the native appUrlOpen/getLaunchUrl bridge below
  // (iOS: the remote-URL WebView never navigates to the incoming link itself, so props
  // are never populated there — this is the only path, for both cold AND warm taps).
  const runPlaceDeepLink = useCallback((lat: number, lon: number, name: string | undefined, cat: string | undefined) => {
    selectTarget.current    = { lat, lon }
    hasAutoSelected.current = false
    // Matches isPlaceDeepLink's initial chatMode ("text", never the nearby default) —
    // necessary here too since this can run well after that initial-state computation,
    // on an already-mounted app whose chatMode may currently be "nearby".
    // modeResolvedRef pins it so the async default-mode effect can't later flip a
    // native cold-start (isPlaceDeepLink=false) back to the user's "nearby" default.
    setChatMode("text")
    modeResolvedRef.current = true
    setIsFirstVisit(false)
    // Critical for native (iOS/Android): the shell loads server.url, so page.tsx never
    // receives the selectLat params and isPlaceDeepLink is false — which means the
    // usual startup suppressions don't apply and ChatPanel's cold-start nearby
    // auto-locate is running. Its GPS fix resolves seconds later and would fire a
    // nearby search that overwrites this deep-linked place. Bumping exitNearbyTrigger
    // makes ChatPanel cancel that in-flight locate (exitNearbyState → locateCancelledRef)
    // so the deep link wins. Same batch as setChatMode("text"), per the exitNearbyTrigger
    // effect's notifyParent=false contract. Harmless on web (no auto-locate in flight).
    setExitNearbyTriggerKey((k) => k + 1)
    const query = cat ? cat.replace(/_/g, " ") : (name ?? "orte")
    handleSearch(
      query,
      undefined,
      { lat, lon },
      name,
      undefined,
      { osm: true, accessibility_cloud: true, reisen_fuer_alle: true, ginto: true, acceslibre: true, google_places: true },
    )
  }, [handleSearch])

  // Auto-trigger search when arriving via a place deep-link through page.tsx's own
  // searchParams (Android App Links navigate the WebView directly, so these props are
  // populated there; iOS never populates them — see runPlaceDeepLink above).
  useEffect(() => {
    if (initialCity || !initialSelectLat || !initialSelectLon || autoSearchFiredRef.current) return
    autoSearchFiredRef.current = true
    runPlaceDeepLink(initialSelectLat, initialSelectLon, initialSelectName, initialCategory)
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
      true, // isReplay: a failed replay clears the run so reloads can't loop on it
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
    setLocatePanTrigger((k) => k + 1)
    // Reverse-geocode in the background — MapView already panned above without
    // waiting for this. Non-fatal on failure: the pill still arms via
    // locatePanTrigger regardless, just without a district for the token's label.
    try {
      const res = await fetch(`/api/geocode/reverse?lat=${coords.lat}&lon=${coords.lon}`)
      if (res.ok) {
        const data = await res.json()
        const district = data.district ?? ""
        setMapLocateFix({ lat: coords.lat, lon: coords.lon, district })
        setMapLocateFixKey((k) => k + 1)
      }
    } catch (err) {
      console.warn("[locate] reverse geocode failed", err)
    }
  }, [])

  const noneFoundFor = useCallback(
    (type: AmenityType) => type === "parking" ? t.chat.parkingNoneFound : t.chat.toiletsNoneFound,
    [t.chat.parkingNoneFound, t.chat.toiletsNoneFound],
  )

  // Amenity search: parking / WC as a first-class search. Fetches the amenity spots
  // (via the existing /api/nearby-parking endpoint) around `coords` and shows them
  // as the primary results — list cards + map markers. Replaces venue results
  // (single-select). `panned` is set when re-run via "search this area" so the map
  // The ONLY way to persist the amenity START radius (settings.parkingRadiusKm):
  // clamps to the settings slider's range so a one-off large live search (the
  // live slider goes up to 25 km) never becomes the stored default. Every
  // parkingRadiusKm writer must go through this.
  const persistParkingStartRadius = useCallback((km: number) => {
    updateSettings({ parkingRadiusKm: Math.min(km, SETTINGS_PARKING_RADIUS_MAX_KM) })
  }, [updateSettings])

  // does not re-fit. Aborts any in-flight fetch so a stale response can't win.
  const handleAmenitySearch = useCallback(async (
    type: AmenityType,
    coords?: { lat: number; lon: number },
    radiusKmOverride?: number,
    panned?: { lat: number; lon: number },
  ) => {
    const center = coords ?? gpsCoordRef.current ?? gpsCoords
    if (!center) return  // ChatPanel handles the locate-first case
    // A fresh entry into amenity mode (no amenity search active yet) should fit the
    // map to the found spots — even when reached via a panned viewport — so the user
    // sees the (≤5 km) results rather than staying on a wide, far-zoomed view with a
    // tiny cluster in the middle. Only "search this area" (already active, panned)
    // keeps the map fixed. So `panned` drives the radius write-back (below), but the
    // map-fit suppression is gated on this being a refine, not an entry.
    const wasEntry = amenitySearchRef.current === null
    amenityAbortRef.current?.abort()
    const controller = new AbortController()
    amenityAbortRef.current = controller

    markVisited()
    searchAbortRef.current?.abort()  // cancel any in-flight venue search
    setAmenitySearch(type)
    setPlaces([])
    setParkingSpots([])
    setToiletSpots([])
    setSelectedId(undefined)
    setSelectedAmenityKey(undefined)
    setPlaceSearchName(undefined)
    setError(undefined)
    setFilterDebug(undefined)
    setSourceStates({})
    setSearchCenter(center)        // enables distance display + sorting
    setAmenityPanned(wasEntry ? null : (panned ?? null))  // entry fits to spots; refine stays put
    setAmenityHint(null)
    setIsLoading(true)
    track("amenity_search", { type })

    // Falls back to the dedicated amenity radius (0.05-5km, seeded from the
    // parkingRadiusKm setting) — NOT the venue radiusKm (1-50km). Sharing the
    // venue radius meant any chip switch silently re-ran at whatever radiusKm
    // happened to be, ignoring a radius the user had just chosen (finding F4).
    // When called with BOTH an explicit radius AND a panned centre (the viewport
    // signature: viewport-origin chip or "search this area"), the radius came from
    // the map viewport — snap it and sync the slider/settings so the FilterPanel
    // reflects what was actually searched (F4). The plain chip paths (no radius, or
    // radius without panned, i.e. the FilterPanel slider commit) are untouched.
    let radius = radiusKmOverride ?? amenityRadiusKm
    if (radiusKmOverride != null && panned) {
      radius = snapAmenityRadiusKm(radiusKmOverride)
      setAmenityRadiusKm(radius)
      persistParkingStartRadius(radius)
    }
    if (settings.usageStats) incrementLocalSearchCount()
    const uid = getUserId(settings.usageStats)
    const uidParams = uid ? `&uid=${uid}&pf=${getPlatform()}` : ""
    try {
      const res = await fetch(
        `/api/nearby-parking?lat=${center.lat}&lon=${center.lon}&radius=${radius}&types=${type}${settings.internationalMode ? "&intl=1" : ""}${uidParams}`,
        { signal: controller.signal },
      )
      const spots: AmenityFeature[] = res.ok ? await res.json() : []
      if (controller.signal.aborted) return
      setAmenitySpots(spots)
      if (spots.length === 0) setAmenityHint(noneFoundFor(type))
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setAmenitySpots([])
      setAmenityHint(noneFoundFor(type))
    } finally {
      if (amenityAbortRef.current === controller) setIsLoading(false)
    }
  }, [gpsCoords, amenityRadiusKm, settings.internationalMode, noneFoundFor, persistParkingStartRadius, settings.usageStats])

  // "Search this area" during an amenity search: re-fetch the active amenity type
  // at the panned map centre. Recorded as `panned` so the map fit no longer forces
  // the origin into view. The viewport-derived radius is clamped to the amenity
  // (not venue) bounds and persisted, so the FilterPanel slider/settings stay in
  // sync with whatever radius the map pan actually searched.
  const handleAmenitySearchHere = useCallback((center: { lat: number; lon: number }, viewportRadiusKm: number) => {
    if (!amenitySearch) return
    // Snap to 0.1 km so the results-list radius reads cleanly ("0.3 km", not the
    // raw centre→corner float with 10+ decimals).
    const snapped = snapAmenityRadiusKm(viewportRadiusKm)
    setAmenityRadiusKm(snapped)
    persistParkingStartRadius(snapped)
    void handleAmenitySearch(amenitySearch, center, snapped, center)
  }, [amenitySearch, handleAmenitySearch, persistParkingStartRadius])

  // Committed from FilterPanel's amenity radius slider (fires once, on release —
  // never per drag tick, finding F3). Persists to settings.parkingRadiusKm so the
  // dedicated radius setting actually drives the search again (finding F4).
  const handleAmenityRadiusCommit = useCallback((km: number) => {
    const clamped = clampAmenityRadiusKm(km)
    setAmenityRadiusKm(clamped)
    persistParkingStartRadius(clamped)
    if (amenitySearch && searchCenter) void handleAmenitySearch(amenitySearch, searchCenter, clamped)
  }, [amenitySearch, searchCenter, handleAmenitySearch, persistParkingStartRadius])

  // Dedicated "expand radius" for the amenity empty state — always available
  // whenever an amenity search is active, independent of any leftover venue
  // `lastQuery` (finding F6a: previously this either re-ran a stale venue search
  // or never appeared at all for a first-ever amenity search).
  const handleAmenityExpandRadius = useCallback(() => {
    if (!amenitySearch || !searchCenter) return
    const next = clampAmenityRadiusKm(amenityRadiusKm * 2)
    setAmenityRadiusKm(next)
    persistParkingStartRadius(next)
    void handleAmenitySearch(amenitySearch, searchCenter, next)
  }, [amenitySearch, searchCenter, amenityRadiusKm, handleAmenitySearch, persistParkingStartRadius])

  // Leave amenity mode without running a search (e.g. tapping "Alle" while no
  // location is set, so no venue search fires to clear it).
  const handleExitAmenity = useCallback(() => {
    amenityAbortRef.current?.abort()
    setAmenitySearch(null)
    setAmenitySpots([])
    setSelectedAmenityKey(undefined)
    setAmenityPanned(null)
    setAmenityHint(null)
  }, [])

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

  // Anonymous app-open ping (top-users stats): counts users who open the app
  // even if they never run a search — the search-driven counter can't see
  // them. Deduped to once per calendar day via localStorage; visibilitychange
  // re-checks so a long-lived WebView that comes back to the foreground on a
  // later day still pings. Same uid + opt-out as the search counter. The
  // dedupe key is written before the fetch — a failed ping is lost for the
  // day rather than retried (harmless for a coarse counter, avoids bursts).
  useEffect(() => {
    function ping() {
      if (document.visibilityState === "hidden") return
      const uid = getUserId(settings.usageStats)
      if (!uid) return
      const day = new Date().toISOString().slice(0, 10)
      try {
        if (localStorage.getItem("ap_last_ping") === day) return
        localStorage.setItem("ap_last_ping", day)
      } catch { return }
      fetch("/api/ping", {
        method:    "POST",
        headers:   { "Content-Type": "application/json" },
        body:      JSON.stringify({ userId: uid, platform: getPlatform() }),
        keepalive: true,
      }).catch(() => {/* non-fatal */})
    }
    ping()
    document.addEventListener("visibilitychange", ping)
    return () => document.removeEventListener("visibilitychange", ping)
  }, [settings.usageStats])

  // Native bridges (iOS/Android shell):
  //  1. Quick Action — reads the action stored by AppDelegate
  //     (UIApplicationShortcutItem) via @capacitor/preferences. Rather than
  //     imperatively locating + toggling here (which races the ChatPanel
  //     auto-locate in nearby-default mode and loses the intent), it only sets
  //     `pendingFocusAction`; a dedicated effect below applies the focus once
  //     GPS is available. `quickActionActiveRef` keeps handleSearch from wiping
  //     the focus while the launch is in flight.
  //  2. Universal Links — since the shell loads a remote URL, an incoming
  //     place-detail link (…?selectLat=…) does NOT auto-navigate the WebView, so
  //     page.tsx's searchParams never see it on iOS. Previously this reloaded the
  //     WebView (`window.location.href = u.href`) to force page.tsx to re-read the
  //     params — reliable right after cold-launch (getLaunchUrl, JS boot still in
  //     progress) but silently a no-op on a warm relaunch (appUrlOpen firing into an
  //     already-interactive WebView/service-worker session): tapping a place link
  //     while the app was already open just foregrounded it with the previous
  //     results still showing (issue: deep link opens but doesn't search). Parsing
  //     the URL and driving runPlaceDeepLink directly — the same call the mount
  //     effect above makes from page.tsx's props — sidesteps the reload path
  //     entirely, so cold and warm now go through identical, reload-independent code.
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

    // TEMPORARY diagnostic instrumentation (remove once the deep-link bug is
    // confirmed fixed on-device) — every plain, non-deep-link cold launch also
    // takes this path (getLaunchUrl always gets polled), so this intentionally
    // fires on every native app open for now, not just deep-link taps.
    function dl(message: string, data?: Record<string, unknown>) {
      Sentry.addBreadcrumb({ category: "deeplink", message, level: "info", data })
    }
    function dlReport(outcome: string, data?: Record<string, unknown>) {
      Sentry.captureMessage(`deeplink: ${outcome}`, { level: "info", tags: { area: "deeplink", outcome }, extra: data })
    }
    dl("native bridge effect mounted")

    // Releases the deferNearbyAutoLocate gate (see the state's own comment above)
    // so ChatPanel's cold-start nearby auto-locate is allowed to run. Idempotent —
    // safe to call from multiple signals, only the first call has any effect.
    // Fires as soon as we have ANY live signal about this launch: appUrlOpen's
    // first invocation (its listener is registered before the poll even starts,
    // and its retained event is delivered near-instantly for a real deep link —
    // confirmed on-device at ~110 ms), or getLaunchUrl's very first resolution
    // (lastURL is set natively at the very start of a Universal Link cold boot,
    // well before the WebView/JS even starts loading, so the FIRST check should
    // already reflect it) — deliberately NOT the full getLaunchUrl retry-poll,
    // which can run for up to 12 s and would otherwise delay every ordinary,
    // non-deep-link cold launch's auto-locate by that much. A hard timeout is
    // the last-resort fallback so a native bridge failure can never permanently
    // block the normal nearby-search default.
    let gateOpened = false
    function openAutoLocateGate(reason: string) {
      if (gateOpened) return
      gateOpened = true
      dl("auto-locate gate opened", { reason })
      setDeferNearbyAutoLocate(false)
    }
    const gateTimeoutId = setTimeout(() => openAutoLocateGate("timeout"), 2000)

    // Only links carrying selectLat are place-detail links (matches the AASA scope);
    // everything else is ignored. `lastUrl`/`lastUrlAt` dedup getLaunchUrl vs. an
    // early appUrlOpen delivering the SAME cold-launch event within a short window —
    // but (unlike a permanent per-session flag) do NOT block a later tap of the
    // identical link, which is a completely normal warm-relaunch scenario (e.g.
    // re-testing the same email link) and must still search.
    let lastUrl: string | null = null
    let lastUrlAt = 0
    const DEDUP_WINDOW_MS = 1500
    function maybeFollowDeepLink(url: string, source: "appUrlOpen" | "launchUrl") {
      dl("maybeFollowDeepLink called", { source, url })
      const now = Date.now()
      if (url === lastUrl && now - lastUrlAt < DEDUP_WINDOW_MS) {
        dl("dedup: same URL within window, skipped", { source })
        return
      }
      lastUrl = url
      lastUrlAt = now
      try {
        const u = new URL(url)
        const latRaw = u.searchParams.get("selectLat")
        const lonRaw = u.searchParams.get("selectLon")
        if (latRaw == null || lonRaw == null) {
          dl("no selectLat/selectLon on URL — not a place link, ignored", { source })
          return
        }
        const lat = parseFloat(latRaw)
        const lon = parseFloat(lonRaw)
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          dl("selectLat/selectLon not finite numbers, ignored", { source, latRaw, lonRaw })
          return
        }
        dlReport("place_link_processed", { source, lat, lon })
        runPlaceDeepLink(lat, lon, u.searchParams.get("selectName") ?? undefined, u.searchParams.get("cat") ?? undefined)
      } catch (e) {
        dlReport("malformed_url", { source, error: String(e) })
      }
    }

    const cleanups: Array<() => void> = []
    import("@capacitor/app").then(({ App: CapApp }) => {
      if (cancelled) return
      dl("capacitor/app loaded")
      // Re-check the pending quick action whenever the app resumes (warm launch).
      // Also re-poll getLaunchUrl here: on iOS the continue-userActivity delivery
      // can lag behind our own poll window (cold-start boot reported at 6–8 s), so
      // a resume shortly after launch is a second, cheap chance to catch a launch
      // URL that settled late. launchDeepLinkConsumed still gates it to fire at
      // most once for the original launch URL.
      CapApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          checkAction()
          pollLaunchUrl()
        }
      }).then((handle) => { cleanups.push(() => handle.remove()) })

      // Universal Link arriving while/after the app is open (warm).
      CapApp.addListener("appUrlOpen", ({ url }) => {
        dl("appUrlOpen fired", { url })
        // maybeFollowDeepLink first: if this IS a place link, runPlaceDeepLink's
        // setChatMode("text") is queued synchronously before the gate opens, so
        // both land in the same React batch and ChatPanel never briefly sees
        // "nearby" once its deferred auto-locate effect finally runs.
        maybeFollowDeepLink(url, "appUrlOpen")
        openAutoLocateGate("appUrlOpen")
      }).then((handle) => { cleanups.push(() => handle.remove()) })

      // Cold launch via Universal Link. Two cold-start races make a single
      // getLaunchUrl() check unreliable on iOS: (a) appUrlOpen may have fired
      // before the listener above was attached (it sits behind the async
      // import("@capacitor/app")), and (b) getLaunchUrl() itself often returns
      // null for a while because the continue-userActivity delivery races the
      // WebView load/boot (reported cold-start duration: 6–8 s) — the URL only
      // settles later (which is why the deep link "magically" applied after
      // navigating to the FAQ and back: that remount re-ran this effect and
      // polled again). So we POLL getLaunchUrl() until it yields a URL or we
      // exhaust the retries, instead of checking once. maybeFollowDeepLink is
      // dedup'd, so overlap with a caught appUrlOpen is harmless.
      let launchTries = 0
      const LAUNCH_MAX_TRIES = 40 // 40 × 300 ms = 12 s — comfortably past the reported 6–8 s boot
      const pollLaunchUrl = () => {
        if (cancelled || launchDeepLinkConsumed) return
        const isFirstAttempt = launchTries === 0
        CapApp.getLaunchUrl().then((res) => {
          if (cancelled) return
          // Gate opens after the FIRST check regardless of outcome — see
          // openAutoLocateGate's own comment for why waiting the full retry-poll
          // would wrongly delay every ordinary cold launch's auto-locate.
          if (isFirstAttempt) openAutoLocateGate("launchUrl-first-check")
          if (launchDeepLinkConsumed) return
          if (res?.url) {
            // Launch info has settled (deep link or plain launch). Mark it
            // consumed so a later remount/resume doesn't re-fire it, then
            // process it — maybeFollowDeepLink ignores non-place URLs — and stop.
            launchDeepLinkConsumed = true
            dl("getLaunchUrl settled", { tries: launchTries, url: res.url })
            maybeFollowDeepLink(res.url, "launchUrl")
            return
          }
          if (++launchTries < LAUNCH_MAX_TRIES) {
            setTimeout(pollLaunchUrl, 300)
          } else {
            dlReport("launch_url_poll_exhausted", { tries: launchTries })
          }
        }).catch((e) => { dl("getLaunchUrl threw", { error: String(e) }) })
      }
      pollLaunchUrl()
    }).catch(() => {/* not on native */})

    return () => {
      cancelled = true
      clearTimeout(gateTimeoutId)
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
    // GPS is ready — run the requested amenity search, then release the
    // search-suppression guard. A warm-resume tap of the same shortcut simply
    // re-runs it (idempotent), so no already-active guard is needed.
    const action = pendingFocusAction
    setPendingFocusAction(null)
    void handleAmenitySearch(action, coords).finally(() => {
      quickActionActiveRef.current = false
    })
  }, [pendingFocusAction, gpsCoords, handleLocate, handleAmenitySearch])

  const amenityActive = amenitySearch !== null

  // Parking markers. During a parking search: the fetched amenitySpots (parking).
  // Otherwise the passive result-nearby parkingSpots, gated by the alwaysShowParking
  // display toggle. The weak "accessible" tier (yellow markers) is additionally
  // gated by showWeakParking in both cases, so a "find disabled parking now" view
  // never shows unreserved lots unasked.
  // Memoised so their array identity is stable across renders that don't change
  // the inputs. MapView's marker effects key off these arrays; an unstable
  // reference makes every unrelated re-render (e.g. selecting an amenity in the
  // list) tear down and rebuild all markers — which closed the popup of the very
  // marker just clicked, requiring a second click to see it.
  const parkingSource: ParkingSpot[] = useMemo(() => amenitySearch === "parking"
    ? amenitySpots.filter((s) => s.amenityType === "parking")
    : (!amenityActive && filters.alwaysShowParking ? parkingSpots : []),
    [amenitySearch, amenityActive, amenitySpots, filters.alwaysShowParking, parkingSpots])
  const visibleParkingSpots = useMemo(() => settings.showWeakParking
    ? parkingSource
    : parkingSource.filter((s) => s.tier !== "weak"),
    [settings.showWeakParking, parkingSource])

  // WC markers. During a WC search: the fetched amenitySpots (toilets). Otherwise
  // the passive map layer, gated by alwaysShowToilets. The publicToiletsOnly setting
  // is the single switch that restricts either view to standalone public WCs.
  const toiletSource: AmenityFeature[] = useMemo(() => amenitySearch === "toilet"
    ? amenitySpots.filter((s) => s.amenityType === "toilet")
    : (!amenityActive && filters.alwaysShowToilets ? toiletSpots : []),
    [amenitySearch, amenityActive, amenitySpots, filters.alwaysShowToilets, toiletSpots])
  const visibleToiletSpots = useMemo(() => settings.publicToiletsOnly
    ? toiletSource.filter((s) => s.host?.kind === "standalone")
    : toiletSource,
    [settings.publicToiletsOnly, toiletSource])

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
      // Consistent with the launch fallback (loadSettings().defaultSearchMode ?? "nearby"):
      // "no explicit preference" means auto-locate, not start-empty.
      setChatMode(patch.defaultSearchMode ?? "nearby")
    }
    if (patch.internationalMode !== undefined) {
      track("international_mode_toggle", { enabled: patch.internationalMode })
      if (patch.internationalMode === true) {
        setSources((s) => ({ ...s, google_places: true, acceslibre: true }))
      }
    }
    if (patch.usageStats === false) {
      // Opt-out: forget the anonymous ID + local counter immediately.
      clearUserStats()
    }
  }, [updateSettings])

  // ── International-search hint (access-location based) ──────────────────────
  // Tier from Vercel's edge geo header: "intl" = in the opt-in allowlist (full
  // support), "outside" = beyond it (nearby works, name search doesn't). DACH and
  // unknown → no hint. SSR-safe: dismissed defaults to true (hidden) and the
  // persisted flag is read in an effect to avoid a hydration mismatch.
  const intlTier = accessTierForCountry(initialCountry)
  const [intlHintDismissed, setIntlHintDismissed] = useState(true)
  useEffect(() => {
    try { setIntlHintDismissed(localStorage.getItem("ap_intl_hint_dismissed") === "1") } catch { /* ignore */ }
  }, [])
  const showIntlHint = !settings.internationalMode
    && (intlTier === "intl" || intlTier === "outside")
    && !intlHintDismissed

  const dismissIntlHint = useCallback((remember: boolean) => {
    setIntlHintDismissed(true)
    if (remember) { try { localStorage.setItem("ap_intl_hint_dismissed", "1") } catch { /* ignore */ } }
  }, [])

  const activateIntlFromHint = useCallback(() => {
    if (intlTier === "outside") {
      // Not in the allowlist: enable international mode + AccèsLibre, but NOT
      // Google Places (cost-conscious — name search isn't supported there anyway).
      updateSettings({ internationalMode: true })
      setSources((s) => ({ ...s, acceslibre: true }))
    } else {
      // In the allowlist: full activation (incl. Google Places) via the wrapper.
      handleUpdateSettings({ internationalMode: true })
    }
    setIntlHintDismissed(true)
    try { localStorage.setItem("ap_intl_hint_dismissed", "1") } catch { /* ignore */ }
  }, [intlTier, updateSettings, handleUpdateSettings])

  // Show the parking toggle whenever the server returned spots OR any result
  // has parking enriched from a nearby OSM node (nearbyOnly flag). Both signal
  // that disabled-parking data exists for this search area.
  const hasParkingToggle = parkingSpots.length > 0 || places.some(
    (p) => (p.accessibility.parking.details as { nearbyOnly?: boolean } | undefined)?.nearbyOnly === true,
  )

  // True when at least one source errored/timed out — gates the results-header
  // retry button so it only appears when retrying is actually useful (frees the
  // header width in the normal all-OK case).
  const hasSourceError = Object.values(sourceStates).some((s) => s?.status === "error")

  // ── Rerun / expand-radius / radius-picker wiring (findings F2/F3/F6a) ──────
  // Resolved ONCE here (not duplicated per desktop/mobile JSX branch) so both
  // layouts always agree on which search "Rerun"/"Suchradius erweitern" repeats
  // — an amenity search active never resurfaces a stale venue query, and a
  // first-ever amenity search with zero results still gets an expand action.
  const rerun = rerunTarget({ amenityActive, amenitySearch, amenitySearchCenter: searchCenter, lastQuery })
  const resolvedOnRerun = rerun === "amenity"
    ? () => { if (amenitySearch && searchCenter) handleAmenitySearch(amenitySearch, searchCenter, amenityRadiusKm) }
    : rerun === "venue"
      ? () => handleSearch(lastQuery!, undefined, lastCoords, lastNameHint)
      : undefined

  const expand = expandRadiusTarget({ amenityActive, amenitySearch, amenitySearchCenter: searchCenter, amenityRadiusKm, lastQuery, radiusKm })
  const resolvedOnExpandRadius        = expand === "venue"   ? handleExpandRadius        : undefined
  const resolvedOnAmenityExpandRadius = expand === "amenity" ? handleAmenityExpandRadius  : undefined

  const showResultsRadiusPicker = canShowResultsRadiusPicker(amenityActive)
  const resolvedOnRadiusChange  = showResultsRadiusPicker ? handleRadiusChange : undefined
  const displayedRadiusKm       = amenityActive ? amenityRadiusKm : radiusKm

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
      {showIntlHint && intlTier && (
        <IntlHintBanner tier={intlTier} onActivate={activateIntlFromHint} onClose={dismissIntlHint} />
      )}
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
        radiusKm={displayedRadiusKm}
        onFilters={handleFilters}
        onSources={setSources}
        onRadius={setRadiusKm}
        amenityRadiusKm={amenityRadiusKm}
        sourceStates={sourceStates}
        searchCenter={searchCenter}
        onSearch={(query, coords, nameHint, radiusKm) => {
          // radiusKm is set only by the viewport-origin chip path (a search of the
          // visible map area): use it as the radius AND sync the slider so the
          // FilterPanel reflects what was searched (F4). Normal searches pass no
          // radius and keep the user's current slider value untouched.
          if (radiusKm != null) setRadiusKm(snapVenueRadiusKm(radiusKm))
          handleSearch(query, radiusKm, coords, nameHint)
        }}
        onPlaceSearch={handlePlaceSearch}
        onRerun={resolvedOnRerun}
        hasSourceError={hasSourceError}
        onExpandRadius={resolvedOnExpandRadius}
        onAmenityExpandRadius={resolvedOnAmenityExpandRadius}
        onRadiusChange={resolvedOnRadiusChange}
        hasSearched={!!(lastQuery || lastNameHint)}
        error={error}
        onReset={handleReset}
        onLogoTap={handleLogoTap}
        resetKey={resetKey}
        filterDebug={filterDebug}
        initialLocation={resetKey === 0 ? initialCity : undefined}
        initialChipCat={initialCategory && resetKey === 0 ? SEO_CATEGORY_SLUGS[initialCategory] : (settings.defaultChipCat ?? undefined)}
        scrollToId={scrollToId}
        showParking={filters.alwaysShowParking}
        parkingSpotCount={parkingSpots.length > 0 ? parkingSpots.length : undefined}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        sortBy={sortBy}
        onSortChange={(s) => { track("sort_change", { order: s }); setSortBy(s); updateSettings({ sortOrder: s }) }}
        defaultMobileView={settings.defaultMobileView}
        onGpsResolved={handleGpsResolved}
        isFirstVisit={isFirstVisit}
        onResetOnboarding={() => { try { localStorage.removeItem("ap_visited"); localStorage.removeItem("ap_welcome_dismissed") } catch { /* ignore */ }; setIsFirstVisit(true) }}
        onDismissWelcome={handleDismissWelcome}
        onStartNearby={handleStartNearby}
        locateTrigger={locateTriggerKey}
        mapLocateFix={mapLocateFix}
        mapLocateFixKey={mapLocateFixKey}
        exitNearbyTrigger={exitNearbyTriggerKey}
        biasCoords={searchCenter ?? gpsCoords ?? undefined}
        onSwitchToText={() => handleSwitchMode("text")}
        chatMode={chatMode}
        deferAutoLocate={deferNearbyAutoLocate}
        onChatModeChange={handleModeChange}
        amenityActive={amenitySearch}
        onAmenitySearch={handleAmenitySearch}
        onExitAmenity={handleExitAmenity}
        amenityResults={amenitySpots}
        amenityHint={amenityHint ?? undefined}
        amenitySearchCenter={amenityPanned}
        onAmenitySearchHere={handleAmenitySearchHere}
        onAmenityRadius={handleAmenityRadiusCommit}
        onAmenitySelect={handleAmenitySelect}
        selectedAmenityKey={selectedAmenityKey}
        onAmenityMarkerClick={handleAmenityMarkerSelect}
        amenityPanTarget={amenityPanTarget}
        amenityPanTrigger={amenityPanTrigger}
        showToilets={filters.alwaysShowToilets}
        onSetMapLayers={hasParkingToggle || toiletSpots.length > 0 ? handleSetMapLayers : undefined}
        hasToiletData={toiletSpots.length > 0}
        onSearchHere={handleSearchHere}
        onLocate={isGeolocationAvailable() ? handleLocate : undefined}
        locatePanTrigger={locatePanTrigger}
        gpsCoords={gpsCoords}
        onCategoryQueryChange={setCategoryQuery}
        activeSearchCoords={lastCoords}
        getViewportOrigin={getViewportOrigin}
        onViewportChange={(v) => { viewportRef.current = v; setMapPanned(v !== null) }}
        panPending={mapPanned}
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
    {/* SplashOverlay must be the FIRST child here too (mirrors the mobile path) so
        React reconciles it by position and keeps the SAME instance across the
        isMobile flip (useIsMobile starts false → first render is this desktop path,
        then flips true pre-paint). On iOS the desktop-path render already passes the
        splash's own mobile check (innerWidth<768 + pointer:coarse) and marks the
        splash "shown" via splashAlreadyShownThisSession()'s side effect; if a skip
        link sits at index 0 instead, the flip remounts SplashOverlay and the fresh
        instance sees "already shown" → the splash never plays. The skip link stays
        the first FOCUSABLE element regardless (SplashOverlay is an aria-hidden,
        non-focusable div), so the WCAG skip-link requirement is unaffected. */}
    <SplashOverlay />
    <a
      href="#main-content"
      className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:px-4 focus-visible:py-2 focus-visible:rounded-md focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:shadow-lg"
    >
      {t.common.skipToContent}
    </a>
    {showRace && <WheelchairRace onDone={() => setShowRace(false)} />}
    {showIntlHint && intlTier && (
      <IntlHintBanner tier={intlTier} onActivate={activateIntlFromHint} onClose={dismissIntlHint} />
    )}
    <Script src="https://tally.so/widgets/embed.js" strategy="lazyOnload" />
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      {/* ── Top bar ── */}
      <header className={cn("flex items-center justify-between px-5 py-3 border-b border-border bg-card shrink-0", isFullscreen && "hidden")}>
        <div className="flex items-center gap-2.5">
          {/* Icon-only: the "tap 4×" easter egg. Split from the reset button
              below it (v9.61) — combined, every one of the taps also fired
              a search reset, which made the rapid-tap sequence unusable.
              No cursor-pointer here on purpose: the icon is a hidden easter
              egg, not a discoverable control — a hand cursor would invite
              clicking it as if it were the reset button next to it. */}
          <button
            onClick={handleLogoTap}
            className="hover:opacity-75 transition-opacity cursor-default"
            aria-label={t.app.title}
          >
            <img src="/icons/icon-preview.svg" className="w-11 h-11 rounded-xl" alt="" aria-hidden />
          </button>
          <button
            onClick={handleReset}
            className="text-left hover:opacity-75 transition-opacity cursor-pointer"
            title="Reset"
          >
            <span className="font-bold text-xl leading-none block">{t.app.title}</span>
            <p className="text-xs text-muted-foreground mt-1">{t.app.subtitle}</p>
          </button>
        </div>
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
          onSearch={(query, coords, nameHint, radiusKm) => {
          // radiusKm is set only by the viewport-origin chip path (a search of the
          // visible map area): use it as the radius AND sync the slider so the
          // FilterPanel reflects what was searched (F4). Normal searches pass no
          // radius and keep the user's current slider value untouched.
          if (radiusKm != null) setRadiusKm(snapVenueRadiusKm(radiusKm))
          handleSearch(query, radiusKm, coords, nameHint)
        }}
          onPlaceSearch={handlePlaceSearch}
          international={settings.internationalMode}
          isLoading={isLoading}
          onModeChange={handleModeChange}
          autoFocus
          initialLocation={resetKey === 0 ? initialCity : undefined}
          initialChipCat={initialCategory && resetKey === 0 ? SEO_CATEGORY_SLUGS[initialCategory] : (settings.defaultChipCat ?? undefined)}
          initialMode={chatMode}
          deferAutoLocate={deferNearbyAutoLocate}
          onGpsResolved={handleGpsResolved}
          locateTrigger={locateTriggerKey}
          mapLocateFix={mapLocateFix}
          mapLocateFixKey={mapLocateFixKey}
          exitNearbyTrigger={exitNearbyTriggerKey}
          biasCoords={searchCenter ?? gpsCoords ?? undefined}
          onAmenitySearch={handleAmenitySearch}
          amenityActive={amenitySearch}
          onExitAmenity={handleExitAmenity}
          onCategoryQueryChange={setCategoryQuery}
          activeSearchCoords={lastCoords}
          searchCenter={searchCenter}
          getViewportOrigin={getViewportOrigin}
          panPending={mapPanned}
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
                amenityRadiusKm={amenityRadiusKm}
                onAmenityRadius={handleAmenityRadiusCommit}
                sourceStates={sourceStates}
                onRerun={resolvedOnRerun}
                isLoading={isLoading}
                amenityType={amenitySearch}
                showWeakParking={settings.showWeakParking}
                publicToiletsOnly={settings.publicToiletsOnly}
                onUpdateSettings={handleUpdateSettings}
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
            onRerun={resolvedOnRerun}
            hasSourceError={hasSourceError}
            onExpandRadius={resolvedOnExpandRadius}
            onAmenityExpandRadius={resolvedOnAmenityExpandRadius}
            radiusKm={displayedRadiusKm}
            onRadiusChange={resolvedOnRadiusChange}
            hasSearched={!!(lastQuery || lastNameHint || amenityActive)}
            scrollToId={scrollToId}
            filterDebug={filterDebug}
            intlNotice={intlNotice}
            searchCenter={chatMode === "nearby" || amenityActive ? searchCenter : undefined}
            placeSearchName={placeSearchName}
            amenityType={amenitySearch}
            amenityResults={amenitySpots}
            amenityHint={amenityHint ?? undefined}
            onAmenitySelect={handleAmenitySelect}
            selectedAmenityKey={selectedAmenityKey}
            parkingSpotCount={parkingSpots.length > 0 ? parkingSpots.length : undefined}
            sortBy={sortBy}
            onSortChange={(s) => { track("sort_change", { order: s }); setSortBy(s); updateSettings({ sortOrder: s }) }}
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
            focusMode={amenityActive}
            focusSearchCenter={amenityPanned}
            onFocusSearchHere={handleAmenitySearchHere}
            showWeakParking={settings.showWeakParking}
            onSearchHere={handleSearchHere}
            onViewportChange={(v) => { viewportRef.current = v; setMapPanned(v !== null) }}
            onLocate={isGeolocationAvailable() ? handleLocate : undefined}
            locatePanTrigger={locatePanTrigger}
            searchRadiusKm={displayedRadiusKm}
            amenityPanTarget={amenityPanTarget}
            amenityPanTrigger={amenityPanTrigger}
            onAmenityMarkerClick={handleAmenityMarkerSelect}
          />
        </div>
      </main>
    </div>
    </>
  )
}
