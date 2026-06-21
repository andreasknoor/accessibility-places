"use client"

import { useState, useRef, useEffect, Fragment } from "react"
import { Send, Loader2, LocateFixed, Search, X, Coffee, UtensilsCrossed, Beer, BookOpen, Hotel, Landmark, Film, Library, GalleryHorizontal, Star, IceCream, MapPin } from "lucide-react"
import { track } from "@/lib/analytics"
import { Button } from "@/components/ui/button"
import { useTranslations, useLocale } from "@/lib/i18n"
import { useIsMobile } from "@/hooks/useIsMobile"
import { cn } from "@/lib/utils"
import { extractQuotedName } from "@/lib/llm"
import { loadSettings } from "@/lib/settings"
import { getCurrentPosition, isGeolocationAvailable, watchPosition, clearWatchPosition, type GeoWatchId } from "@/lib/native/geolocation"
import DevConsole from "@/components/easter-eggs/DevConsole"
import type { AmenityType } from "@/lib/types"

type Coords = { lat: number; lon: number }

interface Props {
  onSearch:          (query: string, coords?: Coords, nameHint?: string) => void
  onPlaceSearch?:    (nameHint: string, coords?: Coords) => void
  isLoading:         boolean
  onModeChange?:     (mode: "text" | "nearby") => void
  autoFocus?:        boolean
  initialLocation?:  string
  initialChipIdx?:   number
  initialMode?:      "text" | "nearby" | "place"  // "place" is treated as "text" (legacy)
  onGpsResolved?:    (coords: Coords) => void
  skipAutoLocate?:   boolean
  hasGpsCoords?:     boolean
  locateTrigger?:    number
  biasCoords?:       Coords
  // Amenity focus layer chips in the nearby-info row (parking / WC).
  focusLayers?:        Set<AmenityType>
  onToggleFocusLayer?: (type: AmenityType) => void
  focusLoadingLayer?:  AmenityType | null
  focusHints?:         Partial<Record<AmenityType, string>>
  // Reports a category-only query reflecting the current chip selection, so the
  // map's "search here" can run even before any search has been submitted (text
  // mode, no location entered). Null chip → an all-categories query.
  onCategoryQueryChange?: (query: string) => void
  // Coordinates of the currently displayed search when it was coordinate-based
  // (e.g. "search here", nearby). Set → a chip change in text mode refines THIS
  // area in place instead of re-geocoding the (possibly stale) location textbox.
  activeSearchCoords?: Coords
  // Opt-in international mode (AppSettings.internationalMode). When true the
  // autocomplete widens from DACH to the supported-country allowlist.
  international?: boolean
}

const CHIPS = [
  { icon: "🍽", de: "Restaurants",       en: "Restaurants"  },
  { icon: "☕", de: "Cafés",             en: "Cafés"         },
  { icon: "🏨", de: "Hotels",            en: "Hotels"        },
  { icon: "🍻", de: "Biergärten",        en: "Beer Gardens"  },
  { icon: "🍺", de: "Kneipen",           en: "Pubs"          },
  { icon: "🏛", de: "Museen",            en: "Museums"       },
  { icon: "🎭", de: "Theater",           en: "Theaters"      },
  { icon: "🎬", de: "Kinos",             en: "Cinemas"       },
  { icon: "🍦", de: "Eisdielen",         en: "Ice Cream"     },
  { icon: "🍸", de: "Bars",              en: "Bars"          },
  { icon: "🗺",  de: "Sehenswürdigkeiten", en: "Attractions" },
  { icon: "💊", de: "Apotheken",         en: "Pharmacies"   },
  { icon: "🩺", de: "Arztpraxen",        en: "Doctors"      },
]

type Mode        = "text" | "nearby"
type NearbyPhase = "idle" | "locating" | { district: string; lat: number; lon: number } | "error"

// One suggestion from /api/geocode/unified-suggest — areas (cities/districts)
// and venues (POIs) arrive classified in a single ranked list, areas first.
type UnifiedSuggestion = {
  kind:     "area" | "venue"
  display:  string
  name:     string
  lat:      number | null
  lon:      number | null
  osmKey:   string | null
  osmValue: string | null
}

// Matches any quoted segment (straight, curly, German typographic, guillemets) —
// used to strip the quoted name filter before autocomplete / location parsing.
// Mirrors the quote classes in extractQuotedName (lib/llm.ts).
const QUOTE_STRIP_RE = /["'„""‟"«»‹›][^"'„""‟"«»‹›]*["'„""‟"«»‹›]?/gu

// The plain-text part of the input: quoted name removed, a leading "in " dropped
// so "…" in Berlin" doesn't produce "<Chip> in in Berlin" queries.
function locationPart(input: string): string {
  return input.replace(QUOTE_STRIP_RE, "").replace(/^\s*in\s+/i, "").trim()
}

function PlaceCategoryIcon({ osmKey, osmValue }: { osmKey: string | null; osmValue: string | null }) {
  const Icon = (() => {
    if (osmKey === "amenity") {
      switch (osmValue) {
        case "cafe":       return Coffee
        case "restaurant": return UtensilsCrossed
        case "bar":
        case "pub":
        case "biergarten": return Beer
        case "fast_food":
        case "food_court": return UtensilsCrossed
        case "cinema":     return Film
        case "library":    return Library
        case "theatre":    return Landmark
        case "ice_cream":  return IceCream
      }
    }
    if (osmKey === "tourism") {
      switch (osmValue) {
        case "hotel":
        case "motel":
        case "guest_house":
        case "hostel":
        case "apartment":  return Hotel
        case "museum":     return BookOpen
        case "gallery":
        case "arts_centre":return GalleryHorizontal
        case "attraction":
        case "theme_park": return Star
      }
    }
    return MapPin
  })()
  return <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const res = await fetch(`/api/geocode/reverse?lat=${lat}&lon=${lon}`)
  if (!res.ok) throw new Error("reverse geocode failed")
  const data = await res.json()
  return data.district ?? ""
}

export default function ChatPanel({ onSearch, onPlaceSearch, isLoading, onModeChange, autoFocus, initialLocation, initialChipIdx, initialMode, onGpsResolved, skipAutoLocate, hasGpsCoords, locateTrigger, biasCoords, focusLayers, onToggleFocusLayer, focusLoadingLayer, focusHints, onCategoryQueryChange, activeSearchCoords, international }: Props) {
  const t = useTranslations()
  const { locale } = useLocale()
  const isMobile = useIsMobile()
  const [mode,           setMode]           = useState<Mode>(initialMode === "place" ? "text" : (initialMode ?? "nearby"))
  const [nearbyPhase,    setNearbyPhase]    = useState<NearbyPhase>("idle")
  const [location,       setLocation]       = useState("")
  // null = "Alle" (all categories, the default) — chips are optional scope
  // shortcuts, not a mandatory pre-selection.
  const [selectedIdx,    setSelectedIdx]    = useState<number | null>(null)
  const [suggestions,    setSuggestions]    = useState<UnifiedSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightedIdx, setHighlightedIdx] = useState(-1)
  const [inputPulse,     setInputPulse]     = useState(false)
  // True while the input holds a venue picked from the dropdown — chips are
  // meaningless for a single-venue search and are greyed out until the user
  // edits the field again.
  const [venuePicked,    setVenuePicked]    = useState(false)
  const [showDevConsole, setShowDevConsole] = useState(false)
  const selectedIdxRef       = useRef<number | null>(null)
  // True once the startup category has been definitively established — by a SEO
  // deep-link, a restored last search, the user's default-category setting, or a
  // manual chip pick. Gates the async default-chip effect so it applies the
  // setting exactly once and never overrides one of the above.
  const chipResolvedRef      = useRef(false)
  const debounceRef          = useRef<ReturnType<typeof setTimeout>>(undefined)
  const suggestAbortRef      = useRef<AbortController>(undefined)
  const locatingRef          = useRef(false)
  const watchIdRef           = useRef<GeoWatchId | null>(null)
  // Holds the location value that was set programmatically (restore, area pick,
  // venue pick). Autocomplete is suppressed as long as location equals this
  // value — survives the locale/biasCoords re-renders that fire after a search
  // completes, which a one-shot skip flag would miss (the dropdown would
  // re-open). Cleared when the user types.
  const programmaticLocRef = useRef("")
  // The venue picked from the dropdown — lets Enter re-run the place search
  // while the input still shows the picked suggestion.
  const pickedVenueRef    = useRef<{ display: string; name: string; lat: number | null; lon: number | null } | null>(null)
  const inputRef          = useRef<HTMLInputElement>(null)
  const handleLocateRef   = useRef<() => void>(() => {})
  // Mirrors `locale` so async GPS callbacks read the live value rather than the
  // closure-captured snapshot.
  const localeRef         = useRef(locale)

  const district = typeof nearbyPhase === "object" ? nearbyPhase.district : null

  // Sync mode when HomeClient corrects chatMode post-hydration via useLayoutEffect.
  // Maps legacy "place" initialMode to "text" (place mode was removed in v4.13).
  useEffect(() => {
    if (initialMode !== undefined) setMode(initialMode === "place" ? "text" : initialMode)
  }, [initialMode])

  // Restore last search on mount (chip + location, never nearby mode).
  // URL-derived initialLocation takes priority over localStorage.
  useEffect(() => {
    // applyDefaultChip only resolves when initialChipIdx is already known. At
    // mount it is usually undefined for the settings-driven default (useSettings
    // loads asynchronously) — leaving chipResolvedRef false so the reactive
    // effect below applies it once the setting arrives. For SEO deep-links
    // initialChipIdx is synchronous, so it resolves here immediately.
    const applyDefaultChip = () => {
      if (initialChipIdx !== undefined && initialChipIdx >= 0 && initialChipIdx < CHIPS.length) {
        setSelectedIdx(initialChipIdx)
        selectedIdxRef.current = initialChipIdx
        chipResolvedRef.current = true
      }
    }
    if (initialLocation) {
      programmaticLocRef.current = initialLocation
      setLocation(initialLocation)
      applyDefaultChip()
      return
    }
    try {
      const saved = localStorage.getItem("ap_last_search")
      if (saved) {
        const { idx, loc } = JSON.parse(saved)
        if (typeof idx === "number" && idx >= 0 && idx < CHIPS.length) {
          setSelectedIdx(idx)
          selectedIdxRef.current = idx
          chipResolvedRef.current = true
        } else if (idx === null) {
          // Explicit "Alle" from the last search wins over the default setting.
          chipResolvedRef.current = true
        } else {
          applyDefaultChip()
        }
        if (typeof loc === "string" && loc.trim()) {
          programmaticLocRef.current = loc
          setLocation(loc)
        }
      } else {
        applyDefaultChip()
      }
    } catch { applyDefaultChip() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply the user's default category once it resolves. initialChipIdx arrives
  // asynchronously (useSettings reads localStorage in an effect), so the mount
  // effect above usually can't see it yet — the bug where "Standard-Kategorie"
  // was ignored and the chip fell back to "Alle". Mirrors the initialMode
  // effect. chipResolvedRef ensures it only fills the startup default and never
  // overrides a SEO deep-link, a restored last search, or a manual pick.
  useEffect(() => {
    if (chipResolvedRef.current) return
    if (initialChipIdx === undefined || initialChipIdx < 0 || initialChipIdx >= CHIPS.length) return
    setSelectedIdx(initialChipIdx)
    selectedIdxRef.current = initialChipIdx
    chipResolvedRef.current = true
  }, [initialChipIdx])

  // Auto-trigger geolocation when starting in "nearby" mode — but NOT for a
  // first-time visitor (the welcome screen must stay until they interact).
  //
  // We read the first-visit state DIRECTLY from localStorage here rather than
  // from the isFirstVisit-derived `skipAutoLocate` prop. That prop is racy: the
  // #418 hydration fix initialises isFirstVisit=false and corrects it to true in
  // a useLayoutEffect, but React flushes this passive mount effect BEFORE that
  // correction's re-render settles — so any prop/ref read here still sees the
  // stale `false`. localStorage is the ground truth, client-side and timing-
  // independent. (Invisible on web with slow browser GPS; obvious on native.)
  useEffect(() => {
    const isFirstVisit = (() => {
      try { return !localStorage.getItem("ap_visited") && !localStorage.getItem("ap_welcome_dismissed") }
      catch { return false }
    })()
    // Effective startup mode. `initialMode` is racy on the iOS standalone PWA:
    // it derives from chatMode, which is seeded via a synchronous loadSettings()
    // in a useLayoutEffect that returns the default ("nearby") when localStorage
    // is not yet readable at layout-effect time — so a saved "text" preference
    // would arrive too late and this effect would wrongly auto-locate. Like the
    // isFirstVisit read above, localStorage is the ground truth at passive-effect
    // time. initialMode === "text" is never the stale value (the stale default is
    // always "nearby"), so we trust it as an override (SEO deep-link); otherwise
    // we read the resolved preference directly.
    const effectiveMode = initialMode === "text"
      ? "text"
      : (loadSettings().defaultSearchMode ?? "nearby")
    if (!isFirstVisit && effectiveMode === "nearby") {
      onModeChange?.("nearby")
      handleLocate()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Stop watchPosition on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        clearWatchPosition(watchIdRef.current)
      }
    }
  }, [])

  // Show attention pulse only on the very first page visit
  useEffect(() => {
    const key = "ap_first_visit"
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, "1")
      setInputPulse(true)
    }
  }, [])

  // Keep ref pointing at latest handleLocate to avoid stale closure in the trigger effect
  useEffect(() => { handleLocateRef.current = handleLocate })
  useEffect(() => { localeRef.current = locale })

  // Fire locate when the parent bumps locateTrigger (e.g. welcome-screen dismiss)
  useEffect(() => {
    if (!locateTrigger) return
    setMode("nearby")
    onModeChange?.("nearby")
    handleLocateRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateTrigger])


  // Fetch unified autocomplete suggestions (areas + venues, Photon via backend proxy)
  useEffect(() => {
    // Skip fetch for programmatically set values (restore / suggestion pick) —
    // stays suppressed across re-renders until the user actually edits the field.
    if (programmaticLocRef.current && location === programmaticLocRef.current) return

    // Autocomplete on the non-quoted part of the input
    const query = location.replace(QUOTE_STRIP_RE, "").trim()

    if (query.length < 2) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    clearTimeout(debounceRef.current)
    suggestAbortRef.current?.abort()
    debounceRef.current = setTimeout(async () => {
      const ac = new AbortController()
      suggestAbortRef.current = ac
      try {
        const bias = biasCoords ? `&lat=${biasCoords.lat}&lon=${biasCoords.lon}` : ""
        const intlParam = international ? "&intl=1" : ""
        const res = await fetch(`/api/geocode/unified-suggest?q=${encodeURIComponent(query)}&lang=${locale}${bias}${intlParam}`, { signal: ac.signal })
        if (!res.ok) return
        const data: UnifiedSuggestion[] = await res.json()
        setSuggestions(data)
        setShowSuggestions(data.length > 0)
        setHighlightedIdx(-1)
      } catch { /* ignore — covers AbortError and network errors */ }
    }, 300)

    return () => {
      clearTimeout(debounceRef.current)
      suggestAbortRef.current?.abort()
    }
  }, [location, locale, biasCoords?.lat, biasCoords?.lon, international])

  function clearPickState() {
    programmaticLocRef.current = ""
    pickedVenueRef.current = null
    setVenuePicked(false)
  }

  function chipLabel(idx: number | null, loc: string = locale): string | null {
    if (idx === null) return null
    return loc === "de" ? CHIPS[idx].de : CHIPS[idx].en
  }

  // Query for a coordinates-backed nearby search. With no chip, "in <district>"
  // keeps parseQuery on the all-categories path (the location part must not
  // trigger category hints — e.g. the city "Essen"); the no-district fallback
  // is a neutral non-empty string (the route rejects empty queries).
  function nearbyQuery(label: string | null, district: string): string {
    if (label) return district ? `${label} in ${district}` : label
    if (district) return `in ${district}`
    return localeRef.current === "de" ? "Orte in der Nähe" : "places nearby"
  }

  // Category-only query for the map's "search here" when no search has run yet.
  // Coordinates from the pan are passed alongside, so the location part is ignored
  // by the route — only the category is parsed out. Null chip → all categories
  // (a neutral non-empty word that matches no category hint; route rejects empty).
  function categoryQuery(label: string | null): string {
    return label ?? (localeRef.current === "de" ? "Orte" : "places")
  }

  // Keep the parent's "search here" query in sync with the visible chip selection.
  useEffect(() => {
    onCategoryQueryChange?.(categoryQuery(chipLabel(selectedIdx)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx, locale])

  function switchMode(next: Mode) {
    clearPickState()
    setMode(next)
    onModeChange?.(next)
    setSuggestions([])
    setShowSuggestions(false)
    if (next !== "nearby") {
      if (watchIdRef.current !== null) {
        clearWatchPosition(watchIdRef.current)
        watchIdRef.current = null
      }
      return
    }
    // Always fetch a fresh fix on entering nearby mode. Reusing the cached
    // nearbyPhase coords here re-ran the search at an arbitrarily old position
    // ("I see an old location"); handleLocate re-locates, calls onGpsResolved
    // (so the dot is fresh too) and searches at the current coords.
    handleLocate()
  }

  function selectChip(idx: number | null) {
    chipResolvedRef.current = true
    setSelectedIdx(idx)
    selectedIdxRef.current = idx
    const label = chipLabel(idx)
    if (mode === "nearby" && typeof nearbyPhase === "object") {
      onSearch(nearbyQuery(label, nearbyPhase.district), { lat: nearbyPhase.lat, lon: nearbyPhase.lon })
      return
    }
    // Picking a category while a specific venue is active exits the venue lookup
    // and runs a category search around the venue's coordinates ("cafés near the
    // Philharmonie"). We deliberately do NOT call clearPickState(): leaving
    // programmaticLocRef === location keeps the autocomplete dropdown suppressed
    // until the user actually edits the field. If we have no coordinates (e.g. the
    // venue search 404'd), fall through to the location-based branches below.
    if (mode === "text" && venuePicked) {
      pickedVenueRef.current = null
      setVenuePicked(false)
      setSuggestions([])
      setShowSuggestions(false)
      if (activeSearchCoords) {
        onSearch(categoryQuery(label), activeSearchCoords)
        return
      }
    }
    if (mode === "text" && !pickedVenueRef.current && activeSearchCoords) {
      // Current results came from a coordinate-based search ("search here" /
      // nearby) — refine THIS area with the new category instead of jumping to
      // the location textbox, which may show an unrelated, stale place.
      setSuggestions([])
      setShowSuggestions(false)
      onSearch(categoryQuery(label), activeSearchCoords)
    } else if (mode === "text" && !pickedVenueRef.current && locationPart(location)) {
      setSuggestions([])
      setShowSuggestions(false)
      const quoted = extractQuotedName(location)
      const locPart = locationPart(location)
      // "in <loc>" (not raw) so a re-fired all-categories search never re-parses
      // category terms out of what is known to be a location string.
      onSearch(label ? `${label} in ${locPart}` : `in ${locPart}`, undefined, quoted || undefined)
    }
  }

  function buildQuery(loc: string) {
    const label = chipLabel(selectedIdx)
    // No chip → send the raw text; parseQuery scopes categories from the part
    // before "in" ("Sushi in Berlin") or falls back to all categories.
    if (!label) return loc.trim()
    return loc.trim() ? `${label} in ${loc.trim()}` : label
  }

  function submit() {
    if (isLoading) return
    clearTimeout(debounceRef.current)
    suggestAbortRef.current?.abort()
    if (location.trim().toLowerCase() === "accessible places") {
      setShowDevConsole(true)
      setLocation("")
      return
    }
    if (!location.trim()) return
    setSuggestions([])
    setShowSuggestions(false)
    // Suppress the suggestions effect from re-firing when biasCoords changes
    // after the search completes (searchCenter updates → biasCoords dep changes
    // → effect re-runs with the same input text → dropdown reappears).
    programmaticLocRef.current = location.trim()

    // Input still holds a picked venue → re-run the place search for it.
    const picked = pickedVenueRef.current
    if (picked && location.trim() === picked.display) {
      const coords = picked.lat != null && picked.lon != null ? { lat: picked.lat, lon: picked.lon } : undefined
      onPlaceSearch?.(picked.name, coords)
      return
    }

    const quoted = extractQuotedName(location)
    const rest   = locationPart(location)
    if (!rest) {
      // Only a quoted name, no location → search the venue by name.
      if (quoted) onPlaceSearch?.(quoted)
      return
    }
    // Default for raw free text: area search (conservative — never silently
    // routes typed text to a venue lookup; venues are reached via the dropdown).
    try { localStorage.setItem("ap_last_search", JSON.stringify({ idx: selectedIdx, loc: location.trim() })) } catch { /* ignore */ }
    onSearch(buildQuery(rest), undefined, quoted || undefined)
  }

  function selectSuggestion(s: UnifiedSuggestion) {
    setSuggestions([])
    setShowSuggestions(false)
    setHighlightedIdx(-1)
    track("suggest_pick", { kind: s.kind })

    if (s.kind === "venue") {
      programmaticLocRef.current = s.display
      pickedVenueRef.current = { display: s.display, name: s.name, lat: s.lat, lon: s.lon }
      setVenuePicked(true)
      setLocation(s.display)
      const coords = s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : undefined
      onPlaceSearch?.(s.name, coords)
      return
    }

    // Area pick — preserve a quoted name filter the user already typed.
    const quoted      = extractQuotedName(location)
    const newLocation = quoted ? `"${quoted}" in ${s.display}` : s.display
    programmaticLocRef.current = newLocation
    pickedVenueRef.current = null
    setVenuePicked(false)
    setLocation(newLocation)
    try { localStorage.setItem("ap_last_search", JSON.stringify({ idx: selectedIdx, loc: newLocation.trim() })) } catch { /* ignore */ }
    // A picked area is known to be a pure location — "in <display>" keeps an
    // all-categories search from re-parsing category terms out of city names.
    onSearch(selectedIdx === null ? `in ${s.display}` : buildQuery(s.display), undefined, quoted || undefined)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setHighlightedIdx((i) => Math.min(i + 1, suggestions.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setHighlightedIdx((i) => Math.max(i - 1, -1))
        return
      }
      if (e.key === "Enter") {
        e.preventDefault()
        if (highlightedIdx >= 0) selectSuggestion(suggestions[highlightedIdx])
        else submit()
        return
      }
      if (e.key === "Escape") {
        setShowSuggestions(false)
        setHighlightedIdx(-1)
        return
      }
    }
    if (e.key === "Enter") {
      // Easter Egg #5: trigger DevConsole on Enter, not on every keystroke —
      // on mobile the keyboard is still open when typing, so we wait for Enter.
      if (location.trim().toLowerCase() === "accessible places") {
        setShowDevConsole(true)
        setLocation("")
        return
      }
      submit()
    }
  }

  function handleLocate() {
    if (locatingRef.current) return
    if (!isGeolocationAvailable()) { setNearbyPhase("error"); return }
    locatingRef.current = true
    setNearbyPhase("locating")
    getCurrentPosition({ timeout: 30_000, enableHighAccuracy: false, maximumAge: 60_000 })
      .then(async ({ lat, lon }) => {
        locatingRef.current = false
        try {
          const d = await reverseGeocode(lat, lon)
          setNearbyPhase({ district: d, lat, lon })
          onGpsResolved?.({ lat, lon })
          // Read locale from a ref so a fix that arrives after the user switched
          // language still uses the current value.
          const label = chipLabel(selectedIdxRef.current, localeRef.current)
          onSearch(nearbyQuery(label, d), { lat, lon })
        } catch {
          setNearbyPhase("error")
        }
        // Silently track position changes after the initial fix. Uses the native
        // plugin in the app (permission already granted by getCurrentPosition, so
        // no second OS dialog) and navigator.geolocation in the browser.
        if (watchIdRef.current !== null) clearWatchPosition(watchIdRef.current)
        watchPosition(
          ({ lat: wlat, lon: wlon }) => {
            setNearbyPhase((prev) =>
              typeof prev === "object" ? { ...prev, lat: wlat, lon: wlon } : prev
            )
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 30_000 },
        ).then((id) => { watchIdRef.current = id })
      })
      .catch((err) => {
        locatingRef.current = false
        setNearbyPhase("error")
        const msg = (err as { message?: string; code?: number }).message ?? String(err)
        console.error("[geolocation] error", msg)
      })
  }

  // Index of the first suggestion of each kind — used to emit the group header rows.
  const firstAreaIdx  = suggestions.findIndex((s) => s.kind === "area")
  const firstVenueIdx = suggestions.findIndex((s) => s.kind === "venue")

  return (
    <>
    {showDevConsole && <DevConsole onClose={() => setShowDevConsole(false)} />}
    <div className="flex flex-col gap-3 p-4 border-b border-border bg-card relative z-20">

      {/* ── Mode selector ── */}
      {isMobile ? (
        <div className="flex rounded-md overflow-hidden border border-border">
          {(["nearby", "text"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 py-2.5 relative transition-colors border-r border-border last:border-r-0 cursor-pointer",
                mode === m
                  ? "bg-primary/10 text-primary-strong"
                  : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {m === "nearby" && <LocateFixed className="w-[1.125rem] h-[1.125rem]" />}
              {m === "text"   && <Search      className="w-[1.125rem] h-[1.125rem]" />}
              <span className="text-xs font-medium leading-none flex items-center gap-1">
                {m === "text"   && t.chat.modeText}
                {m === "nearby" && t.chat.modeNearby}
                {m === "nearby" && (
                  <span className={cn("inline-block w-1.5 h-1.5 rounded-full", hasGpsCoords ? "bg-green-500" : "bg-muted-foreground/30")} />
                )}
              </span>
              {mode === m && <span className="absolute bottom-0 inset-x-0 h-0.5 bg-primary" />}
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {(["nearby", "text"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border py-2 px-2 transition-colors cursor-pointer",
                mode === m
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {m === "nearby" && <LocateFixed className="w-5 h-5" />}
              {m === "text"   && <Search      className="w-5 h-5" />}
              <span className="text-sm font-semibold leading-tight flex items-center gap-1">
                {m === "text"   && t.chat.modeText}
                {m === "nearby" && t.chat.modeNearby}
                {m === "nearby" && (
                  <span className={cn("inline-block w-1.5 h-1.5 rounded-full", hasGpsCoords ? "bg-green-400" : "bg-white/30")} />
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ── Text search mode ── */}
      {mode === "text" && (
        <>
        <div className="flex gap-2 items-center">
          {/* Unified search input — areas, venues, and quoted name filters */}
          <div className="relative flex-1">
            {inputPulse && (
              <span
                className="absolute inset-0 rounded-md ring-2 ring-primary animate-pulse pointer-events-none"
                style={{ animationIterationCount: 2 }}
                onAnimationEnd={() => setInputPulse(false)}
                aria-hidden
              />
            )}
            {venuePicked && (
              <MapPin
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none"
                aria-hidden
              />
            )}
            <input
              ref={inputRef}
              value={location}
              onChange={(e) => { clearPickState(); setLocation(e.target.value); setHighlightedIdx(-1) }}
              onKeyDown={handleKeyDown}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              placeholder={t.chat.unifiedPlaceholder}
              disabled={isLoading}
              autoFocus={autoFocus}
              role="combobox"
              aria-expanded={showSuggestions && suggestions.length > 0}
              aria-controls="unified-suggest-list"
              aria-autocomplete="list"
              aria-activedescendant={highlightedIdx >= 0 ? `unified-opt-${highlightedIdx}` : undefined}
              className={cn(
                "w-full rounded-md border bg-background px-3 py-2 text-sm h-[38px]",
                "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1",
                "focus-visible:ring-ring disabled:opacity-50",
                isMobile ? "border-primary" : "border-input",
                location ? "pr-7" : "",
                venuePicked ? "pl-8" : "",
              )}
            />
            {location && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  clearPickState()
                  setLocation("")
                  setSuggestions([])
                  setShowSuggestions(false)
                  try { localStorage.removeItem("ap_last_search") } catch { /* ignore */ }
                  inputRef.current?.focus()
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Grouped autocomplete dropdown: areas first, then venues */}
            {showSuggestions && suggestions.length > 0 && (
              <ul
                role="listbox"
                id="unified-suggest-list"
                className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-lg overflow-hidden"
              >
                {suggestions.map((s, i) => {
                  const commaIdx = s.display.indexOf(",")
                  const splitAt  = commaIdx !== -1 ? commaIdx : s.display.lastIndexOf(" (")
                  const bold     = splitAt !== -1 ? s.display.slice(0, splitAt) : s.display
                  const rest     = splitAt !== -1 ? s.display.slice(splitAt)    : ""
                  return (
                    <Fragment key={`${s.kind}-${s.display}`}>
                      {i === firstAreaIdx && (
                        <li role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground select-none">
                          {t.chat.suggestGroupAreas}
                        </li>
                      )}
                      {i === firstVenueIdx && (
                        <li role="presentation" className={cn(
                          "px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground select-none",
                          firstVenueIdx > 0 && "border-t border-border",
                        )}>
                          {t.chat.suggestGroupVenues}
                        </li>
                      )}
                      <li
                        id={`unified-opt-${i}`}
                        role="option"
                        aria-selected={i === highlightedIdx}
                        onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s) }}
                        className={cn(
                          "px-3 py-2 text-sm cursor-pointer transition-colors",
                          i === highlightedIdx
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-muted",
                        )}
                      >
                        {s.kind === "venue" ? (
                          <span className="flex items-center gap-2">
                            <PlaceCategoryIcon osmKey={s.osmKey} osmValue={s.osmValue} />
                            <span>
                              <span className="font-semibold">{bold}</span>{rest}
                            </span>
                          </span>
                        ) : (
                          <span>
                            <span className="font-semibold">{bold}</span>{rest}
                          </span>
                        )}
                      </li>
                    </Fragment>
                  )
                })}
              </ul>
            )}
          </div>

          <Button
            onClick={submit}
            disabled={isLoading || !location.trim()}
            size="sm"
            className="shrink-0 relative overflow-hidden"
          >
            {isLoading && (
              <span
                className="absolute inset-y-0 left-0 pointer-events-none"
                style={{ width: 0, background: "rgba(255,255,255,0.45)", animation: "btn-progress 30s linear forwards" }}
                aria-hidden
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {isLoading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />
              }
              {isLoading ? t.chat.thinking : t.chat.send}
            </span>
          </Button>
        </div>

        </>
      )}

      {/* ── Nearby mode ── */}
      {mode === "nearby" && (
        <>
          {nearbyPhase === "idle" && !skipAutoLocate && (
            <Button onClick={handleLocate} disabled={isLoading} variant="outline" className="w-full gap-2">
              <LocateFixed className="w-4 h-4" />
              {t.chat.locateButton}
            </Button>
          )}

          {nearbyPhase === "locating" && (
            <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t.chat.locateButton} …
            </div>
          )}

          {nearbyPhase === "error" && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-destructive">{t.chat.locationError}</p>
              <Button variant="outline" size="sm" onClick={handleLocate}>
                <LocateFixed className="w-3.5 h-3.5 mr-1.5" />
                {t.chat.locateButton}
              </Button>
            </div>
          )}

          {(district !== null || (onToggleFocusLayer && typeof nearbyPhase === "object")) && (
            <div className="flex items-center gap-2 min-w-0">
              {district !== null && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
                  <LocateFixed className="w-3 h-3 shrink-0 text-primary" />
                  <span className="text-primary font-medium truncate">{t.chat.nearbyIn(district)}</span>
                </p>
              )}
              {typeof nearbyPhase === "object" && onToggleFocusLayer && (
                <div className="ml-auto flex flex-col items-end gap-1 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground mr-0.5">{t.chat.focusLabel}</span>
                    <div className="flex items-center gap-1" role="radiogroup">
                    {([
                      { type: "parking" as const, icon: "🅿", label: t.chat.focusChipParking, activeCls: "bg-blue-600  text-white border-blue-600"  },
                      { type: "toilet"  as const, icon: "🚻", label: t.chat.focusChipToilet,  activeCls: "bg-green-700 text-white border-green-700" },
                    ]).map(({ type, icon, label, activeCls }) => {
                      const active  = focusLayers?.has(type) ?? false
                      const loading = focusLoadingLayer === type
                      return (
                        <button
                          key={type}
                          onClick={() => onToggleFocusLayer(type)}
                          disabled={loading}
                          role="radio"
                          aria-checked={active}
                          className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-wait ${active ? activeCls : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                        >
                          {loading
                            ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                            : <span aria-hidden>{icon}</span>
                          }
                          <span>{label}</span>
                        </button>
                      )
                    })}
                    </div>
                    {focusLayers?.size ? (
                      <button
                        onClick={() => {
                          const active = focusLayers.values().next().value as AmenityType
                          onToggleFocusLayer(active)
                        }}
                        className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-foreground bg-background hover:bg-muted transition-colors"
                      >
                        <X className="w-3 h-3" aria-hidden />
                        <span>{t.chat.focusExit}</span>
                      </button>
                    ) : null}
                  </div>
                  {(focusHints?.parking || focusHints?.toilet) && (
                    <div className="flex flex-col items-end">
                      {focusHints?.parking && <p className="text-[11px] text-amber-600">{focusHints.parking}</p>}
                      {focusHints?.toilet  && <p className="text-[11px] text-amber-600">{focusHints.toilet}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </>
      )}

      {/* ── Category chip strip — both modes, hidden during amenity focus ── */}
      {!(focusLayers?.size) && (
        <div className="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] -mx-4 px-4">
          <button
            key="all"
            onClick={() => selectChip(null)}
            disabled={isLoading}
            className={cn(
              "shrink-0 text-xs px-2.5 py-1.5 rounded-full font-medium transition-colors whitespace-nowrap disabled:opacity-50",
              selectedIdx === null
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
            )}
          >
            {t.chat.chipAll}
          </button>
          {CHIPS.map((chip, idx) => (
            <button
              key={chip.de}
              onClick={() => selectChip(idx)}
              disabled={isLoading}
              className={cn(
                "shrink-0 text-xs px-2.5 py-1.5 rounded-full font-medium transition-colors whitespace-nowrap disabled:opacity-50",
                idx === selectedIdx
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
              )}
            >
              {chip.icon} {locale === "de" ? chip.de : chip.en}
            </button>
          ))}
        </div>
      )}

    </div>
    </>
  )
}
