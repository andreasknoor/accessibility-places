"use client"


import { Loader2, RefreshCw } from "lucide-react"
import PlaceCard from "./PlaceCard"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Place, SearchFilters } from "@/lib/types"

interface Props {
  places:      Place[]
  filters?:    SearchFilters
  selectedId?: string
  onSelect:    (place: Place) => void
  isLoading:   boolean

  onRerun?:         () => void
  onExpandRadius?:  () => void
  radiusKm?:        number
  hasSearched?:     boolean
}

export default function ResultsList({ places, filters, selectedId, onSelect, isLoading, onRerun, onExpandRadius, radiusKm, hasSearched }: Props) {
  const t = useTranslations()

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            {t.results.title}
            {isLoading && (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" aria-label={t.chat.thinking} />
            )}
          </h2>
          <div className="flex items-center gap-2">
            {!isLoading && places.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {t.results.count(places.length, radiusKm)}
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
            <p className="text-sm text-muted-foreground text-center py-8">
              {t.chat.noSearchYet}
            </p>
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
            <PlaceCard
              key={place.id}
              place={place}
              filters={filters}
              isSelected={place.id === selectedId}
              onClick={() => onSelect(place)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
