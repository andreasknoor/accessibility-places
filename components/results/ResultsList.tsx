"use client"

import { useState, useRef, useEffect } from "react"
import { Loader2, RefreshCw, MapPin, X, ChevronDown } from "lucide-react"
import PlaceCard from "./PlaceCard"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from "@/components/ui/popover"
import type { Place, SearchFilters } from "@/lib/types"

const RADIUS_PRESETS_KM = [1, 2, 5, 10, 25, 50] as const

interface Props {
  places:      Place[]
  filters?:    SearchFilters
  selectedId?: string
  onSelect:    (place: Place) => void
  isLoading:   boolean

  onRerun?:         () => void
  onExpandRadius?:  () => void
  radiusKm?:        number
  onRadiusChange?:  (km: number) => void
  hasSearched?:     boolean
  scrollToId?:      string
}

export default function ResultsList({ places, filters, selectedId, onSelect, isLoading, onRerun, onExpandRadius, radiusKm, onRadiusChange, hasSearched, scrollToId }: Props) {
  const t = useTranslations()
  const [mapHintSeen, setMapHintSeen] = useState(() =>
    typeof window !== "undefined" && !!localStorage.getItem("ap_map_hint_seen")
  )
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map())

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
              </span>
            )}
            {onRerun && !isLoading && (
              <button
                onClick={onRerun}
                title={t.results.rerun}
                aria-label={t.results.rerun}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

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

      {/* List */}
      {/* Plain overflow-y-auto avoids Radix ScrollArea's internal display:table wrapper,
          which causes horizontal width inflation in iOS Safari when any child has
          white-space:nowrap content wider than the viewport. */}
      <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
        <div className="p-3 flex flex-col gap-2">
          {isLoading && (
            <div className="flex flex-col gap-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-36 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          )}

          {!isLoading && places.length === 0 && !hasSearched && (
            <div className="flex flex-col items-center gap-4 py-14 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <MapPin className="w-8 h-8 text-muted-foreground" />
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="font-semibold text-foreground">{t.chat.noSearchYetTitle}</p>
                <p className="text-sm text-muted-foreground">{t.chat.noSearchYet}</p>
              </div>
            </div>
          )}

          {!isLoading && places.length === 0 && hasSearched && (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-sm text-muted-foreground text-center">
                {t.chat.noResults}
              </p>
              {onExpandRadius && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{t.results.expandRadius}</span>
                  <button
                    onClick={onExpandRadius}
                    className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-sm font-medium
                               hover:bg-primary/90 transition-colors"
                  >
                    {t.results.expandRadiusYes}
                  </button>
                </div>
              )}
            </div>
          )}

          {!isLoading && places.map((place) => (
            <div
              key={place.id}
              ref={(el) => { if (el) itemRefs.current.set(place.id, el); else itemRefs.current.delete(place.id) }}
            >
              <PlaceCard
                place={place}
                filters={filters}
                isSelected={place.id === selectedId}
                onClick={() => handleSelect(place)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
