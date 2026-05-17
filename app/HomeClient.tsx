"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import dynamic from "next/dynamic"
import Script from "next/script"
import Link from "next/link"
import ChatPanel    from "@/components/chat/ChatPanel"
import FilterPanel  from "@/components/filters/FilterPanel"
import ResultsList  from "@/components/results/ResultsList"
import LanguageSwitcher from "@/components/LanguageSwitcher"
import MobileLayout from "@/components/mobile/MobileLayout"
import { useIsMobile } from "@/hooks/useIsMobile"
import { useTranslations, useLocale } from "@/lib/i18n"
import { DEFAULT_RADIUS_KM, RADIUS_MAX_KM } from "@/lib/config"
import { SEO_CATEGORY_TO_CHIP_IDX, SEO_CATEGORY_QUERY_TERM } from "@/lib/cities"
import { haversineMetres } from "@/lib/matching/match"
import { passesFiltersForSource } from "@/lib/matching/merge"
import type { Place, SearchFilters, ActiveSources, SearchResult, SourceId, SourceState, FilterDebug } from "@/lib/types"

// Leaflet must not run on server
const MapView = dynamic(() => import("@/components/map/MapView"), { ssr: false })

const DEFAULT_FILTERS: SearchFilters = {
  entrance:      true,
  toilet:        true,
  parking:       false,
  seating:       false,
  onlyVerified:  false,
  acceptUnknown: false,
}

const DEFAULT_SOURCES: ActiveSources = {
  accessibility_cloud: true,
  osm:                 true,
  reisen_fuer_alle:    true,
  ginto:               true,
  google_places:       false,
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

  const [filters,       setFilters]      = useState<SearchFilters>(DEFAULT_FILTERS)
  const [sources,       setSources]      = useState<ActiveSources>(DEFAULT_SOURCES)
  const [radiusKm,      setRadiusKm]     = useState(DEFAULT_RADIUS_KM)
  const [places,        setPlaces]       = useState<Place[]>([])
  const [parkingSpots,        setParkingSpots]        = useState<{ lat: number; lon: number; capacity?: number }[]>([])
  const [onDemandParkingSpots, setOnDemandParkingSpots] = useState<{ lat: number; lon: number; capacity?: number }[]>([])
  const [parkingNoResults,     setParkingNoResults]     = useState<Set<string>>(new Set())
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
  const [chatMode,      setChatMode]     = useState<"text" | "nearby">("text")
  const [resetKey,      setResetKey]     = useState(0)
  const [scrollToId,    setScrollToId]   = useState<string | undefined>()
  const isDragging   = useRef(false)
  const dragStart    = useRef({ x: 0, width: 0 })
  const selectTarget = useRef(
    initialSelectLat != null && initialSelectLon != null
      ? { lat: initialSelectLat, lon: initialSelectLon }
      : null,
  )
  const hasAutoSelected = useRef(false)

  const handleSearch = useCallback(async (query: string, radiusKmOverride?: number, coords?: { lat: number; lon: number }, nameHint?: string) => {
    setLastQuery(query)
    setLastCoords(coords)
    setLastNameHint(nameHint)
    setIsLoading(true)
    setError(undefined)
    setPlaces([])
    setParkingSpots([])
    setOnDemandParkingSpots([])
    setParkingNoResults(new Set())
    setSelectedId(undefined)
    setFilterDebug(undefined)

    // Initialise per-source loading state for each active source so the
    // FilterPanel renders spinners immediately.
    const initial: Partial<Record<SourceId, SourceState>> = {}
    for (const id of Object.keys(sources) as SourceId[]) {
      if (sources[id]) initial[id] = { status: "loading" }
    }
    setSourceStates(initial)

    try {
      const res = await fetch("/api/search", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ userQuery: query, radiusKm: radiusKmOverride ?? radiusKm, filters, sources, locale, coordinates: coords, nameHint }),
      })

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? "Search failed")
      }

      // Parse NDJSON stream: one JSON object per `\n`-terminated line.
      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer    = ""

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
            setPlaces(data.places)
            setParkingSpots(data.parkingSpots ?? [])
            setSearchCenter(data.location)
            setFilterDebug(data.filterDebug)

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
              for (const sid of Object.keys(sources) as SourceId[]) {
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

  const handleReset = useCallback(() => {
    setFilters(DEFAULT_FILTERS)
    setSources(DEFAULT_SOURCES)
    setRadiusKm(DEFAULT_RADIUS_KM)
    setPlaces([])
    setParkingSpots([])
    setOnDemandParkingSpots([])
    setSelectedId(undefined)
    setLastQuery(undefined)
    setSearchCenter(undefined)
    setFilterDebug(undefined)
    setError(undefined)
    setSourceStates({})
    setChatMode("text")
    try { localStorage.removeItem("ap_last_search") } catch { /* ignore */ }
    setResetKey((k) => k + 1)
  }, [])

  const handleShowNearbyParking = useCallback(async (place: Place): Promise<boolean> => {
    const { lat, lon } = place.coordinates
    const res = await fetch(`/api/nearby-parking?lat=${lat}&lon=${lon}&radius=0.3`).catch(() => null)
    if (!res?.ok) return false
    const spots = await res.json().catch(() => [])
    if (spots.length === 0) {
      setParkingNoResults((prev) => new Set(prev).add(place.id))
      return false
    }
    setOnDemandParkingSpots(spots)
    return true
  }, [])

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
    handleSearch(`${queryTerm} in ${initialCity}`)
  // Only run once on mount — initialCity/initialCategory are stable URL-derived values
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Mobile layout
  if (isMobile) {
    return (
      <MobileLayout
        places={places}
        parkingSpots={filters.parking ? parkingSpots : onDemandParkingSpots}
        selectedId={selectedId}
        onSelect={(p) => setSelectedId(p.id)}
        isLoading={isLoading}
        filters={filters}
        sources={sources}
        radiusKm={radiusKm}
        onFilters={setFilters}
        onSources={setSources}
        onRadius={setRadiusKm}
        sourceStates={sourceStates}
        searchCenter={searchCenter}
        onSearch={(query, coords, nameHint) => handleSearch(query, undefined, coords, nameHint)}
        onRerun={lastQuery ? () => handleSearch(lastQuery, undefined, lastCoords, lastNameHint) : undefined}
        onExpandRadius={lastQuery && radiusKm < RADIUS_MAX_KM ? handleExpandRadius : undefined}
        onRadiusChange={handleRadiusChange}
        hasSearched={!!lastQuery}
        error={error}
        onReset={handleReset}
        resetKey={resetKey}
        filterDebug={filterDebug}
        initialLocation={resetKey === 0 ? initialCity : undefined}
        initialChipIdx={resetKey === 0 ? (initialCategory ? SEO_CATEGORY_TO_CHIP_IDX[initialCategory] : undefined) : undefined}
        scrollToId={scrollToId}
        onShowNearbyParking={handleShowNearbyParking}
        parkingNoResults={parkingNoResults}
      />
    )
  }

  // Fullscreen map overlay
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <MapView
          places={places}
          parkingSpots={filters.parking ? parkingSpots : onDemandParkingSpots}
          center={searchCenter}
          userLocation={chatMode === "nearby" ? searchCenter : undefined}
          selectedId={selectedId}
          onSelect={(p) => setSelectedId(p.id)}
          onShowNearbyParking={handleShowNearbyParking}
          parkingNoResultIds={parkingNoResults}
          isFullscreen
          onToggleFullscreen={() => setIsFullscreen(false)}
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
        <LanguageSwitcher />
      </header>

      <h1 className="sr-only">{t.app.srHeading}</h1>

      {/* ── Chat / search bar ── */}
      <ChatPanel
        key={resetKey}
        onSearch={(query, coords, nameHint) => handleSearch(query, undefined, coords, nameHint)}
        isLoading={isLoading}
        onModeChange={setChatMode}
        autoFocus
        initialLocation={resetKey === 0 ? initialCity : undefined}
        initialChipIdx={resetKey === 0 ? (initialCategory ? SEO_CATEGORY_TO_CHIP_IDX[initialCategory] : undefined) : undefined}
      />

      {/* ── Error banner ── */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm border-b border-destructive/20 shrink-0">
          {error}
        </div>
      )}

      {/* ── Main: filter | results | divider | map ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <FilterPanel
          filters={filters}
          sources={sources}
          radiusKm={radiusKm}
          onFilters={setFilters}
          onSources={setSources}
          onRadius={setRadiusKm}
          sourceStates={sourceStates}
          onRerun={chatMode === "nearby" && lastQuery ? () => handleSearch(lastQuery, undefined, lastCoords, lastNameHint) : undefined}
          isLoading={isLoading}
        />

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
            hasSearched={!!lastQuery}
            scrollToId={scrollToId}
            filterDebug={filterDebug}
            searchCenter={chatMode === "nearby" ? searchCenter : undefined}
            onShowNearbyParking={handleShowNearbyParking}
            parkingNoResults={parkingNoResults}
          />
          <div className="shrink-0 border-t border-border px-4 py-2 flex justify-end gap-4">
            <Link href={locale === "en" ? "/en/faq" : "/faq"} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t.faq.linkLabel}
            </Link>
            <Link href={locale === "en" ? "/en/impressum" : "/impressum"} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t.impressum.linkLabel}
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
        <div className="flex-1 min-h-0 relative">
          <MapView
            places={places}
            parkingSpots={filters.parking ? parkingSpots : onDemandParkingSpots}
            center={searchCenter}
            userLocation={chatMode === "nearby" ? searchCenter : undefined}
            selectedId={selectedId}
            onSelect={(p) => { setSelectedId(p.id); setScrollToId(p.id) }}
            onShowNearbyParking={handleShowNearbyParking}
            parkingNoResultIds={parkingNoResults}
            isFullscreen={false}
            onToggleFullscreen={() => setIsFullscreen(true)}
          />
        </div>
      </div>
    </div>
    </>
  )
}
