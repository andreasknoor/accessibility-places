"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { track } from "@vercel/analytics"
import { SlidersHorizontal, ChevronRight, ChevronLeft } from "lucide-react"
import dynamic from "next/dynamic"
import Script from "next/script"
import Link from "next/link"
import ChatPanel    from "@/components/chat/ChatPanel"
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
import { useSettings, loadSettings } from "@/lib/settings"
import type { AppSettings } from "@/lib/settings"
import type { Place, ParkingSpot, SearchFilters, ActiveSources, SearchResult, SourceId, SourceState, FilterDebug } from "@/lib/types"

// Leaflet must not run on server
const MapView = dynamic(() => import("@/components/map/MapView"), { ssr: false })

const DEFAULT_FILTERS: SearchFilters = {
  entrance:         true,
  toilet:           true,
  parking:          false,
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

  const [filters,       setFilters]      = useState<SearchFilters>(() => loadSavedPrefs().filters)
  const [sources,       setSources]      = useState<ActiveSources>(() => loadSavedPrefs().sources)
  const [radiusKm,      setRadiusKm]     = useState<number>(() => loadSavedPrefs().radiusKm)
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
  const [chatMode,      setChatMode]     = useState<"text" | "nearby" | "place">(() => loadSettings().defaultSearchMode ?? "nearby")
  const [filterCollapsed, setFilterCollapsed] = useState(true)
  const [sortBy,        setSortBy]       = useState<"confidence" | "distance">(() => loadSettings().sortOrder)
  const [resetKey,            setResetKey]            = useState(0)
  const [scrollToId,          setScrollToId]          = useState<string | undefined>()
  const [isParkingLoading,    setIsParkingLoading]    = useState(false)
  const gpsCoordRef  = useRef<{ lat: number; lon: number } | null>(null)
  const isDragging   = useRef(false)
  const dragStart    = useRef({ x: 0, width: 0 })
  const selectTarget = useRef(
    initialSelectLat != null && initialSelectLon != null
      ? { lat: initialSelectLat, lon: initialSelectLon }
      : null,
  )
  const hasAutoSelected = useRef(false)

  // Persist filter/source/radius preferences across sessions.
  // alwaysShowParking is intentionally excluded — it's a per-session display toggle.
  useEffect(() => {
    try {
      const { alwaysShowParking: _ap, ...persistableFilters } = filters
      localStorage.setItem(PREFS_KEY, JSON.stringify({ filters: persistableFilters, sources, radiusKm }))
    } catch { /* ignore — localStorage unavailable (private mode, quota) */ }
  }, [filters, sources, radiusKm])

  const handleSearch = useCallback(async (query: string, radiusKmOverride?: number, coords?: { lat: number; lon: number }, nameHint?: string, filtersOverride?: Partial<SearchFilters>, sourcesOverride?: Partial<ActiveSources>, placeSearch?: boolean) => {
    setLastQuery(query)
    setLastCoords(coords)
    setLastNameHint(nameHint)
    setIsLoading(true)
    setError(undefined)
    setPlaces([])
    setParkingSpots([])
    setSelectedId(undefined)
    setFilterDebug(undefined)
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
      setError(t.chat.errorGeneric)
      console.error(err)
      const e = err instanceof Error ? err : new Error(String(err))
      void fetch("/api/log-error", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message: e.message, stack: e.stack, context: query }),
      }).catch(() => undefined)
    } finally {
      setIsLoading(false)
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
    setChatMode(settings.defaultSearchMode ?? "nearby")
    setSortBy(settings.sortOrder)
    setFilterCollapsed(true)
    try { localStorage.removeItem("ap_last_search") } catch { /* ignore */ }
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
        return new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
            () => resolve(null),
            { timeout: 5_000, maximumAge: 60_000 },
          )
        })
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

  const handleGpsResolved = useCallback((coords: { lat: number; lon: number }) => {
    gpsCoordRef.current = coords
  }, [])

  // Silently pre-fetch GPS when entering place-search mode so coords are
  // available immediately when the user submits (avoids mid-submit delay).
  useEffect(() => {
    if (chatMode !== "place") return
    if (gpsCoordRef.current) return
    if (!("geolocation" in navigator)) return
    navigator.geolocation.getCurrentPosition(
      (pos) => { gpsCoordRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude } },
      () => { /* silently ignored — place search has other fallbacks */ },
      { timeout: 8000, maximumAge: 60_000 },
    )
  }, [chatMode])

  const handleShowParking = useCallback(async (coords: { lat: number; lon: number }) => {
    setIsParkingLoading(true)
    setSearchCenter(coords)
    try {
      const res = await fetch(`/api/nearby-parking?lat=${coords.lat}&lon=${coords.lon}&radius=${settings.parkingRadiusKm}`)
      if (res.ok) {
        const spots = await res.json()
        setParkingSpots(spots)
        setFilters((f) => ({ ...f, alwaysShowParking: true }))
      }
    } catch { /* ignore — parking is non-fatal */ } finally {
      setIsParkingLoading(false)
    }
  }, [settings.parkingRadiusKm])

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

  const visibleParkingSpots = filters.alwaysShowParking ? parkingSpots : []

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

  // Mobile layout
  if (isMobile) {
    return (
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
        onShowParking={handleShowParking}
        onGpsResolved={handleGpsResolved}
        isParkingLoading={isParkingLoading}

        parkingRadiusKm={settings.parkingRadiusKm}
      />
    )
  }

  // Fullscreen map overlay
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <MapView
          places={places}
          parkingSpots={visibleParkingSpots}
          center={searchCenter}
          userLocation={chatMode === "nearby" ? searchCenter : undefined}
          selectedId={selectedId}
          onSelect={(p) => setSelectedId(p.id)}
          isFullscreen
          onToggleFullscreen={() => setIsFullscreen(false)}
          showParking={filters.alwaysShowParking}
          onToggleParking={hasParkingToggle ? handleToggleParking : undefined}
          autoZoom={settings.autoZoom}
        />
      </div>
    )
  }

  return (
    <>
    <Script src="https://tally.so/widgets/embed.js" strategy="lazyOnload" />
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-card shrink-0">
        <button
          onClick={handleReset}
          className="flex items-center gap-2.5 hover:opacity-75 transition-opacity cursor-pointer"
          title="Reset"
        >
          <img src="/icons/icon-preview.svg" className="w-7 h-7 rounded-lg" alt="" aria-hidden />
          <div className="text-left">
            <span className="font-bold text-base leading-none block">{t.app.title}</span>
            <p className="text-xs text-muted-foreground mt-0.5">{t.app.subtitle}</p>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <SettingsSheet settings={settings} onUpdate={handleUpdateSettings} />
          <LanguageSwitcher />
        </div>
      </header>

      <h1 className="sr-only">{t.app.srHeading}</h1>

      {/* ── Chat / search bar ── */}
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
        onShowParking={handleShowParking}
        onGpsResolved={handleGpsResolved}
        isParkingLoading={isParkingLoading}

        parkingRadiusKm={settings.parkingRadiusKm}
      />

      {/* ── Error banner ── */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm border-b border-destructive/20 shrink-0">
          {error}
        </div>
      )}

      {/* ── Main: filter | results | divider | map ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {chatMode !== "place" && (
          filterCollapsed ? (
            <button
              onClick={() => setFilterCollapsed(false)}
              className="shrink-0 w-12 border-r border-border flex flex-col items-center justify-center gap-3 py-6 hover:bg-muted/50 transition-colors cursor-pointer"
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
            <div className="relative flex flex-col shrink-0">
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
          className="shrink-0 border-r border-border flex flex-col min-h-0"
          style={{ width: resultsWidth }}
        >
          <ResultsList
            places={places}
            filters={filters}
            selectedId={selectedId}
            onSelect={(p) => setSelectedId(p.id)}
            isLoading={isLoading}
            onRerun={lastQuery ? () => handleSearch(lastQuery, undefined, lastCoords, lastNameHint) : undefined}
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
            onSwitchToPlace={chatMode === "text" ? () => handleSwitchMode("place") : undefined}
            onSwitchToText={chatMode === "place" ? () => handleSwitchMode("text") : undefined}
          />
          <div className="shrink-0 border-t border-border px-4 py-2 flex justify-end gap-4">
            <Link href={locale === "en" ? "/en/faq" : "/faq"} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t.faq.linkLabel}
            </Link>
            <Link href={locale === "en" ? "/en/impressum" : "/impressum"} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t.impressum.linkLabel}
            </Link>
            <Link href={locale === "en" ? "/en/ueber-uns" : "/ueber-uns"} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t.about.linkLabel}
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
          className="w-1.5 shrink-0 bg-border hover:bg-primary/40 cursor-col-resize transition-colors"
          onMouseDown={handleDividerMouseDown}
        />
        <div className="flex-1 min-h-0 relative isolate">
          <MapView
            places={places}
            parkingSpots={visibleParkingSpots}
            center={searchCenter}
            userLocation={chatMode === "nearby" ? searchCenter : undefined}
            selectedId={selectedId}
            onSelect={(p) => { setSelectedId(p.id); setScrollToId(p.id) }}
            isFullscreen={false}
            onToggleFullscreen={() => setIsFullscreen(true)}
            showParking={filters.alwaysShowParking}
            onToggleParking={hasParkingToggle ? handleToggleParking : undefined}
            autoZoom={settings.autoZoom}
          />
        </div>
      </div>
    </div>
    </>
  )
}
