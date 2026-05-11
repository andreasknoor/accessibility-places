"use client"

import { Loader2, AlertTriangle, RefreshCw } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Slider }   from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTranslations } from "@/lib/i18n"
import { useIsMobile } from "@/hooks/useIsMobile"
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
  onRerun?:      () => void
  isLoading?:    boolean
}

function SourceIndicator({ state }: { state?: SourceState }) {
  const t = useTranslations()
  const isMobile = useIsMobile()
  if (!state) return null
  if (state.status === "loading") {
    return (
      <span className="inline-flex items-center gap-1 shrink-0">
        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" aria-label={t.common.loading} />
      </span>
    )
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
  // Variant A: show finalCount (places attributed to this source via primarySource).
  // While the result event hasn't arrived yet, fall back to rawCount so something
  // shows during the brief gap between source-complete and result.
  const display = state.finalCount ?? state.rawCount ?? 0
  const indicator = (
    <span className="text-xs font-medium tabular-nums text-foreground/60 shrink-0">
      {display}
    </span>
  )
  // Variant C as desktop-only debug tooltip: roh → gefiltert.
  // Only meaningful once both numbers exist *and* differ.
  const showDebugTooltip =
    !isMobile &&
    state.rawCount !== undefined &&
    state.finalCount !== undefined &&
    state.rawCount !== state.finalCount
  if (!showDebugTooltip) return indicator
  return (
    <Tooltip>
      <TooltipTrigger asChild>{indicator}</TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {t.filters.sourceCountTooltip(state.rawCount!, state.finalCount!)}
      </TooltipContent>
    </Tooltip>
  )
}

const SOURCE_ORDER: SourceId[] = [
  "osm",
  "accessibility_cloud",
  "ginto",
  "google_places",
]

const SOURCE_RELIABILITY: Record<SourceId, string> = {
  osm:                 "bg-yellow-500",
  accessibility_cloud: "bg-lime-500",
  reisen_fuer_alle:    "bg-green-500",
  ginto:               "bg-teal-500",
  google_places:       "bg-orange-400",
}

const SOURCE_DISABLED: Partial<Record<SourceId, true>> = {}

export default function FilterPanel({ filters, sources, radiusKm, onFilters, onSources, onRadius, sourceStates, onRerun, isLoading }: Props) {
  const t = useTranslations()

  function toggleSource(id: SourceId) {
    onSources({ ...sources, [id]: !sources[id] })
  }

  function toggleFilter(key: keyof SearchFilters) {
    onFilters({ ...filters, [key]: !filters[key] })
  }

  return (
    <aside className="flex flex-col gap-5 w-64 shrink-0 p-4 border-r border-border bg-card overflow-y-auto">
      {/* ── Rerun button ── */}
      {onRerun && (
        <button
          onClick={onRerun}
          className="flex items-center justify-center w-full rounded-md relative overflow-hidden
                     py-2 text-sm font-medium bg-primary text-primary-foreground
                     hover:bg-primary/90 transition-colors"
        >
          {isLoading && (
            <span
              className="absolute inset-y-0 left-0 pointer-events-none"
              style={{ width: 0, background: "rgba(255,255,255,0.45)", animation: "btn-progress 30s linear forwards" }}
              aria-hidden
            />
          )}
          <span className="relative z-10 flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5" />
            {t.results.rerun}
          </span>
        </button>
      )}
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

          {/* Only manually verified — data-quality filter that requires at least
              one source attribution with `verifiedRecently=true` (e.g. OSM
              check_date:wheelchair within 2 years). */}
          <label className="flex items-center gap-2.5 cursor-pointer">
            <Checkbox
              checked={filters.onlyVerified}
              onCheckedChange={() => toggleFilter("onlyVerified")}
              id="crit-onlyVerified"
            />
            <span className="text-sm text-muted-foreground leading-snug">
              {t.filters.criteriaItems.onlyVerified}
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
