"use client"

import { ChevronDown } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export const RADIUS_PRESETS_KM = [1, 2, 5, 10, 25, 50] as const

interface Props {
  radiusKm: number
  // Absent (e.g. during an active amenity search — see canShowResultsRadiusPicker
  // in lib/search-ui.ts) renders a plain, non-interactive label instead of a popover.
  onChange?: (km: number) => void
  label: string
  ariaLabel: string
  triggerClassName: string
}

// Shared compact radius control: a trigger showing the current radius that opens
// a preset-pill popover on tap. Originally lived inline in ResultsList's header;
// extracted so the always-visible header pill (MobileLayout) can reuse the exact
// same interaction instead of duplicating the Popover/preset markup.
export default function RadiusPresetPopover({ radiusKm, onChange, label, ariaLabel, triggerClassName }: Props) {
  if (!onChange) {
    return <span className={triggerClassName}>{label}</span>
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={ariaLabel} className={cn(triggerClassName, "cursor-pointer")}>
          {label}
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
                  onClick={() => { if (km !== radiusKm) onChange(km) }}
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
  )
}
