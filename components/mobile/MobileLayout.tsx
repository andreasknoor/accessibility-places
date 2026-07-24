"use client"

import { useState, useEffect, useRef } from "react"
import dynamic from "next/dynamic"
import Script from "next/script"
import Link from "next/link"
import { Map, List, SlidersHorizontal, Compass, ChevronRight, LocateFixed, CheckCircle2, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations, useLocale } from "@/lib/i18n"
import { hapticLight } from "@/lib/native/haptics"
import { track } from "@/lib/analytics"
import { amenitySpotKey, formatRadiusKm, headerRadiusControl, type ViewportOrigin } from "@/lib/search-ui"
import ChatPanel       from "@/components/chat/ChatPanel"
import FilterPanel     from "@/components/filters/FilterPanel"
import RadiusPresetPopover from "@/components/filters/RadiusPresetPopover"
import ResultsList     from "@/components/results/ResultsList"
import LanguageSwitcher from "@/components/LanguageSwitcher"
import SettingsSheet   from "@/components/settings/SettingsSheet"
import type { Place, SearchFilters, ActiveSources, SourceId, SourceState, FilterDebug, ParkingSpot, AmenityFeature, AmenityType, Category } from "@/lib/types"
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
  onSearch:        (query: string, coords?: { lat: number; lon: number }, nameHint?: string, radiusKm?: number) => void
  onPlaceSearch?:  (nameHint: string, coords?: { lat: number; lon: number }) => void
  // Map-viewport-as-search-origin: forwarded straight to ChatPanel / MapView.
  getViewportOrigin?:  () => ViewportOrigin | null
  onViewportChange?:   (v: ViewportOrigin | null) => void
  panPending?:         boolean
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
  initialChipCat?:      Category | null
  scrollToId?:          string
  showParking?:         boolean
  showToilets?:         boolean
  onSetMapLayers?:      (parking: boolean, toilets: boolean) => void
  hasToiletData?:       boolean
  parkingSpotCount?:    number
  settings:             AppSettings
  onUpdateSettings:     (patch: Partial<AppSettings>) => void
  sortBy:               "confidence" | "distance"
  onSortChange:         (s: "confidence" | "distance") => void
  defaultMobileView:    "results" | "map"
  onGpsResolved?:       (coords: { lat: number; lon: number }) => void
  amenityActive?:       AmenityType | null
  onAmenitySearch?:     (type: AmenityType, coords?: { lat: number; lon: number }, radiusKm?: number, panned?: { lat: number; lon: number }) => void
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
  mapLocateFix?:        { lat: number; lon: number; district: string } | null
  mapLocateFixKey?:     number
  exitNearbyTrigger?:   number
  onSwitchToText?:      () => void
  chatMode:             "text" | "nearby"
  deferAutoLocate?:     boolean
  onChatModeChange:     (mode: "text" | "nearby") => void
  biasCoords?:          { lat: number; lon: number }
  onSearchHere?:        (center: { lat: number; lon: number }, radiusKm: number, origin: "drag" | "locate") => void
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
  onReset, onLogoTap, resetKey, filterDebug, initialLocation, initialChipCat, scrollToId: externalScrollToId,
  showParking, showToilets, onSetMapLayers, hasToiletData, parkingSpotCount,
  settings, onUpdateSettings, sortBy, onSortChange, defaultMobileView,
  onGpsResolved, isFirstVisit, onResetOnboarding, onDismissWelcome, onStartNearby, locateTrigger, mapLocateFix, mapLocateFixKey, exitNearbyTrigger, onSwitchToText,
  chatMode, deferAutoLocate, onChatModeChange, biasCoords, onSearchHere, onLocate, locatePanTrigger, gpsCoords, onCategoryQueryChange, activeSearchCoords,
  amenityActive, onAmenitySearch, onExitAmenity, amenityResults, amenityHint, amenitySearchCenter, onAmenitySearchHere, onAmenityRadius, amenityRadiusKm, intlNotice, placeSearchName,
  onAmenitySelect, selectedAmenityKey, onAmenityMarkerClick, amenityPanTarget, amenityPanTrigger,
  getViewportOrigin, onViewportChange, panPending,
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
  // Single scroll-into-view request for the results list. The nonce makes a request
  // fire even when the id is unchanged: the amenity marker tap pre-sets HomeClient's
  // scrollToId (externalScrollToId) while the list is still hidden, so by the time
  // "show in results" reveals it the id no longer changes — without the nonce the
  // list never scrolled on the first call. Routing the HomeClient-driven external
  // scrolls through the same request also means a stale id can never mask them (the
  // old `local ?? external` coalescing was permanently sticky once set).
  const [scrollReq, setScrollReq] = useState<{ id: string; nonce: number }>()
  const scrollNonceRef = useRef(0)
  function requestScroll(id: string) {
    scrollNonceRef.current += 1
    setScrollReq({ id, nonce: scrollNonceRef.current })
  }
  useEffect(() => {
    if (externalScrollToId) requestScroll(externalScrollToId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalScrollToId])

  function handleShowInResults(place: Place) {
    onSelect(place)
    setActiveTab("results")
    requestScroll(place.id)
  }

  // All search-triggering actions switch to the configured default view
  const handleSearch = (query: string, coords?: { lat: number; lon: number }, nameHint?: string, radiusKm?: number) => { setActiveTab(defaultMobileView ?? "results"); onSearch(query, coords, nameHint, radiusKm) }
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
        requestScroll(amenitySpotKey(spot))
      }
    : undefined
  const amenityActiveBool = amenityActive != null
  // An amenity chip search switches to the configured default view (its results
  // appear as list cards AND map markers), like any other search.
  const handleAmenitySearch = onAmenitySearch
    ? (type: AmenityType, coords?: { lat: number; lon: number }, radiusKm?: number, panned?: { lat: number; lon: number }) => {
        setActiveTab(defaultMobileView ?? "results")
        onAmenitySearch(type, coords, radiusKm, panned)
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

  // "Search here" runner reported by MapView when the user pans away from the
  // search centre (null = no pending pan). Rendered as a pill inline next to the
  // count pill so the two never overlap on small screens.
  const [searchHereRun, setSearchHereRun] = useState<(() => void) | null>(null)

  // Badge colours invert on the active tab: once the tab itself becomes a
  // solid bg-primary block (Variante 3 tab bar), a bg-primary count badge
  // would blend straight into it — swap to an inverted (background-coloured)
  // pill so the count stays legible in both states.
  // Result count lives on "Ergebnisse" (its own tab), not "Karte" — the map
  // isn't a property of a count, and ResultsList already shows the number
  // itself; a badge on Karte was a third, misplaced copy of the same figure.
  // Both badges below sit clear of the 20px (w-5) icon's right edge
  // (-right-5, ~2px gap) rather than the typical corner-overlay offset
  // (-right-1.5), which put the digit on top of the icon glyph.
  const allTabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "results", label: t.results.title ?? "Ergebnisse", icon: (
      <span className="relative">
        <List className="w-5 h-5" />
        {hasSearched && !isLoading && resultCount > 0 && (
          <span className={cn(
            "absolute -top-1.5 -right-5 min-w-[1.125rem] h-[1.125rem] rounded-full text-[10px] font-bold leading-none flex items-center justify-center px-1",
            activeTab === "results" ? "bg-background text-primary" : "bg-primary text-primary-foreground",
          )}>
            {resultCount > 99 ? "99+" : resultCount}
          </span>
        )}
      </span>
    )},
    { id: "map",     label: t.results.showMap ?? "Karte",     icon: <Map className="w-5 h-5" /> },
    { id: "filter",  label: t.filters?.title  ?? "Filter",    icon: (
      <span className="relative">
        <SlidersHorizontal className="w-5 h-5" />
        {activeFilterCount > 0 && (
          <span className={cn(
            "absolute -top-1.5 -right-5 min-w-[1.125rem] h-[1.125rem] rounded-full text-[10px] font-bold leading-none flex items-center justify-center px-1",
            activeTab === "filter" ? "bg-background text-red-500" : "bg-red-500 text-white",
          )}>
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
        <div className="flex items-center gap-2.5">
          {/* Icon-only: the "tap 4×" easter egg. Split from the reset button
              below it (v9.61) — combined, every one of the taps also fired
              a search reset, which made the rapid-tap sequence unusable. */}
          <button
            onClick={() => onLogoTap?.()}
            className="hover:opacity-75 transition-opacity"
            aria-label={t.app.title}
          >
            <img src="/icons/icon-preview.svg" className="w-7 h-7 rounded-lg" alt="" aria-hidden />
          </button>
          <button
            onClick={() => onReset?.()}
            className="text-left hover:opacity-75 transition-opacity"
            title="Reset"
          >
            <span className="font-bold text-sm leading-none block">{t.app.title}</span>
            <p className="text-xs text-muted-foreground mt-0.5">{t.app.subtitle}</p>
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Always-visible radius control (issue: radius was only reachable via
              the Filter tab). radiusKm is already resolved by HomeClient to the
              venue-vs-amenity domain (displayedRadiusKm). Unlike ResultsList's
              picker, this one STAYS interactive during an amenity search —
              headerRadiusControl picks the matching presets + commit handler
              (onAmenityRadius), which is the same handler FilterPanel's own
              amenity slider already calls, so there's still only one source of
              truth for the value (see lib/search-ui.ts for the full reasoning). */}
          <RadiusPresetPopover
            radiusKm={radiusKm}
            {...headerRadiusControl({ amenityActive: amenityActiveBool, onRadiusChange, onAmenityRadius })}
            label={t.results.titleRadius(formatRadiusKm(radiusKm, amenityActiveBool))}
            ariaLabel={t.results.radiusPickerLabel(formatRadiusKm(radiusKm, amenityActiveBool))}
            triggerClassName="flex items-center gap-0.5 text-xs font-semibold text-primary bg-primary/10 border border-primary/20 rounded-full px-2.5 py-1 hover:bg-primary/15 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {/* Language before gear (gear rightmost) — matches Simple View's
              own Header, which already orders them this way. */}
          <LanguageSwitcher />
          <SettingsSheet settings={settings} onUpdate={onUpdateSettings} onResetOnboarding={onResetOnboarding} />
        </div>
        <h1 className="sr-only">{t.app.srHeading}</h1>
      </header>

      {/* ── Search bar (always visible) ── */}
      <div role="search">
        <ChatPanel key={resetKey} autoFocus={autoFocusInput} onSearch={handleSearch} onPlaceSearch={onPlaceSearch} isLoading={isLoading} onModeChange={onChatModeChange} initialLocation={initialLocation} initialChipCat={initialChipCat} initialMode={chatMode} deferAutoLocate={deferAutoLocate} onGpsResolved={onGpsResolved} locateTrigger={locateTrigger} mapLocateFix={mapLocateFix} mapLocateFixKey={mapLocateFixKey} exitNearbyTrigger={exitNearbyTrigger} biasCoords={biasCoords} onAmenitySearch={handleAmenitySearch} amenityActive={amenityActive} onExitAmenity={onExitAmenity} onCategoryQueryChange={onCategoryQueryChange} activeSearchCoords={activeSearchCoords} searchCenter={searchCenter} international={settings.internationalMode} getViewportOrigin={getViewportOrigin} panPending={panPending} />
      </div>

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
                    aria-pressed={isActive}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 transition-colors text-left",
                      isActive
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:bg-muted"
                    )}
                  >
                    {v === "results" ? <List className="w-4 h-4 shrink-0 text-primary" aria-hidden /> : <Map className="w-4 h-4 shrink-0 text-primary" aria-hidden />}
                    <span className="text-sm font-medium text-foreground">
                      {v === "results" ? t.chat.welcomeViewList : t.chat.welcomeViewMap}
                    </span>
                    {isActive && <CheckCircle2 className="w-4 h-4 text-primary ml-auto shrink-0" aria-hidden />}
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
            scrollToId={scrollReq?.id}
            scrollTrigger={scrollReq?.nonce}
            onRerun={handleRerun}
            hasSourceError={hasSourceError}
            onExpandRadius={handleExpandRadius}
            onAmenityExpandRadius={handleAmenityExpandRadius}
            onAdjustFilters={() => setActiveTab("filter")}
            radiusKm={radiusKm}
            onRadiusChange={onRadiusChange}
            hasSearched={hasSearched}
            filterDebug={filterDebug}
            // Distance display is origin-gated (GPS-fix searches only), matching
            // desktop's gate (HomeClient.tsx) — mobile previously passed
            // searchCenter ungated here, so any search with a resolved centre
            // (typed included) showed distance, not just genuinely nearby ones.
            searchCenter={chatMode === "nearby" || amenityActiveBool ? searchCenter : undefined}
            parkingSpotCount={parkingSpotCount}
            sortBy={sortBy}
            onSortChange={onSortChange}
            chatMode={chatMode}
            onSwitchToText={onSwitchToText}
            isFirstVisit={isFirstVisit}
            onStartNearby={onStartNearby}
            amenityType={amenityActive}
            amenityResults={amenityResults}
            amenityHint={amenityHint}
            onAmenitySelect={handleAmenitySelect}
            selectedAmenityKey={selectedAmenityKey}
          />
        </div>

        {/* Map tab — lazy-mounted so Leaflet initializes in a visible container */}
        <div className={cn("h-full relative", activeTab !== "map" && "hidden")}>
          {/* "Search here" pill, centred like the desktop MapView's own
              (MapView.tsx ~line 1252) — it used to sit left-offset (left-14)
              to leave room for the count pill that shared this row; that pill
              is gone now (see comment below), so nothing needs the space
              reserved and centring matches the desktop convention again.
              Hidden in focus mode (amenity search). */}
          {!amenityActiveBool && searchHereRun && (
            <div
              className={cn(
                "absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-1.5 transition-opacity",
                mapPopupOpen && "opacity-0 pointer-events-none",
              )}
            >
              <button
                onClick={() => { hapticLight(); searchHereRun() }}
                className="flex items-center gap-1.5 rounded-full bg-card/95 backdrop-blur-sm border border-border shadow-md px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                <Search className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden />
                <span>{t.map.searchHere}</span>
              </button>
            </div>
          )}
          {/* Amenity count pill + (when available) the focus-mode "search this
              area" pill, flowing side-by-side. Left-anchored (not centred like
              the venue-mode pill above) since this row can hold one or two
              pills and a fixed start point keeps them from jumping around as
              the second one appears/disappears (see MapView's
              hideSearchHereButton / onPanned wiring for the focus-mode side). */}
          {amenityActiveBool && ((!isLoading && (amenityResults?.length ?? 0) > 0) || searchHereRun) && (
            <div
              className={cn(
                "absolute top-3 left-14 z-[1000] flex items-center gap-1.5 transition-opacity",
                mapPopupOpen && "opacity-0 pointer-events-none",
              )}
            >
              {!isLoading && (amenityResults?.length ?? 0) > 0 && (
                <button
                  onClick={() => { hapticLight(); setActiveTab("results") }}
                  className="flex items-center gap-1.5 rounded-full bg-card/95 backdrop-blur-sm border border-border shadow-md px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                >
                  <List className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span>{t.results.amenityCount(amenityResults!.length)}</span>
                </button>
              )}
              {searchHereRun && (
                <button
                  onClick={() => { hapticLight(); searchHereRun() }}
                  className="flex items-center gap-1.5 rounded-full bg-card/95 backdrop-blur-sm border border-border shadow-md px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                >
                  <Search className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden />
                  <span>{t.map.searchHereFocus}</span>
                </button>
              )}
            </div>
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
              focusMode={amenityActiveBool}
              focusSearchCenter={amenitySearchCenter}
              onFocusSearchHere={onAmenitySearchHere}
              showWeakParking={settings.showWeakParking}
              onSearchHere={onSearchHere}
              onViewportChange={onViewportChange}
              hideSearchHereButton
              onPanned={(run) => setSearchHereRun(() => run)}
              onLocate={onLocate}
              locatePanTrigger={locatePanTrigger}
              searchRadiusKm={radiusKm}
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

      {/* ── Bottom tab bar (Variante 3, "vollflächiger Block"): the active tab
          is a solid filled button with a lifted shadow, like a pressed key;
          inactive tabs sit flat on the tray and only shade in on hover/touch.
          Strongest active/inactive contrast of three prototyped options —
          picked because it stays unambiguous without relying on colour alone. ── */}
      <nav className="flex gap-1.5 border-t border-border bg-muted shrink-0 p-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))]">
        {tabs.map((tab) => {
          // Amenity search shows real results (list cards + map markers), so all
          // tabs stay usable — no special gating.
          const disabled = false
          return (
            <button
              key={tab.id}
              onClick={() => { hapticLight(); track("tab_switch", { tab: tab.id }); setActiveTab(tab.id) }}
              disabled={disabled}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl text-xs transition-colors",
                disabled && "opacity-40 pointer-events-none",
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground font-semibold shadow-md"
                  : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
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
