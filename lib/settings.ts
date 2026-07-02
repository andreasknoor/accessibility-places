"use client"

import { useState, useCallback, useEffect } from "react"
import type { Category } from "@/lib/types"

export interface AppSettings {
  defaultSearchMode:  "text" | "nearby" | null  // null = no preference (app default)
  defaultMobileView:  "results" | "map"
  // Stable category key of the pre-selected chip (null = "Alle"/all categories, the
  // app default). Keyed by Category — NOT a positional chip index — so reordering or
  // removing a chip can never silently re-map a saved preference. Legacy installs
  // that stored the old positional `defaultChipIdx` are migrated in loadSettings().
  defaultChipCat:     Category | null
  sortOrder:          "confidence" | "distance"
  autoZoom:           boolean
  alwaysShowParking:  boolean
  alwaysShowToilets:  boolean
  // Show the weak "accessible" parking tier (wheelchair=yes lots without reserved
  // bays) as yellow markers on the map — including in Parkplatz-Modus. Default on.
  showWeakParking:    boolean
  // WC focus mode: when true, restricts the WC layer to standalone public toilets
  // (amenity=toilets) and hides WCs that are part of a venue. Default off (show all).
  publicToiletsOnly:  boolean
  parkingRadiusKm:    number          // radius for the amenity focus fetch (parking + WC), 0.05–5.0
  // Opt-in: allow searches outside DACH (curated country allowlist). Default off.
  // When on, geocoding + OSM endpoint choice widen to the allowlist; DACH searches
  // are unaffected (still use the private server + all sources).
  internationalMode:  boolean
  // Opt-out: anonymous usage statistics (random ID in localStorage + per-search
  // counter in Redis; no IP, no queries, no coordinates). Turning this off deletes
  // the local ID and stops sending — see docs/plans/top-users-stats.md.
  usageStats:         boolean
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultSearchMode:  null,
  defaultMobileView:  "map",
  defaultChipCat:     null,
  sortOrder:          "confidence",
  autoZoom:           true,
  alwaysShowParking:  false,
  alwaysShowToilets:  false,
  showWeakParking:    true,
  publicToiletsOnly:  false,
  parkingRadiusKm:    4.0,
  internationalMode:  false,
  usageStats:         true,
}

// Mirrors CHIPS in ChatPanel.tsx. Each entry carries its stable `cat` key, so the
// two arrays no longer need to share a positional index — only their visible order
// should match for consistency. The default-chip picker stores `cat`, never an index.
export const SETTING_CHIPS: { cat: Category; icon: string; de: string; en: string }[] = [
  { cat: "restaurant", icon: "🍽", de: "Restaurants",       en: "Restaurants"   },
  { cat: "cafe",       icon: "☕", de: "Cafés & Eis",        en: "Cafés & Ice Cream" },
  { cat: "hotel",      icon: "🏨", de: "Hotels",            en: "Hotels"        },
  { cat: "biergarten", icon: "🍻", de: "Biergärten",        en: "Beer Gardens"  },
  { cat: "pub",        icon: "🍺", de: "Kneipen",           en: "Pubs"          },
  { cat: "museum",     icon: "🏛", de: "Museen",            en: "Museums"       },
  { cat: "theater",    icon: "🎭", de: "Theater",           en: "Theaters"      },
  { cat: "cinema",     icon: "🎬", de: "Kinos",             en: "Cinemas"       },
  { cat: "bar",        icon: "🍸", de: "Bars",              en: "Bars"          },
  { cat: "attraction", icon: "🗺",  de: "Sehenswürdigkeiten", en: "Attractions" },
  { cat: "pharmacy",   icon: "💊", de: "Apotheken",         en: "Pharmacies"    },
  { cat: "doctors",    icon: "🩺", de: "Arztpraxen",        en: "Doctors"       },
]

// Pre-merge positional chip order (with the now-removed "Eisdielen" at index 8),
// used once to translate a legacy persisted `defaultChipIdx` into a stable category
// key. Index 8 maps to "cafe" because ice_cream was merged into cafe.
const LEGACY_CHIP_IDX_TO_CAT: Category[] = [
  "restaurant", "cafe", "hotel", "biergarten", "pub", "museum", "theater",
  "cinema", "cafe", "bar", "attraction", "pharmacy", "doctors",
]

// Exported so ChatPanel can migrate its own legacy `ap_last_search` {idx} payload
// with the exact same table. null/out-of-range → "Alle" (null).
export function legacyChipIdxToCat(idx: number | null | undefined): Category | null {
  if (typeof idx !== "number") return null
  return LEGACY_CHIP_IDX_TO_CAT[idx] ?? null
}

const SETTINGS_KEY = "ap_settings"

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_APP_SETTINGS
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_APP_SETTINGS
    const stored = JSON.parse(raw)
    const parsed = { ...DEFAULT_APP_SETTINGS, ...stored }
    // Migrate legacy "place" mode (removed in v4.13) → "text"
    if (parsed.defaultSearchMode === "place") parsed.defaultSearchMode = "text"
    // Migrate legacy positional defaultChipIdx → stable defaultChipCat (cafe+ice_cream
    // merge). Guard on the RAW stored value: a legacy install has `defaultChipIdx` but
    // no `defaultChipCat`, so this runs exactly once. Naturally idempotent — once
    // defaultChipCat is persisted, the guard is false and the index is never re-read.
    if (stored.defaultChipCat === undefined && stored.defaultChipIdx !== undefined) {
      parsed.defaultChipCat = legacyChipIdxToCat(stored.defaultChipIdx)
    }
    delete (parsed as { defaultChipIdx?: unknown }).defaultChipIdx  // drop the legacy field
    return parsed
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
