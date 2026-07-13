"use client"

import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { Loader2, RefreshCw, MapPin, X, ChevronRight, ArrowUpDown, SlidersHorizontal, Compass, LocateFixed } from "lucide-react"
import PlaceCard from "./PlaceCard"
import AmenityCard from "./AmenityCard"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import RadiusPresetPopover from "@/components/filters/RadiusPresetPopover"
import { haversineMetres } from "@/lib/matching/match"
import { amenitySpotKey, formatRadiusKm } from "@/lib/search-ui"
import type { Place, SearchFilters, FilterDebug, AmenityFeature, AmenityType } from "@/lib/types"

interface Props {
  places:      Place[]
  filters?:    SearchFilters
  selectedId?: string
  onSelect:    (place: Place) => void
  isLoading:   boolean

  onRerun?:         () => void
  hasSourceError?:  boolean
  onExpandRadius?:  () => void
  radiusKm?:        number
  onRadiusChange?:  (km: number) => void
  hasSearched?:     boolean
  scrollToId?:      string
  // Bumped on every explicit "show in results" so the scroll fires even when
  // scrollToId is unchanged — the amenity marker tap pre-sets scrollToId while the
  // list is still hidden, so revealing the tab alone would not re-trigger the scroll.
  scrollTrigger?:   number
  filterDebug?:         FilterDebug
  searchCenter?:        { lat: number; lon: number }
  onAdjustFilters?:     () => void
  parkingSpotCount?:    number
  sortBy?:              "confidence" | "distance"
  onSortChange?:        (s: "confidence" | "distance") => void
  chatMode?:            "text" | "nearby"
  onSwitchToText?:      () => void
  isFirstVisit?:        boolean
  onDismissWelcome?:    () => void
  onStartNearby?:       () => void
  // Shown as a thin banner above the list when the active search centre is
  // outside DACH in international mode (data coverage caveat). Undefined = hidden.
  intlNotice?:          string
  // Set to the venue name when the current results came from a specific-venue
  // lookup (place search). Shows a "Results for <name>" banner so the user knows
  // the category chips did not scope this search. Undefined for area searches.
  placeSearchName?:     string
  // Amenity search (parking / WC). When set, the list renders amenity result cards
  // (label + distance) instead of place cards; `places` is empty in this mode.
  amenityType?:         AmenityType | null
  amenityResults?:      AmenityFeature[]
  amenityHint?:         string
  // Dedicated expand-radius action for the amenity empty state — distinct from
  // onExpandRadius (which only ever re-runs the venue search) so an active
  // amenity search never resurfaces a stale venue query (finding F6a).
  onAmenityExpandRadius?: () => void
  // "Zur Karte" on an amenity result card — pans/zooms MapView to that spot
  // (mirrors onSelect for places; amenity spots have no stable Place id, so the
  // spot itself is passed instead of an id).
  onAmenitySelect?: (spot: AmenityFeature) => void
  // Currently-selected amenity spot (amenitySpotKey), controlled by HomeClient so
  // a map-marker click can highlight the matching card. Mirrors selectedId for
  // places. Scrolling reuses the shared scrollToId mechanism (amenity keys and
  // place ids never coexist).
  selectedAmenityKey?: string
}

export default function ResultsList({ places, filters, selectedId, onSelect, isLoading, onRerun, hasSourceError, onExpandRadius, radiusKm, onRadiusChange, hasSearched, scrollToId, scrollTrigger, filterDebug, searchCenter, onAdjustFilters, parkingSpotCount, sortBy: sortByProp, onSortChange, chatMode, onSwitchToText, isFirstVisit, onDismissWelcome, onStartNearby, intlNotice, placeSearchName, amenityType, amenityResults, amenityHint, onAmenityExpandRadius, onAmenitySelect, selectedAmenityKey }: Props) {
  const t = useTranslations()
  const amenityMode = amenityType != null
  const [mapHintSeen, setMapHintSeen] = useState(() =>
    typeof window !== "undefined" && !!localStorage.getItem("ap_map_hint_seen")
  )
  const [localSortBy, setLocalSortBy] = useState<"confidence" | "distance">("confidence")
  const showWelcome = !isLoading && places.length === 0 && !hasSearched && chatMode === "nearby" && isFirstVisit && !amenityMode
  const sortBy = sortByProp ?? localSortBy
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isLoading) scrollContainerRef.current?.scrollTo({ top: 0 })
  }, [isLoading])

  function handleSortToggle() {
    const next = sortBy === "confidence" ? "distance" : "confidence"
    if (sortByProp === undefined) setLocalSortBy(next)
    onSortChange?.(next)
  }

  const displayedPlaces = useMemo(() => {
    if (sortBy === "distance" && searchCenter) {
      return [...places].sort((a, b) =>
        haversineMetres(searchCenter, a.coordinates) -
        haversineMetres(searchCenter, b.coordinates)
      )
    }
    return places
  }, [places, sortBy, searchCenter])

  // Amenity results, always sorted by distance (the only meaningful order for
  // "nearest parking / toilet").
  const displayedAmenities = useMemo(() => {
    const list = amenityResults ?? []
    if (!searchCenter) return list
    return [...list].sort((a, b) =>
      haversineMetres(searchCenter, a) - haversineMetres(searchCenter, b)
    )
  }, [amenityResults, searchCenter])

  // Scroll the target entry into view *within the results scroll container*.
  // We compute scrollTop manually rather than using Element.scrollIntoView so
  // that only the list scrolls — never the page or a parent.
  //
  // We always *centre* the target rather than bailing out as soon as it is
  // merely "fully visible": amenity (parking/WC) cards never change height, and
  // distance-sorted spots cluster near the top of the list, so a tapped marker's
  // card is frequently already on-screen but jammed against an edge. An
  // early-out on full visibility left it "knapp daneben" (off-centre) and forced
  // the user to scroll by hand. A small dead-band keeps it a no-op once the entry
  // is roughly centred, so the correction passes below don't fight a smooth
  // scroll already in flight.
  const scrollTargetIntoView = useCallback((id: string, smooth: boolean) => {
    const container = scrollContainerRef.current
    const el = itemRefs.current.get(id)
    if (!container || !el) return
    const cRect = container.getBoundingClientRect()
    const eRect = el.getBoundingClientRect()
    const currentTop = eRect.top - cRect.top
    const desiredTop = Math.max(8, (container.clientHeight - eRect.height) / 2)
    const delta = currentTop - desiredTop
    if (Math.abs(delta) < 4) return // already centred — leave it
    const max = container.scrollHeight - container.clientHeight
    const top = Math.max(0, Math.min(container.scrollTop + delta, max))
    container.scrollTo({ top, behavior: smooth ? "smooth" : "auto" })
  }, [])

  useEffect(() => {
    if (!scrollToId) return
    // Double rAF: the results tab may have just switched from display:none
    // (mobile "show in results"), so one frame isn't enough for layout first.
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => scrollTargetIntoView(scrollToId, true)),
    )
    // Correction pass once layout has settled: the now-selected card can grow
    // (ring/expanded details) or images can load and shift offsets after the
    // initial scroll, leaving the entry partly out of view. Re-check and nudge
    // (instant) only if it is no longer fully visible.
    const timer = setTimeout(() => scrollTargetIntoView(scrollToId, false), 450)
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
    // scrollTrigger is in the deps so a repeated "show in results" for an id that is
    // already the current scrollToId still re-runs the scroll (see scrollTrigger prop).
  }, [scrollToId, scrollTrigger, scrollTargetIntoView])

  function handleSelect(place: Place) {
    if (!mapHintSeen) {
      localStorage.setItem("ap_map_hint_seen", "1")
      setMapHintSeen(true)
    }
    onSelect(place)
  }

  function dismissHint() {
    localStorage.setItem("ap_map_hint_seen", "1")
    setMapHintSeen(true)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Screen-reader live region: announces search progress and outcome so AT
          users learn a search ran and how many results it produced (WCAG 4.1.3). */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {isLoading
          ? t.chat.thinking
          : hasSearched
            ? (places.length > 0 ? t.results.resultsAnnounce(places.length) : t.chat.noResults)
            : ""}
      </div>
      {intlNotice && (
        <div className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-200 shrink-0">
          {intlNotice}
        </div>
      )}
      {/* Header */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            {t.results.title}
            {radiusKm !== undefined && (
              <RadiusPresetPopover
                radiusKm={radiusKm}
                onChange={onRadiusChange}
                label={t.results.titleRadius(formatRadiusKm(radiusKm))}
                ariaLabel={t.results.radiusPickerLabel(formatRadiusKm(radiusKm))}
                triggerClassName="flex items-center gap-0.5 text-xs font-normal text-muted-foreground hover:text-foreground transition-colors rounded-sm px-1 -mx-1 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            )}
            {isLoading && (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" aria-label={t.chat.thinking} />
            )}
          </h2>
          <div className="flex items-center gap-2">
            {!isLoading && amenityMode && displayedAmenities.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {t.results.amenityCount(displayedAmenities.length)}
              </span>
            )}
            {!isLoading && !amenityMode && places.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {t.results.count(places.length)}
                {parkingSpotCount != null && parkingSpotCount > 0 && (
                  <> {t.results.parkingCount(parkingSpotCount)}</>
                )}
              </span>
            )}
            {/* Retry affordance — only when a source failed/timed out. In the
                normal (all-OK) case the button is hidden so the count row has the
                full width (avoids the 2-line wrap on narrow phones). */}
            {onRerun && !isLoading && hasSourceError && (
              <button
                onClick={onRerun}
                title={t.results.retry}
                aria-label={t.results.retry}
                className="text-amber-600 hover:text-amber-700 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sort toggle bar — only when searchCenter is known and there are results */}
      {!isLoading && places.length > 0 && searchCenter && (
        <div className="px-4 py-1.5 border-b border-border shrink-0 flex items-center gap-1 text-xs">
          <ArrowUpDown className="w-3 h-3 text-muted-foreground mr-1 shrink-0" />
          <button
            type="button"
            onClick={() => { if (sortByProp === undefined) setLocalSortBy("confidence"); onSortChange?.("confidence") }}
            className={cn("px-1.5 py-0.5 rounded transition-colors cursor-pointer",
              sortBy === "confidence" ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.results.sortByConfidence}
          </button>
          <span className="text-muted-foreground">·</span>
          <button
            type="button"
            onClick={() => { if (sortByProp === undefined) setLocalSortBy("distance"); onSortChange?.("distance") }}
            className={cn("px-1.5 py-0.5 rounded transition-colors cursor-pointer",
              sortBy === "distance" ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.results.sortByDistance}
          </button>
        </div>
      )}

      {/* Place-search context banner — the chips did not scope this search */}
      {placeSearchName && places.length > 0 && !isLoading && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border-b border-border text-xs text-foreground shrink-0">
          <MapPin className="w-3 h-3 shrink-0 text-primary" />
          <span className="flex-1">{t.results.placeSearchBanner(placeSearchName)}</span>
        </div>
      )}

      {/* Option C: one-time map hint banner */}
      {hasSearched && places.length > 0 && !isLoading && !mapHintSeen && (
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/60 border-b border-border text-xs text-muted-foreground shrink-0">
          <MapPin className="w-3 h-3 shrink-0 text-primary" />
          <span className="flex-1">{t.results.mapHint}</span>
          <button
            onClick={dismissHint}
            aria-label={t.common.dismissHint}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Welcome state — rendered as a direct flex child (NOT inside overflow-y-auto)
          to avoid iOS WebKit's pointer-event dead zone in nested overflow containers */}
      {showWelcome && (
        <div className="flex-1 px-5 py-4 flex flex-col items-center gap-3 text-center">
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
                <span className="block text-xs text-primary-foreground mt-0.5">{t.chat.welcomeNearbyCardHint}</span>
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

      {/* List */}
      {/* Plain overflow-y-auto avoids Radix ScrollArea's internal display:table wrapper,
          which causes horizontal width inflation in iOS Safari when any child has
          white-space:nowrap content wider than the viewport. */}
      {!showWelcome && <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto bg-muted/40 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
        <div className="p-3 flex flex-col gap-2">
          {isLoading && (
            <div className="flex flex-col gap-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-36 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          )}

          {!isLoading && !amenityMode && places.length === 0 && !hasSearched && chatMode !== "nearby" && (
            <div className="flex flex-col items-center gap-4 py-14 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <MapPin className="w-8 h-8 text-muted-foreground" />
              </div>
              <div className="flex flex-col gap-2">
                <p className="font-semibold text-foreground">{t.chat.noSearchYetTitle}</p>
                <p className="text-sm text-muted-foreground">{t.chat.noSearchYet}</p>
              </div>
              {onStartNearby && (
                <button
                  onClick={onStartNearby}
                  className="w-full max-w-xs flex items-center gap-3 rounded-lg bg-primary text-primary-foreground px-4 py-3 shadow-sm hover:bg-primary/90 transition-colors text-left"
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
            </div>
          )}

          {!isLoading && !amenityMode && places.length === 0 && hasSearched && (
            <div className="flex flex-col items-center gap-3 py-8 px-4">
              {filterDebug && filterDebug.total > 0 ? (
                <>
                  <p className="text-sm text-muted-foreground text-center">
                    {t.results.noResultsFiltered(filterDebug.total)}
                  </p>
                  {(() => {
                    const top = Object.entries(filterDebug.failedBy)
                      .filter(([, count]) => count > 0)
                      .sort(([, a], [, b]) => b - a)[0]
                    if (!top) return null
                    const [key] = top
                    const label = t.filters.criteriaItems[key as keyof typeof t.filters.criteriaItems]
                    return (
                      <p className="text-xs text-muted-foreground text-center">
                        {t.results.filterBlockedBy} <strong className="text-foreground">{label}</strong>
                      </p>
                    )
                  })()}
                </>
              ) : (
                <p className="text-sm text-muted-foreground text-center">
                  {filterDebug ? t.results.noResultsArea : t.chat.noResults}
                </p>
              )}
              <div className="flex flex-wrap justify-center gap-2 mt-1">
                {onExpandRadius && (
                  <button
                    onClick={onExpandRadius}
                    className="px-3 py-1.5 rounded-md border border-border bg-card text-sm font-medium
                               hover:bg-muted transition-colors"
                  >
                    {t.results.expandRadius}
                  </button>
                )}
                {onAdjustFilters ? (
                  <button
                    onClick={onAdjustFilters}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary
                               text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    {t.results.adjustFilters}
                  </button>
                ) : (
                  <p className="w-full text-center text-xs text-muted-foreground mt-1">
                    {t.results.adjustFiltersHint}
                  </p>
                )}
              </div>
            </div>
          )}

          {!isLoading && !amenityMode && displayedPlaces.map((place) => (
            <div
              key={place.id}
              ref={(el) => { if (el) itemRefs.current.set(place.id, el); else itemRefs.current.delete(place.id) }}
            >
              <PlaceCard
                place={place}
                isSelected={place.id === selectedId}
                onClick={() => handleSelect(place)}
                distanceM={searchCenter ? haversineMetres(searchCenter, place.coordinates) : undefined}
                />
            </div>
          ))}

          {/* Amenity (parking / WC) results — simple distance-sorted cards */}
          {!isLoading && amenityMode && displayedAmenities.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 px-4">
              <p className="text-sm text-muted-foreground text-center">
                {amenityHint ?? t.chat.noResults}
              </p>
              {onAmenityExpandRadius && (
                <button
                  onClick={onAmenityExpandRadius}
                  className="px-3 py-1.5 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted transition-colors"
                >
                  {t.results.expandRadius}
                </button>
              )}
            </div>
          )}

          {!isLoading && amenityMode && displayedAmenities.map((spot, i) => {
            // Render key may need the index to stay unique; the selection/scroll
            // key must NOT (the map marker has no list index) — see amenitySpotKey.
            const renderKey = spot.osmId ?? `${spot.lat},${spot.lon}-${i}`
            const selKey = amenitySpotKey(spot)
            // Only show the egocentric "X m entfernt" label when the search origin is
            // the user's GPS position (nearby mode). For text/panned amenity searches
            // the centre is the map/search location, not the user, so "entfernt" would
            // be misleading — the list stays distance-sorted (displayedAmenities), just
            // without the per-card label.
            const distanceM = chatMode === "nearby" && searchCenter ? haversineMetres(searchCenter, spot) : undefined
            return (
              <div
                key={renderKey}
                ref={(el) => { if (el) itemRefs.current.set(selKey, el); else itemRefs.current.delete(selKey) }}
              >
                <AmenityCard
                  spot={spot}
                  amenityType={amenityType}
                  isSelected={selKey === selectedAmenityKey}
                  distanceM={distanceM}
                  onClick={onAmenitySelect ? () => onAmenitySelect(spot) : undefined}
                />
              </div>
            )
          })}
        </div>
      </div>}
    </div>
  )
}
