"use client"

import { useState, useEffect } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { Map, List, SlidersHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations, useLocale } from "@/lib/i18n"
import ChatPanel       from "@/components/chat/ChatPanel"
import FilterPanel     from "@/components/filters/FilterPanel"
import ResultsList     from "@/components/results/ResultsList"
import LanguageSwitcher from "@/components/LanguageSwitcher"
import type { Place, SearchFilters, ActiveSources, SourceId, SourceState } from "@/lib/types"

const MapView = dynamic(() => import("@/components/map/MapView"), { ssr: false })

type Tab = "results" | "map" | "filter"

interface Props {
  places:        Place[]
  selectedId?:   string
  onSelect:      (place: Place) => void
  isLoading:     boolean
  filters:       SearchFilters
  sources:       ActiveSources
  radiusKm:      number
  onFilters:     (f: SearchFilters) => void
  onSources:     (s: ActiveSources) => void
  onRadius:      (r: number) => void
  sourceStates?: Partial<Record<SourceId, SourceState>>
  searchCenter?: { lat: number; lon: number }
  onSearch:      (query: string, coords?: { lat: number; lon: number }) => void
  onRerun?:         () => void
  onExpandRadius?:  () => void
  onRadiusChange?:  (km: number) => void
  hasSearched?:     boolean
  error?:           string
  onReset?:         () => void
  resetKey?:        number
}

export default function MobileLayout({
  places, selectedId, onSelect, isLoading,
  filters, sources, radiusKm, onFilters, onSources, onRadius,
  sourceStates, searchCenter, onSearch, onRerun, onExpandRadius, onRadiusChange, hasSearched, error,
  onReset, resetKey,
}: Props) {
  const [activeTab,   setActiveTab]   = useState<Tab>("results")
  const [mapMounted,  setMapMounted]  = useState(false)
  const [panTrigger,  setPanTrigger]  = useState(0)
  const [chatMode,    setChatMode]    = useState<"text" | "nearby">("text")
  const [scrollToId,  setScrollToId]  = useState<string | undefined>()

  function handleShowInResults(place: Place) {
    onSelect(place)
    setActiveTab("results")
    setScrollToId(place.id)
  }

  // All search-triggering actions switch to the results tab
  const handleSearch = (query: string, coords?: { lat: number; lon: number }) => { setActiveTab("results"); onSearch(query, coords) }
  const handleRerun = onRerun ? () => { setActiveTab("results"); onRerun() } : undefined
  const handleExpandRadius = onExpandRadius ? () => { setActiveTab("results"); onExpandRadius() } : undefined
  const t = useTranslations()
  const { locale } = useLocale()

  // Mount the map only when first activated — Leaflet must initialize in a
  // visible container, not under display:none, to measure its dimensions correctly.
  useEffect(() => {
    if (activeTab === "map") setMapMounted(true)
  }, [activeTab])

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "results", label: t.results.title ?? "Ergebnisse", icon: <List className="w-5 h-5" /> },
    { id: "map",     label: t.results.showMap ?? "Karte",     icon: <Map  className="w-5 h-5" /> },
    { id: "filter",  label: t.filters?.title  ?? "Filter",    icon: <SlidersHorizontal className="w-5 h-5" /> },
  ]

  return (
    <div className="flex flex-col h-svh overflow-hidden bg-background text-foreground">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
        <button
          onClick={onReset}
          className="flex items-center gap-2.5 hover:opacity-75 transition-opacity"
          title="Reset"
        >
          <img src="/icons/icon-preview.svg" className="w-7 h-7 rounded-lg" alt="" aria-hidden />
          <div className="text-left">
            <span className="font-bold text-sm leading-none block">{t.app.title}</span>
            <p className="text-xs text-muted-foreground mt-0.5">{t.app.subtitle}</p>
          </div>
        </button>
        <LanguageSwitcher />
      </header>

      <h1 className="sr-only">Barrierefreie Orte finden in Deutschland, Österreich und der Schweiz</h1>

      {/* ── Search bar (always visible) ── */}
      <ChatPanel key={resetKey} onSearch={handleSearch} isLoading={isLoading} onModeChange={setChatMode} />

      {/* ── Error banner ── */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm border-b border-destructive/20 shrink-0">
          {error}
        </div>
      )}

      {/* ── Tab content ── */}
      <div className="flex-1 min-h-0 overflow-hidden isolate">

        {/* Results tab */}
        <div className={cn("h-full", activeTab !== "results" && "hidden")}>
          <ResultsList
            places={places}
            filters={filters}
            selectedId={selectedId}
            onSelect={(p) => { onSelect(p); setPanTrigger((n) => n + 1); setActiveTab("map") }}
            isLoading={isLoading}
            scrollToId={scrollToId}

            onRerun={handleRerun}
            onExpandRadius={handleExpandRadius}
            radiusKm={radiusKm}
            onRadiusChange={onRadiusChange}
            hasSearched={hasSearched}
          />
        </div>

        {/* Map tab — lazy-mounted so Leaflet initializes in a visible container */}
        <div className={cn("h-full", activeTab !== "map" && "hidden")}>
          {mapMounted && (
            <MapView
              places={places}
              center={searchCenter}
              userLocation={chatMode === "nearby" ? searchCenter : undefined}
              selectedId={selectedId}
              panTrigger={panTrigger}
              onSelect={onSelect}
              onShowInResults={handleShowInResults}
              isFullscreen={false}
              onToggleFullscreen={() => {}}
              showFullscreenToggle={false}
              visible={activeTab === "map"}
            />
          )}
        </div>

        {/* Filter tab */}
        <div className={cn("h-full overflow-y-auto", activeTab !== "filter" && "hidden")}>
          <FilterPanel
            filters={filters}
            sources={sources}
            radiusKm={radiusKm}
            onFilters={onFilters}
            onSources={onSources}
            onRadius={onRadius}
            sourceStates={sourceStates}
            onRerun={chatMode === "nearby" ? handleRerun : undefined}
            isLoading={isLoading}
          />
        </div>

      </div>

      {/* ── Footer links ── */}
      <div className="flex justify-center gap-5 border-t border-border bg-card px-4 py-1.5 shrink-0">
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

      {/* ── Bottom tab bar ── */}
      <nav className="flex border-t border-border bg-card shrink-0 safe-area-inset-bottom">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 py-3 text-xs transition-colors",
              activeTab === tab.id
                ? "text-primary font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-current={activeTab === tab.id ? "page" : undefined}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </nav>

    </div>
  )
}
