"use client"

import { useState, useEffect } from "react"
import dynamic from "next/dynamic"
import Script from "next/script"
import Link from "next/link"
import { Map, List, SlidersHorizontal, Compass, ChevronRight, LocateFixed } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations, useLocale } from "@/lib/i18n"
import { hapticLight } from "@/lib/native/haptics"
import ChatPanel       from "@/components/chat/ChatPanel"
import FilterPanel     from "@/components/filters/FilterPanel"
import ResultsList     from "@/components/results/ResultsList"
import LanguageSwitcher from "@/components/LanguageSwitcher"
import SettingsSheet   from "@/components/settings/SettingsSheet"
import type { Place, SearchFilters, ActiveSources, SourceId, SourceState, FilterDebug, ParkingSpot, AmenityFeature, AmenityType } from "@/lib/types"
import type { AppSettings } from "@/lib/settings"

const MapView = dynamic(() => import("@/components/map/MapView"), { ssr: false })

type Tab = "results" | "map" | "filter"

interface Props {
  places:        Place[]
  parkingSpots?: ParkingSpot[]
  toiletSpots?:  AmenityFeature[]
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
  onSearch:        (query: string, coords?: { lat: number; lon: number }, nameHint?: string) => void
  onPlaceSearch?:  (nameHint: string, coords?: { lat: number; lon: number }) => void
  onRerun?:         () => void
  hasSourceError?:  boolean
  onExpandRadius?:  () => void
  onRadiusChange?:  (km: number) => void
  hasSearched?:     boolean
  error?:           string
  onReset?:          () => void
  onLogoTap?:        () => void
  resetKey?:         number
  filterDebug?:      FilterDebug
  initialLocation?:     string
  initialChipIdx?:      number
  scrollToId?:          string
  showParking?:         boolean
  showToilets?:         boolean
  onSetMapLayers?:      (parking: boolean, toilets: boolean) => void
  hasToiletData?:       boolean
  onToggleParking?:     () => void
  parkingSpotCount?:    number
  settings:             AppSettings
  onUpdateSettings:     (patch: Partial<AppSettings>) => void
  sortBy:               "confidence" | "distance"
  onSortChange:         (s: "confidence" | "distance") => void
  defaultMobileView:    "results" | "map"
  onGpsResolved?:       (coords: { lat: number; lon: number }) => void
  focusLayers?:         Set<AmenityType>
  onToggleFocusLayer?:  (type: AmenityType) => void
  focusLoadingLayer?:   AmenityType | null
  focusHints?:          Partial<Record<AmenityType, string>>
  isFirstVisit?:        boolean
  onResetOnboarding?:   () => void
  onDismissWelcome?:    () => void
  onStartNearby?:       () => void
  hasGpsCoords?:        boolean
  locateTrigger?:       number
  onSwitchToText?:      () => void
  chatMode:             "text" | "nearby"
  onChatModeChange:     (mode: "text" | "nearby") => void
  biasCoords?:          { lat: number; lon: number }
  onSearchHere?:        (center: { lat: number; lon: number }) => void
  onLocate?:            () => Promise<void>
  locatePanTrigger?:    number
  gpsCoords?:           { lat: number; lon: number } | null
  onCategoryQueryChange?: (query: string) => void
  activeSearchCoords?:  { lat: number; lon: number }
  intlNotice?:          string
}

export default function MobileLayout({
  places, parkingSpots, toiletSpots, selectedId, onSelect, isLoading,
  filters, sources, radiusKm, onFilters, onSources, onRadius,
  sourceStates, searchCenter, onSearch, onPlaceSearch, onRerun, hasSourceError, onExpandRadius, onRadiusChange, hasSearched, error,
  onReset, onLogoTap, resetKey, filterDebug, initialLocation, initialChipIdx, scrollToId: externalScrollToId,
  showParking, showToilets, onSetMapLayers, hasToiletData, onToggleParking, parkingSpotCount,
  settings, onUpdateSettings, sortBy, onSortChange, defaultMobileView,
  onGpsResolved, isFirstVisit, onResetOnboarding, onDismissWelcome, onStartNearby, hasGpsCoords, locateTrigger, onSwitchToText,
  chatMode, onChatModeChange, biasCoords, onSearchHere, onLocate, locatePanTrigger, gpsCoords, onCategoryQueryChange, activeSearchCoords,
  focusLayers, onToggleFocusLayer, focusLoadingLayer, focusHints, intlNotice,
}: Props) {
  const [activeTab,   setActiveTab]   = useState<Tab>(defaultMobileView ?? "results")
  const [mapMounted,  setMapMounted]  = useState(false)
  const [panTrigger,  setPanTrigger]  = useState(0)
  const [scrollToId,  setScrollToId]  = useState<string | undefined>()

  function handleShowInResults(place: Place) {
    onSelect(place)
    setActiveTab("results")
    setScrollToId(place.id)
  }

  // All search-triggering actions switch to the configured default view
  const handleSearch = (query: string, coords?: { lat: number; lon: number }, nameHint?: string) => { setActiveTab(defaultMobileView ?? "results"); onSearch(query, coords, nameHint) }
  const handleRerun = onRerun ? () => { setActiveTab(defaultMobileView ?? "results"); onRerun() } : undefined
  const handleExpandRadius = onExpandRadius ? () => { setActiveTab(defaultMobileView ?? "results"); onExpandRadius() } : undefined
  const focusActive = (focusLayers?.size ?? 0) > 0
  // When the user activates an amenity focus layer on mobile, jump to the map tab
  // so the effect is visible immediately. Turning a layer off stays on the tab.
  const handleToggleFocusLayer = onToggleFocusLayer
    ? (type: AmenityType) => {
        const wasActive = focusLayers?.has(type) ?? false
        if (!wasActive) setActiveTab("map")
        onToggleFocusLayer(type)
      }
    : undefined
  const t = useTranslations()
  const { locale } = useLocale()

  // Mount the map only when first activated — Leaflet must initialize in a
  // visible container, not under display:none, to measure its dimensions correctly.
  useEffect(() => {
    if (activeTab === "map") setMapMounted(true)
  }, [activeTab])

  const showWelcome = !!isFirstVisit && chatMode === "nearby" && !hasSearched && places.length === 0 && !isLoading

  const activeFilterCount = [filters.entrance, filters.toilet, filters.parking, filters.seating, filters.onlyVerified].filter(Boolean).length

  const allTabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "results", label: t.results.title ?? "Ergebnisse", icon: <List className="w-5 h-5" /> },
    { id: "map",     label: t.results.showMap ?? "Karte",     icon: <Map  className="w-5 h-5" /> },
    { id: "filter",  label: t.filters?.title  ?? "Filter",    icon: (
      <span className="relative">
        <SlidersHorizontal className="w-5 h-5" />
        {activeFilterCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[1.125rem] h-[1.125rem] rounded-full bg-red-500 text-white text-[10px] font-bold leading-none flex items-center justify-center px-1">
            {activeFilterCount}
          </span>
        )}
      </span>
    )},
  ]
  const tabs = allTabs

  return (
    <>
    <Script src="https://tally.so/widgets/embed.js" strategy="lazyOnload" />
    <div className="flex flex-col h-svh overflow-hidden bg-background text-foreground">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0 safe-area-inset-top">
        <button
          onClick={() => { onLogoTap?.(); onReset?.() }}
          className="flex items-center gap-2.5 hover:opacity-75 transition-opacity"
          title="Reset"
        >
          <img src="/icons/icon-preview.svg" className="w-7 h-7 rounded-lg" alt="" aria-hidden />
          <div className="text-left">
            <span className="font-bold text-sm leading-none block">{t.app.title}</span>
            <p className="text-xs text-muted-foreground mt-0.5">{t.app.subtitle}</p>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <SettingsSheet settings={settings} onUpdate={onUpdateSettings} onResetOnboarding={onResetOnboarding} />
          <LanguageSwitcher />
        </div>
      </header>

      <h1 className="sr-only">{t.app.srHeading}</h1>

      {/* ── Search bar (always visible) ── */}
      <ChatPanel key={resetKey} onSearch={handleSearch} onPlaceSearch={onPlaceSearch} isLoading={isLoading} onModeChange={onChatModeChange} initialLocation={initialLocation} initialChipIdx={initialChipIdx} initialMode={chatMode} onGpsResolved={onGpsResolved} skipAutoLocate={isFirstVisit} hasGpsCoords={hasGpsCoords} locateTrigger={locateTrigger} biasCoords={biasCoords} focusLayers={focusLayers} onToggleFocusLayer={handleToggleFocusLayer} focusLoadingLayer={focusLoadingLayer} focusHints={focusHints} onCategoryQueryChange={onCategoryQueryChange} activeSearchCoords={activeSearchCoords} international={settings.internationalMode} />

      {/* Global search progress — covers every trigger (search here, filter, radius,
          tab switch), since the ChatPanel's button spinner isn't visible on the map tab. */}
      {isLoading && (
        <div className="h-0.5 shrink-0 overflow-hidden bg-primary/15" role="status" aria-label={t.chat.thinking}>
          <div className="h-full w-1/4 rounded-full bg-primary animate-loading-bar" />
        </div>
      )}

      {/* ── Error banner ── */}
      {error && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-sm border-b border-destructive/20 shrink-0">
          {error}
        </div>
      )}

      {/* ── Welcome screen (first-time nearby, no results yet) ──
           Rendered outside the overflow-hidden tab wrapper so iOS WebKit
           pointer events reach the buttons without a stacking-context dead zone. */}
      {showWelcome && (
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col items-center gap-3 text-center">
          <img src="/icons/icon-preview.svg" className="w-12 h-12 rounded-xl" alt="" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-semibold text-foreground">{t.chat.welcomeTitle}</p>
            <p className="text-sm text-muted-foreground">{t.chat.welcomeSubtitle}</p>
          </div>
          {onStartNearby && (
            <button
              onClick={onStartNearby}
              className="w-full flex items-center gap-3 rounded-lg bg-primary text-primary-foreground px-4 py-3 shadow-sm hover:bg-primary/90 transition-colors text-left"
            >
              <span className="w-9 h-9 rounded-full bg-primary-foreground/15 flex items-center justify-center shrink-0">
                <LocateFixed className="w-4 h-4" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold">{t.chat.welcomeNearbyCard}</span>
                <span className="block text-xs text-primary-foreground/80 mt-0.5">{t.chat.welcomeNearbyCardHint}</span>
              </span>
              <ChevronRight className="w-4 h-4 shrink-0" />
            </button>
          )}
          <div className="w-full flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{t.chat.welcomeOrDivider}</p>
            {onSwitchToText && (
              <button
                onClick={onSwitchToText}
                className="w-full flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 hover:bg-muted hover:border-primary/30 transition-colors text-left group"
              >
                <span className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Compass className="w-4 h-4 text-primary" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-foreground">{t.chat.welcomeTextCard}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">{t.chat.welcomeTextCardHint}</span>
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors" />
              </button>
            )}
          </div>
          {onDismissWelcome && (
            <button
              onClick={onDismissWelcome}
              className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
            >
              {t.chat.welcomeDismiss}
            </button>
          )}
        </div>
      )}

      {/* ── Tab content ── */}
      {!showWelcome && <div className="flex-1 min-h-0 overflow-hidden isolate">

        {/* Results tab */}
        <div className={cn("h-full", activeTab !== "results" && "hidden")}>
          <ResultsList
            places={places}
            filters={filters}
            selectedId={selectedId}
            onSelect={(p) => { onSelect(p); setPanTrigger((n) => n + 1); setActiveTab("map") }}
            isLoading={isLoading}
            intlNotice={intlNotice}
            scrollToId={scrollToId ?? externalScrollToId}
            onRerun={handleRerun}
            hasSourceError={hasSourceError}
            onExpandRadius={handleExpandRadius}
            onAdjustFilters={() => setActiveTab("filter")}
            radiusKm={radiusKm}
            onRadiusChange={onRadiusChange}
            hasSearched={hasSearched}
            filterDebug={filterDebug}
            searchCenter={searchCenter}
            parkingSpotCount={parkingSpotCount}
            sortBy={sortBy}
            onSortChange={onSortChange}
            chatMode={chatMode}
            onSwitchToText={onSwitchToText}
            isFirstVisit={isFirstVisit}
          />
        </div>

        {/* Map tab — lazy-mounted so Leaflet initializes in a visible container */}
        <div className={cn("h-full", activeTab !== "map" && "hidden")}>
          {mapMounted && (
            <MapView
              places={places}
              parkingSpots={parkingSpots}
              toiletSpots={toiletSpots}
              center={searchCenter}
              userLocation={gpsCoords ?? undefined}
              selectedId={selectedId}
              panTrigger={panTrigger}
              onSelect={onSelect}
              onShowInResults={handleShowInResults}
              isFullscreen={false}
              onToggleFullscreen={() => {}}
              showFullscreenToggle={false}
              visible={activeTab === "map"}
              showParking={showParking}
              showToilets={showToilets}
              onSetMapLayers={onSetMapLayers}
              hasToiletData={hasToiletData}
              isLoading={isLoading}
              autoZoom={settings.autoZoom}
              focusMode={focusActive}
              showWeakParking={settings.showWeakParking}
              onSearchHere={onSearchHere}
              onLocate={onLocate}
              locatePanTrigger={locatePanTrigger}
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

      </div>}

      {/* ── Footer links ── */}
      <div className="flex justify-center gap-5 border-t border-border bg-card px-4 py-1.5 shrink-0">
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

      {/* ── Bottom tab bar ── */}
      <nav className="flex border-t border-border bg-card shrink-0 safe-area-inset-bottom">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { hapticLight(); setActiveTab(tab.id) }}
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
    </>
  )
}
