"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import dynamic from "next/dynamic"
import ChatPanel    from "@/components/chat/ChatPanel"
import FilterPanel  from "@/components/filters/FilterPanel"
import ResultsList  from "@/components/results/ResultsList"
import LanguageSwitcher from "@/components/LanguageSwitcher"
import MobileLayout from "@/components/mobile/MobileLayout"
import { useIsMobile } from "@/hooks/useIsMobile"
import { useTranslations, useLocale } from "@/lib/i18n"
import { DEFAULT_RADIUS_KM, RADIUS_MAX_KM, APP_VERSION } from "@/lib/config"
import type { Place, SearchFilters, ActiveSources, SearchResult, SourceId, SourceState } from "@/lib/types"

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
  google_places:       true,
}

export default function Home() {
  const t        = useTranslations()
  const { locale } = useLocale()
  const isMobile = useIsMobile()

  const [filters,       setFilters]      = useState<SearchFilters>(DEFAULT_FILTERS)
  const [sources,       setSources]      = useState<ActiveSources>(DEFAULT_SOURCES)
  const [radiusKm,      setRadiusKm]     = useState(DEFAULT_RADIUS_KM)
  const [places,        setPlaces]       = useState<Place[]>([])
  const [selectedId,    setSelectedId]   = useState<string | undefined>()
  const [isLoading,     setIsLoading]    = useState(false)
  const [searchCenter,  setSearchCenter] = useState<{ lat: number; lon: number } | undefined>()
  const [showMap,       setShowMap]      = useState(true)
  const [isFullscreen,  setIsFullscreen] = useState(false)
  const [error,         setError]        = useState<string | undefined>()
  const [sourceStates,  setSourceStates] = useState<Partial<Record<SourceId, SourceState>>>({})
  const [resultsWidth,  setResultsWidth] = useState(504)
  const [lastQuery,     setLastQuery]    = useState<string | undefined>()
  const [chatMode,      setChatMode]     = useState<"text" | "nearby">("text")
  const isDragging   = useRef(false)
  const dragStart    = useRef({ x: 0, width: 0 })

  const handleSearch = useCallback(async (query: string, radiusKmOverride?: number) => {
    setLastQuery(query)
    setIsLoading(true)
    setError(undefined)
    setPlaces([])
    setSelectedId(undefined)

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
        body:    JSON.stringify({ userQuery: query, radiusKm: radiusKmOverride ?? radiusKm, filters, sources, locale }),
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

          if (event.type === "source-progress") {
            const sid = event.sourceId as SourceId
            setSourceStates((prev) => ({
              ...prev,
              [sid]: {
                ...prev[sid],
                status:  "loading",
                attempt: event.attempt as number,
                of:      event.of      as number,
              },
            }))
          } else if (event.type === "source") {
            const sid = event.sourceId as SourceId
            const update: SourceState = event.status === "ok"
              ? { status: "ok",    count: event.count as number, durationMs: event.durationMs as number }
              : { status: "error", error: event.error as string,  durationMs: event.durationMs as number }
            setSourceStates((prev) => ({ ...prev, [sid]: update }))
          } else if (event.type === "result") {
            const data = event.payload as SearchResult
            setPlaces(data.places)
            setSearchCenter(data.location)
          } else if (event.type === "fatal") {
            throw new Error(event.error as string)
          }
        }
      }
    } catch (err) {
      setError(t.chat.errorGeneric)
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [filters, sources, radiusKm, t])

  const handleExpandRadius = useCallback(() => {
    if (!lastQuery) return
    const newRadius = Math.min(radiusKm * 2, RADIUS_MAX_KM)
    setRadiusKm(newRadius)
    handleSearch(lastQuery, newRadius)
  }, [lastQuery, radiusKm, handleSearch])

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
        onSearch={handleSearch}
        onRerun={lastQuery ? () => handleSearch(lastQuery) : undefined}
        onExpandRadius={lastQuery ? handleExpandRadius : undefined}
        hasSearched={!!lastQuery}
        error={error}
      />
    )
  }

  // Fullscreen map overlay
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <MapView
          places={places}
          center={searchCenter}
          selectedId={selectedId}
          onSelect={(p) => setSelectedId(p.id)}
          isFullscreen
          onToggleFullscreen={() => setIsFullscreen(false)}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-xl" aria-hidden>♿</span>
          <div>
            <h1 className="font-bold text-base leading-none">{t.app.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t.app.subtitle} <span className="tabular-nums">(v{APP_VERSION})</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMap((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-md hover:bg-muted"
          >
            {showMap ? t.results.hideMap : t.results.showMap}
          </button>
          <LanguageSwitcher />
        </div>
      </header>

      {/* ── Chat / search bar ── */}
      <ChatPanel onSearch={handleSearch} isLoading={isLoading} onModeChange={setChatMode} />

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
          onRerun={chatMode === "nearby" && lastQuery ? () => handleSearch(lastQuery) : undefined}
          isLoading={isLoading}
        />

        <div
          className={showMap
            ? "shrink-0 border-r border-border flex flex-col min-h-0"
            : "flex-1 border-r border-border flex flex-col min-h-0"}
          style={showMap ? { width: resultsWidth } : undefined}
        >
          <ResultsList
            places={places}
            filters={filters}
            selectedId={selectedId}
            onSelect={(p) => setSelectedId(p.id)}
            isLoading={isLoading}
            onRerun={lastQuery ? () => handleSearch(lastQuery) : undefined}
            onExpandRadius={lastQuery ? handleExpandRadius : undefined}
            radiusKm={radiusKm}
            hasSearched={!!lastQuery}
          />
        </div>

        {showMap && (
          <>
            {/* Draggable divider */}
            <div
              className="w-1.5 shrink-0 bg-border hover:bg-primary/40 cursor-col-resize transition-colors"
              onMouseDown={handleDividerMouseDown}
            />
            <div className="flex-1 min-h-0 relative">
              <MapView
                places={places}
                center={searchCenter}
                selectedId={selectedId}
                onSelect={(p) => setSelectedId(p.id)}
                isFullscreen={false}
                onToggleFullscreen={() => setIsFullscreen(true)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
