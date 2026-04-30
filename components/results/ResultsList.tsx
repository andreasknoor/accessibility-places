"use client"

import { Loader2 } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import PlaceCard from "./PlaceCard"
import { useTranslations } from "@/lib/i18n"
import type { Place, SearchFilters } from "@/lib/types"

interface Props {
  places:      Place[]
  filters?:    SearchFilters
  selectedId?: string
  onSelect:    (place: Place) => void
  isLoading:   boolean
  summary?:    string
}

export default function ResultsList({ places, filters, selectedId, onSelect, isLoading, summary }: Props) {
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
          {!isLoading && places.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {t.results.count(places.length)}
            </span>
          )}
        </div>
        {summary && (
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{summary}</p>
        )}
      </div>

      {/* List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 flex flex-col gap-2">
          {isLoading && (
            <div className="flex flex-col gap-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-36 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          )}

          {!isLoading && places.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              {t.chat.noResults}
            </p>
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
      </ScrollArea>
    </div>
  )
}
