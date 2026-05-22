"use client"

import { useState, useCallback } from "react"

export interface AppSettings {
  defaultSearchMode:  "text" | "nearby"
  defaultMobileView:  "results" | "map"
  defaultChipIdx:     number | null   // null = first chip (Restaurants), same as current default
  sortOrder:          "confidence" | "distance"
  autoZoom:           boolean
  alwaysShowParking:  boolean
  parkingRadiusKm:    number          // radius for the "show parking" pre-check and fetch (0.05–3.0)
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultSearchMode:  "text",
  defaultMobileView:  "results",
  defaultChipIdx:     null,
  sortOrder:          "confidence",
  autoZoom:           true,
  alwaysShowParking:  false,
  parkingRadiusKm:    1.0,
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
  const [settings, setSettings] = useState<AppSettings>(loadSettings)

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  return [settings, updateSettings] as const
}
