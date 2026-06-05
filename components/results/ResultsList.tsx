"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { Loader2, RefreshCw, MapPin, Building2, X, ChevronDown, ChevronRight, ArrowUpDown, SlidersHorizontal, Compass, LocateFixed } from "lucide-react"
import PlaceCard from "./PlaceCard"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from "@/components/ui/popover"
import { haversineMetres } from "@/lib/matching/match"
import type { Place, SearchFilters, FilterDebug } from "@/lib/types"

const RADIUS_PRESETS_KM = [1, 2, 5, 10, 25, 50] as const

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
  filterDebug?:         FilterDebug
  searchCenter?:        { lat: number; lon: number }
  onAdjustFilters?:     () => void
  parkingSpotCount?:    number
  sortBy?:              "confidence" | "distance"
  onSortChange?:        (s: "confidence" | "distance") => void
  chatMode?:            "text" | "nearby" | "place"
  onSwitchToPlace?:     () => void
  onSwitchToText?:      () => void
  isFirstVisit?:        boolean
  onDismissWelcome?:    () => void
}

export default function ResultsList({ places, filters, selectedId, onSelect, isLoading, onRerun, hasSourceError, onExpandRadius, radiusKm, onRadiusChange, hasSearched, scrollToId, filterDebug, searchCenter, onAdjustFilters, parkingSpotCount, sortBy: sortByProp, onSortChange, chatMode, onSwitchToPlace, onSwitchToText, isFirstVisit, onDismissWelcome }: Props) {
  const t = useTranslations()
  const [mapHintSeen, setMapHintSeen] = useState(() =>
    typeof window !== "undefined" && !!localStorage.getItem("ap_map_hint_seen")
  )
  const [localSortBy, setLocalSortBy] = useState<"confidence" | "distance">("confidence")
  const showWelcome = !isLoading && places.length === 0 && !hasSearched && chatMode === "nearby" && isFirstVisit
  const sortBy = sortByProp ?? localSortBy
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map())

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

  useEffect(() => {
    if (!scrollToId) return
    requestAnimationFrame(() => {
      itemRefs.current.get(scrollToId)?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    })
  }, [scrollToId])

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
      {/* Header */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            {t.results.title}
            {radiusKm !== undefined && (
              onRadiusChange ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={t.results.radiusPickerLabel}
                      className="flex items-center gap-0.5 text-xs font-normal text-muted-foreground hover:text-foreground transition-colors rounded-sm px-1 -mx-1 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
                    >
                      {t.results.titleRadius(radiusKm)}
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-1.5" align="start">
                    <div className="flex flex-wrap gap-1 max-w-[14rem]">
                      {RADIUS_PRESETS_KM.map((km) => {
                        const isActive = km === radiusKm
                        return (
                          <PopoverClose asChild key={km}>
                            <button
                              type="button"
                              onClick={() => { if (km !== radiusKm) onRadiusChange(km) }}
                              className={cn(
                                "text-xs font-medium rounded-md px-2.5 py-1 border transition-colors cursor-pointer",
                                isActive
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-card text-foreground border-border hover:bg-muted"
                              )}
                            >
                              {km} km
                            </button>
                          </PopoverClose>
                        )
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : (
                <span className="text-xs font-normal text-muted-foreground">
                  {t.results.titleRadius(radiusKm)}
                </span>
              )
            )}
            {isLoading && (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" aria-label={t.chat.thinking} />
            )}
          </h2>
          <div className="flex items-center gap-2">
            {!isLoading && places.length > 0 && (
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
          <div className="w-full rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm text-foreground/80 flex items-center gap-2">
            <LocateFixed className="w-4 h-4 text-primary shrink-0" />
            {t.chat.welcomeGpsHint}
          </div>
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
            {onSwitchToPlace && (
              <button
                onClick={onSwitchToPlace}
                className="w-full flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 hover:bg-muted hover:border-primary/30 transition-colors text-left group"
              >
                <span className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-primary" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-foreground">{t.chat.welcomePlaceCard}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">{t.chat.welcomePlaceCardHint}</span>
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
      {!showWelcome && <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
        <div className="p-3 flex flex-col gap-2">
          {isLoading && (
            <div className="flex flex-col gap-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-36 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          )}

          {!isLoading && places.length === 0 && !hasSearched && chatMode !== "nearby" && (
            <div className="flex flex-col items-center gap-4 py-14 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                {chatMode === "place"
                  ? <Building2 className="w-8 h-8 text-muted-foreground" />
                  : <MapPin    className="w-8 h-8 text-muted-foreground" />
                }
              </div>
              <div className="flex flex-col gap-2">
                {chatMode === "place" ? (
                  <>
                    <p className="font-semibold text-foreground">{t.chat.noSearchYetTitlePlace}</p>
                    <p className="text-sm text-muted-foreground">{t.chat.noSearchYetPlace}</p>
                    {onSwitchToText && (
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        {t.chat.noSearchYetExploreHint}{" "}
                        <button
                          onClick={onSwitchToText}
                          className="text-primary hover:underline font-medium"
                        >
                          {t.chat.noSearchYetExploreLink}
                        </button>
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-foreground">{t.chat.noSearchYetTitle}</p>
                    <p className="text-sm text-muted-foreground">{t.chat.noSearchYet}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">{t.chat.noSearchYetNameHint}</p>
                    {onSwitchToPlace && (
                      <p className="text-xs text-muted-foreground/70">
                        {t.chat.noSearchYetPlaceHint}{" "}
                        <button
                          onClick={onSwitchToPlace}
                          className="text-primary hover:underline font-medium"
                        >
                          {t.chat.noSearchYetPlaceLink}
                        </button>
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {!isLoading && places.length === 0 && hasSearched && (
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

          {!isLoading && displayedPlaces.map((place) => (
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
        </div>
      </div>}
    </div>
  )
}
