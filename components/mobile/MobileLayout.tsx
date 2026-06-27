"use client"

import { useState, useEffect, useRef } from "react"
import dynamic from "next/dynamic"
import Script from "next/script"
import Link from "next/link"
import { Map, List, SlidersHorizontal, Compass, ChevronRight, LocateFixed, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations, useLocale } from "@/lib/i18n"
import { hapticLight } from "@/lib/native/haptics"
import { amenitySpotKey } from "@/lib/search-ui"
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
  onAmenityExpandRadius?: () => void
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
  amenityActive?:       AmenityType | null
  onAmenitySearch?:     (type: AmenityType, coords?: { lat: number; lon: number }) => void
  onExitAmenity?:       () => void
  amenityResults?:      AmenityFeature[]
  amenityHint?:         string
  amenitySearchCenter?: { lat: number; lon: number } | null
  onAmenitySearchHere?: (center: { lat: number; lon: number }, radiusKm: number) => void
  onAmenityRadius?:     (km: number) => void
  amenityRadiusKm?:     number
  onAmenitySelect?:     (spot: AmenityFeature) => void
  selectedAmenityKey?:  string
  onAmenityMarkerClick?: (spot: { osmId?: string; lat: number; lon: number }) => void
  amenityPanTarget?:    { lat: number; lon: number } | null
  amenityPanTrigger?:   number
  isFirstVisit?:        boolean
  onResetOnboarding?:   () => void
  onDismissWelcome?:    () => void
  onStartNearby?:       () => void
  locateTrigger?:       number
  onSwitchToText?:      () => void
  chatMode:             "text" | "nearby"
  onChatModeChange:     (mode: "text" | "nearby") => void
  biasCoords?:          { lat: number; lon: number }
  onSearchHere?:        (center: { lat: number; lon: number }, radiusKm: number) => void
  onLocate?:            () => Promise<void>
  locatePanTrigger?:    number
  gpsCoords?:           { lat: number; lon: number } | null
  onCategoryQueryChange?: (query: string) => void
  activeSearchCoords?:  { lat: number; lon: number }
  intlNotice?:          string
  placeSearchName?:     string
}

export default function MobileLayout({
  places, parkingSpots, toiletSpots, selectedId, onSelect, isLoading,
  filters, sources, radiusKm, onFilters, onSources, onRadius,
  sourceStates, searchCenter, onSearch, onPlaceSearch, onRerun, hasSourceError, onExpandRadius, onAmenityExpandRadius, onRadiusChange, hasSearched, error,
  onReset, onLogoTap, resetKey, filterDebug, initialLocation, initialChipIdx, scrollToId: externalScrollToId,
  showParking, showToilets, onSetMapLayers, hasToiletData, onToggleParking, parkingSpotCount,
  settings, onUpdateSettings, sortBy, onSortChange, defaultMobileView,
  onGpsResolved, isFirstVisit, onResetOnboarding, onDismissWelcome, onStartNearby, locateTrigger, onSwitchToText,
  chatMode, onChatModeChange, biasCoords, onSearchHere, onLocate, locatePanTrigger, gpsCoords, onCategoryQueryChange, activeSearchCoords,
  amenityActive, onAmenitySearch, onExitAmenity, amenityResults, amenityHint, amenitySearchCenter, onAmenitySearchHere, onAmenityRadius, amenityRadiusKm, intlNotice, placeSearchName,
  onAmenitySelect, selectedAmenityKey, onAmenityMarkerClick, amenityPanTarget, amenityPanTrigger,
}: Props) {
  const [activeTab,   setActiveTab]   = useState<Tab>(defaultMobileView ?? "results")
  // Focus the search input after a deliberate switch into text mode (e.g. tapping
  // the welcome screen's "enter a place or name" card) so the user can type right
  // away — mirroring the desktop autoFocus. Not set on plain app load, where an
  // auto-popped keyboard would be intrusive. Read at ChatPanel (re)mount time
  // because onSwitchToText bumps resetKey, which remounts it.
  const [autoFocusInput, setAutoFocusInput] = useState(false)
  const [mapPopupOpen,   setMapPopupOpen]   = useState(false)
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
  const handleAmenityExpandRadius = onAmenityExpandRadius ? () => { setActiveTab(defaultMobileView ?? "results"); onAmenityExpandRadius() } : undefined
  // "Zur Karte" on an amenity card: switch to the map tab (mirrors handleShowInResults
  // for places) and forward the spot so MapView pans/zooms to it.
  const handleAmenitySelect = onAmenitySelect
    ? (spot: AmenityFeature) => { onAmenitySelect(spot); setActiveTab("map") }
    : undefined
  // "Springe zu Ergebnissen" inside a parking/WC popup: mirror handleShowInResults
  // for venues — highlight the matching card and switch to the results tab.
  const handleShowAmenityInResults = onAmenityMarkerClick
    ? (spot: { osmId?: string; lat: number; lon: number }) => {
        onAmenityMarkerClick(spot)
        setActiveTab("results")
        setScrollToId(amenitySpotKey(spot))
      }
    : undefined
  const amenityActiveBool = amenityActive != null
  // An amenity chip search switches to the configured default view (its results
  // appear as list cards AND map markers), like any other search.
  const handleAmenitySearch = onAmenitySearch
    ? (type: AmenityType, coords?: { lat: number; lon: number }) => {
        setActiveTab(defaultMobileView ?? "results")
        onAmenitySearch(type, coords)
      }
    : undefined
  const t = useTranslations()
  const { locale } = useLocale()

  // Mount the map only when first activated — Leaflet must initialize in a
  // visible container, not under display:none, to measure its dimensions correctly.
  useEffect(() => {
    if (activeTab === "map") setMapMounted(true)
  }, [activeTab])

  // Switch to the map tab when an amenity search is entered programmatically (a
  // native quick action bypasses the chip-tap path's tab switch).
  const prevAmenityRef = useRef(false)
  useEffect(() => {
    if (amenityActiveBool && !prevAmenityRef.current) setActiveTab(defaultMobileView ?? "results")
    prevAmenityRef.current = amenityActiveBool
  }, [amenityActiveBool, defaultMobileView])

  const showWelcome = !!isFirstVisit && chatMode === "nearby" && !hasSearched && places.length === 0 && !isLoading

  const activeFilterCount = [filters.entrance, filters.toilet, filters.parking, filters.seating, filters.onlyVerified].filter(Boolean).length

  const resultCount = places.length

  const allTabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "results", label: t.results.title ?? "Ergebnisse", icon: <List className="w-5 h-5" /> },
    { id: "map",     label: t.results.showMap ?? "Karte",     icon: (
      <span className="relative">
        <Map className="w-5 h-5" />
        {hasSearched && !isLoading && resultCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[1.125rem] h-[1.125rem] rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none flex items-center justify-center px-1">
            {resultCount > 99 ? "99+" : resultCount}
          </span>
        )}
      </span>
    )},
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
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:px-4 focus-visible:py-2 focus-visible:rounded-md focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:shadow-lg"
      >
        {t.common.skipToContent}
      </a>

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 pb-3 pt-safe-3 border-b border-border bg-card shrink-0">
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
        <h1 className="sr-only">{t.app.srHeading}</h1>
      </header>

      {/* ── Search bar (always visible) ── */}
      <div role="search">
        <ChatPanel key={resetKey} autoFocus={autoFocusInput} onSearch={handleSearch} onPlaceSearch={onPlaceSearch} isLoading={isLoading} onModeChange={onChatModeChange} initialLocation={initialLocation} initialChipIdx={initialChipIdx} initialMode={chatMode} onGpsResolved={onGpsResolved} locateTrigger={locateTrigger} biasCoords={biasCoords} onAmenitySearch={handleAmenitySearch} amenityActive={amenityActive} onExitAmenity={onExitAmenity} onCategoryQueryChange={onCategoryQueryChange} activeSearchCoords={activeSearchCoords} searchCenter={searchCenter} international={settings.internationalMode} />
      </div>

      {/* Global search progress — covers every trigger (search here, filter, radius,
          tab switch), since the ChatPanel's button spinner isn't visible on the map tab. */}
      {isLoading && (
        <div className="h-0.5 shrink-0 overflow-hidden bg-primary/15" role="status" aria-label={t.chat.thinking}>
          <div className="h-full w-1/4 rounded-full bg-primary animate-loading-bar" />
        </div>
      )}

      {/* ── Error banner ── */}
      {error && (
        <div role="alert" className="px-4 py-2 bg-destructive/10 text-destructive text-sm border-b border-destructive/20 shrink-0">
          {error}
        </div>
      )}

      {/* ── Welcome screen (first-time nearby, no results yet) ──
           Rendered outside the overflow-hidden tab wrapper so iOS WebKit
           pointer events reach the buttons without a stacking-context dead zone. */}
      {showWelcome && (
        <main id="main-content" className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col items-center gap-3 text-center">
          <img src="/icons/icon-preview.svg" className="w-12 h-12 rounded-xl" alt="" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-semibold text-foreground">{t.chat.welcomeTitle}</p>
            <p className="text-sm text-muted-foreground">{t.chat.welcomeSubtitle}</p>
          </div>

          {/* Primary: GPS CTA */}
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
                <span className="block text-xs text-primary-foreground mt-0.5">{t.chat.welcomeNearbyCardHint}</span>
              </span>
              <ChevronRight className="w-4 h-4 shrink-0" />
            </button>
          )}

          {/* Secondary: text search alternative */}
          <div className="w-full flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{t.chat.welcomeOrDivider}</p>
            {onSwitchToText && (
              <button
                onClick={() => { setAutoFocusInput(true); onSwitchToText?.() }}
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

          {/* Detail preference: list vs map (secondary decision, visually separated) */}
          <div className="w-full border-t border-border pt-3 flex flex-col gap-2 text-left">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.chat.welcomeViewLabel}</p>
            <div className="grid grid-cols-2 gap-2">
              {(["results", "map"] as const).map((v) => {
                const isActive = (settings.defaultMobileView ?? "map") === v
                return (
                  <button
                    key={v}
                    onClick={() => { onUpdateSettings({ defaultMobileView: v }); setActiveTab(v) }}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 transition-colors text-left",
                      isActive
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:bg-muted"
                    )}
                  >
                    {v === "results" ? <List className="w-4 h-4 shrink-0 text-primary" /> : <Map className="w-4 h-4 shrink-0 text-primary" />}
                    <span className="text-sm font-medium text-foreground">
                      {v === "results" ? t.chat.welcomeViewList : t.chat.welcomeViewMap}
                    </span>
                    {isActive && <CheckCircle2 className="w-4 h-4 text-primary ml-auto shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>

          {onDismissWelcome && (
            <button
              onClick={onDismissWelcome}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
            >
              {t.chat.welcomeDismiss}
            </button>
          )}
        </main>
      )}

      {/* ── Tab content ── */}
      {!showWelcome && <main id="main-content" className="flex-1 min-h-0 overflow-hidden isolate">

        {/* Results tab */}
        <div className={cn("h-full", activeTab !== "results" && "hidden")}>
          <ResultsList
            places={places}
            filters={filters}
            selectedId={selectedId}
            onSelect={(p) => { onSelect(p); setPanTrigger((n) => n + 1); setActiveTab("map") }}
            isLoading={isLoading}
            intlNotice={intlNotice}
            placeSearchName={placeSearchName}
            scrollToId={scrollToId ?? externalScrollToId}
            onRerun={handleRerun}
            hasSourceError={hasSourceError}
            onExpandRadius={handleExpandRadius}
            onAmenityExpandRadius={handleAmenityExpandRadius}
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
            amenityType={amenityActive}
            amenityResults={amenityResults}
            amenityHint={amenityHint}
            onAmenitySelect={handleAmenitySelect}
            selectedAmenityKey={selectedAmenityKey}
          />
        </div>

        {/* Map tab — lazy-mounted so Leaflet initializes in a visible container */}
        <div className={cn("h-full relative", activeTab !== "map" && "hidden")}>
          {/* Result count pill — top-left, tapping switches to results list.
              Hidden in focus mode: it points at the (now irrelevant) venue results. */}
          {hasSearched && !isLoading && resultCount > 0 && !amenityActiveBool && (
            <button
              onClick={() => { hapticLight(); setActiveTab("results") }}
              className={cn(
                "absolute top-3 left-14 z-[1000] flex items-center gap-1.5 rounded-full bg-card/95 backdrop-blur-sm border border-border shadow-md px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors",
                mapPopupOpen && "opacity-0 pointer-events-none",
              )}
              aria-label={t.results.title}
            >
              <List className="w-3.5 h-3.5 text-primary shrink-0" />
              <span>{t.results.count(resultCount)}</span>
            </button>
          )}
          {/* Amenity count pill — same affordance during a WC/parking search, so
              the distance-sorted spot list is one tap (and one Tab-stop) away.
              The visible "N Parkplätze/WCs" text is the button's accessible name. */}
          {amenityActiveBool && !isLoading && (amenityResults?.length ?? 0) > 0 && (
            <button
              onClick={() => { hapticLight(); setActiveTab("results") }}
              className={cn(
                "absolute top-3 left-14 z-[1000] flex items-center gap-1.5 rounded-full bg-card/95 backdrop-blur-sm border border-border shadow-md px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors",
                mapPopupOpen && "opacity-0 pointer-events-none",
              )}
            >
              <List className="w-3.5 h-3.5 text-primary shrink-0" />
              <span>{t.results.amenityCount(amenityResults!.length)}</span>
            </button>
          )}
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
              focusMode={amenityActiveBool}
              focusSearchCenter={amenitySearchCenter}
              onFocusSearchHere={onAmenitySearchHere}
              showWeakParking={settings.showWeakParking}
              onSearchHere={onSearchHere}
              onLocate={onLocate}
              locatePanTrigger={locatePanTrigger}
              amenityPanTarget={amenityPanTarget}
              amenityPanTrigger={amenityPanTrigger}
              onAmenityMarkerClick={onAmenityMarkerClick}
              onShowAmenityInResults={handleShowAmenityInResults}
              amenityType={amenityActive}
              onPopupOpenChange={setMapPopupOpen}
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
            amenityRadiusKm={amenityRadiusKm}
            onAmenityRadius={onAmenityRadius}
            sourceStates={sourceStates}
            onRerun={handleRerun}
            isLoading={isLoading}
            amenityType={amenityActive}
            showWeakParking={settings.showWeakParking}
            publicToiletsOnly={settings.publicToiletsOnly}
            onUpdateSettings={onUpdateSettings}
          />
        </div>

      </main>}

      {/* ── Footer links ── */}
      <footer className="flex justify-center gap-5 border-t border-border bg-card px-4 py-1.5 shrink-0">
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
      </footer>

      {/* ── Bottom tab bar ── */}
      <nav className="flex border-t border-border bg-card shrink-0 safe-area-inset-bottom">
        {tabs.map((tab) => {
          // Amenity search shows real results (list cards + map markers), so all
          // tabs stay usable — no special gating.
          const disabled = false
          return (
            <button
              key={tab.id}
              onClick={() => { hapticLight(); setActiveTab(tab.id) }}
              disabled={disabled}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-3 text-xs transition-colors",
                disabled && "opacity-40 pointer-events-none",
                activeTab === tab.id
                  ? "text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-current={activeTab === tab.id ? "page" : undefined}
            >
              {tab.icon}
              {tab.label}
            </button>
          )
        })}
      </nav>

    </div>
    </>
  )
}
