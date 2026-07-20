"use client"

import { useState, useCallback, useEffect } from "react"
import type { Category } from "@/lib/types"
import { CATEGORY_ICONS } from "@/lib/category-icons"
import de from "@/lib/i18n/de"
import en from "@/lib/i18n/en"

export interface AppSettings {
  defaultSearchMode:  "text" | "nearby" | null  // null = no preference (app default)
  defaultMobileView:  "results" | "map"
  // Stable category key of the pre-selected chip (null = "Alle"/all categories, the
  // app default). Keyed by Category — NOT a positional chip index — so reordering or
  // removing a chip can never silently re-map a saved preference. Legacy installs
  // that stored the old positional `defaultChipIdx` are migrated in loadSettings().
  defaultChipCat:     Category | null
  sortOrder:          "confidence" | "distance"
  alwaysShowParking:  boolean
  alwaysShowToilets:  boolean
  // Show the weak "accessible" parking tier (wheelchair=yes lots without reserved
  // bays) as yellow markers on the map — including in Parkplatz-Modus. Default on.
  showWeakParking:    boolean
  // WC focus mode: when true, restricts the WC layer to standalone public toilets
  // (amenity=toilets) and hides WCs that are part of a venue. Default off (show all).
  publicToiletsOnly:  boolean
  // Amenity (parking/WC) search starting radius, 0.05–5.0. No direct Settings
  // UI — it round-trips automatically via persistParkingStartRadius whenever
  // the amenity radius changes (header pill, FilterPanel slider, "search this
  // area", "expand radius"), so it always reflects the last-used value.
  parkingRadiusKm:    number
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
  alwaysShowParking:  false,
  alwaysShowToilets:  false,
  showWeakParking:    true,
  publicToiletsOnly:  false,
  parkingRadiusKm:    4.0,
  internationalMode:  false,
  usageStats:         true,
}

// Every category the default-chip picker (SettingsSheet, a plain <select>) can
// offer, in the same group order and within-group alphabetical (by German
// label) order as ChatPanel's CHIP_GROUPS — kept identical so the two
// pickers show a consistent, predictable sequence. Label text prefers the
// chip-specific `chipLabels` override (the legacy dozen's short/plural
// phrasing) and falls back to the singular `categories` badge text — same
// precedence as ChatPanel's drill-in chips. The default-chip picker stores
// `cat`, never a positional index, so this list can be reordered freely.
const SETTING_CHIP_ORDER: Category[] = [
  "bar", "biergarten", "cafe", "fast_food", "pub", "restaurant",
  "camp_site", "apartment", "hostel", "hotel",
  "library", "gallery", "cinema", "museum", "attraction", "theater", "zoo",
  "fitness_centre", "park", "swimming_pool", "playground", "sports_centre",
  "pharmacy", "doctors", "hearing_aids", "hospital", "optician",
  "physiotherapist", "rehabilitation", "medical_supply", "veterinary", "dentist",
  "bakery", "clothes", "florist", "books", "chemist", "bicycle",
  "convenience", "butcher", "furniture", "shoes", "supermarket",
  "bank", "hairdresser", "post_office", "laundry",
  "railway_station", "place_of_worship", "townhall", "fuel",
]

export const SETTING_CHIPS: { cat: Category; icon: string; de: string; en: string }[] =
  SETTING_CHIP_ORDER.map((cat) => ({
    cat,
    icon: CATEGORY_ICONS[cat] ?? "📍",
    de:   de.chipLabels[cat] ?? de.categories[cat],
    en:   en.chipLabels[cat] ?? en.categories[cat],
  }))

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

// Upper bound of the persisted amenity START radius (parkingRadiusKm) — the
// single source for the SettingsSheet slider max AND every write site in
// HomeClient. The LIVE amenity slider goes up to AMENITY_RADIUS_MAX_KM (25 km,
// lib/search-ui.ts) for one-off searches; a one-off large search must never
// become the persisted default, so writers clamp to this bound.
export const SETTINGS_PARKING_RADIUS_MAX_KM = 5.0

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
