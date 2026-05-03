"use client"

import { useState } from "react"
import { Loader2, RefreshCw, MapPin, X } from "lucide-react"
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
  const [mapHintSeen, setMapHintSeen] = useState(() =>
    typeof window !== "undefined" && !!localStorage.getItem("ap_map_hint_seen")
  )

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
              <span className="text-xs font-normal text-muted-foreground">
                {t.results.titleRadius(radiusKm)}
              </span>
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
            aria-label="Hinweis schließen"
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
            <PlaceCard
              key={place.id}
              place={place}
              filters={filters}
              isSelected={place.id === selectedId}
              onClick={() => handleSelect(place)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
