"use client"

import { useState, useCallback, useEffect } from "react"

export interface AppSettings {
  defaultSearchMode:  "text" | "nearby" | "place" | null  // null = no preference (app default)
  defaultMobileView:  "results" | "map"
  defaultChipIdx:     number | null   // null = first chip (Restaurants), same as current default
  sortOrder:          "confidence" | "distance"
  autoZoom:           boolean
  alwaysShowParking:  boolean
  alwaysShowToilets:  boolean
  // Show the weak "accessible" parking tier (wheelchair=yes lots without reserved
  // bays) as yellow markers on the map — including in Parkplatz-Modus. Default off.
  showWeakParking:    boolean
  // WC focus mode: when true, restricts the WC layer to standalone public toilets
  // (amenity=toilets) and hides WCs that are part of a venue. Default off (show all).
  publicToiletsOnly:  boolean
  parkingRadiusKm:    number          // radius for the amenity focus fetch (parking + WC), 0.05–5.0
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultSearchMode:  null,
  defaultMobileView:  "results",
  defaultChipIdx:     null,
  sortOrder:          "confidence",
  autoZoom:           true,
  alwaysShowParking:  false,
  alwaysShowToilets:  false,
  showWeakParking:    false,
  publicToiletsOnly:  false,
  parkingRadiusKm:    2.0,
}

// Mirrors CHIPS in ChatPanel.tsx — same order and indices must stay in sync
export const SETTING_CHIPS = [
  { icon: "🍽", de: "Restaurants",         en: "Restaurants"  },
  { icon: "☕", de: "Cafés",               en: "Cafés"         },
  { icon: "🏨", de: "Hotels",              en: "Hotels"        },
  { icon: "🍻", de: "Biergärten",          en: "Beer Gardens"  },
  { icon: "🍺", de: "Kneipen",             en: "Pubs"          },
  { icon: "🏛", de: "Museen",              en: "Museums"       },
  { icon: "🎭", de: "Theater",             en: "Theaters"      },
  { icon: "🎬", de: "Kinos",               en: "Cinemas"       },
  { icon: "🍦", de: "Eisdielen",           en: "Ice Cream"     },
  { icon: "🍸", de: "Bars",                en: "Bars"          },
  { icon: "🗺",  de: "Sehenswürdigkeiten", en: "Attractions"   },
] as const

const SETTINGS_KEY = "ap_settings"

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_APP_SETTINGS
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_APP_SETTINGS
    return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_APP_SETTINGS
  }
}

function saveSettings(s: AppSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)

  useEffect(() => {
    setSettings(loadSettings())
  }, [])

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  return [settings, updateSettings] as const
}
