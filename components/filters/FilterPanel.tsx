"use client"

import { Loader2, AlertTriangle } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Slider }   from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTranslations } from "@/lib/i18n"
import { SOURCE_LABELS } from "@/lib/config"
import type { SearchFilters, ActiveSources, SourceId, SourceState } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Props {
  filters:       SearchFilters
  sources:       ActiveSources
  radiusKm:      number
  onFilters:     (f: SearchFilters)   => void
  onSources:     (s: ActiveSources)   => void
  onRadius:      (r: number)          => void
  sourceStates?: Partial<Record<SourceId, SourceState>>
}

function SourceIndicator({ state }: { state?: SourceState }) {
  if (!state) return null
  if (state.status === "loading") {
    return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground shrink-0" aria-label="Lädt …" />
  }
  if (state.status === "error") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 shrink-0 text-amber-600">
            <span className="text-xs font-medium tabular-nums">0</span>
            <AlertTriangle className="w-3 h-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs text-xs">
          {state.error || "Netzwerkfehler"}
        </TooltipContent>
      </Tooltip>
    )
  }
  return (
    <span className="text-xs font-medium tabular-nums text-foreground/60 shrink-0">
      {state.count ?? 0}
    </span>
  )
}

const SOURCE_ORDER: SourceId[] = [
  "osm",
  "accessibility_cloud",
  "google_places",
  "reisen_fuer_alle",
]

const SOURCE_RELIABILITY: Record<SourceId, string> = {
  osm:                 "bg-yellow-500",
  accessibility_cloud: "bg-lime-500",
  google_places:       "bg-orange-400",
  reisen_fuer_alle:    "bg-green-500",
}

const SOURCE_DISABLED: Partial<Record<SourceId, true>> = {
  reisen_fuer_alle: true,
}

export default function FilterPanel({ filters, sources, radiusKm, onFilters, onSources, onRadius, sourceStates }: Props) {
  const t = useTranslations()

  function toggleSource(id: SourceId) {
    onSources({ ...sources, [id]: !sources[id] })
  }

  function toggleFilter(key: keyof SearchFilters) {
    onFilters({ ...filters, [key]: !filters[key] })
  }

  return (
    <aside className="flex flex-col gap-5 w-64 shrink-0 p-4 border-r border-border bg-card overflow-y-auto">
      {/* ── Data sources ── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          {t.filters.sources}
        </h2>
        <div className="flex flex-col gap-2.5">
          {SOURCE_ORDER.map((id) => {
            const disabled = SOURCE_DISABLED[id] ?? false
            return (
              <label key={id} className={cn("flex items-center gap-2.5 group", disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer")}>
                <Checkbox
                  checked={sources[id]}
                  onCheckedChange={() => !disabled && toggleSource(id)}
                  id={`src-${id}`}
                  disabled={disabled}
                />
                <span className={cn("w-2 h-2 rounded-full shrink-0", SOURCE_RELIABILITY[id])} />
                <span className="text-sm text-muted-foreground leading-snug flex items-center gap-1.5 min-w-0">
                  <span className="truncate">{SOURCE_LABELS[id]}</span>
                  {!disabled && <SourceIndicator state={sourceStates?.[id]} />}
                </span>
              </label>
            )
          })}
        </div>
      </section>

      <Separator />

      {/* ── Criteria ── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          {t.filters.criteria}
        </h2>
        <div className="flex flex-col gap-2.5">
          {(["entrance", "toilet", "parking"] as const).map((key) => (
            <label key={key} className="flex items-center gap-2.5 cursor-pointer">
              <Checkbox
                checked={filters[key]}
                onCheckedChange={() => toggleFilter(key)}
                id={`crit-${key}`}
              />
              <span className="text-sm text-muted-foreground leading-snug">
                {t.filters.criteriaItems[key]}
              </span>
            </label>
          ))}

          {/* Dogs allowed — bonus filter, sourced from OSM dog=* and A.Cloud animalPolicy */}
          <label className="flex items-center gap-2.5 cursor-pointer">
            <Checkbox
              checked={filters.allowsDogs}
              onCheckedChange={() => toggleFilter("allowsDogs")}
              id="crit-allowsDogs"
            />
            <span className="text-sm text-muted-foreground leading-snug">
              {t.filters.criteriaItems.allowsDogs}
            </span>
          </label>

          {/* Seating — optional, dimmed */}
          <label className="flex items-center gap-2.5 cursor-pointer">
            <Checkbox
              checked={filters.seating}
              onCheckedChange={() => toggleFilter("seating")}
              id="crit-seating"
            />
            <span className="text-sm text-muted-foreground/70 leading-snug">
              {t.filters.criteriaItems.seating}
              <span className="ml-1 text-xs opacity-60">(Google)</span>
            </span>
          </label>
        </div>
      </section>

      <Separator />

      {/* ── Radius ── */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          {t.filters.radius}
        </h2>
        <div className="flex flex-col gap-3">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>1 km</span>
            <span className="font-medium text-foreground">{t.filters.radiusLabel(radiusKm)}</span>
            <span>50 km</span>
          </div>
          <Slider
            min={1}
            max={50}
            step={1}
            value={[radiusKm]}
            onValueChange={([v]) => onRadius(v)}
            className="w-full"
          />
        </div>
      </section>

      <Separator />

      {/* ── Unknown toggle ── */}
      <section>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <Checkbox
            checked={filters.acceptUnknown}
            onCheckedChange={() => toggleFilter("acceptUnknown")}
            id="accept-unknown"
            className="mt-0.5"
          />
          <span className="text-sm text-muted-foreground leading-snug">
            {t.filters.acceptUnknown}
          </span>
        </label>
      </section>
    </aside>
  )
}
