"use client"

import { useState, useRef, useEffect, Fragment } from "react"
import { Send, Loader2, LocateFixed, Compass, X, Coffee, UtensilsCrossed, Beer, BookOpen, Hotel, Landmark, Film, Library, GalleryHorizontal, Star, IceCream, MapPin } from "lucide-react"
import { track } from "@vercel/analytics"
import { Button } from "@/components/ui/button"
import { useTranslations, useLocale } from "@/lib/i18n"
import { useIsMobile } from "@/hooks/useIsMobile"
import { cn } from "@/lib/utils"
import { extractQuotedName } from "@/lib/llm"
import { getCurrentPosition, isGeolocationAvailable } from "@/lib/native/geolocation"
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

export default function ChatPanel({ onSearch, onPlaceSearch, isLoading, onModeChange, autoFocus, initialLocation, initialChipIdx, initialMode, onGpsResolved, skipAutoLocate, hasGpsCoords, locateTrigger, biasCoords, focusLayers, onToggleFocusLayer, focusLoadingLayer, focusHints }: Props) {
  const t = useTranslations()
  const { locale } = useLocale()
  const isMobile = useIsMobile()
  const [mode,           setMode]           = useState<Mode>(initialMode === "place" ? "text" : (initialMode ?? "nearby"))
  const [nearbyPhase,    setNearbyPhase]    = useState<NearbyPhase>("idle")
  const [location,       setLocation]       = useState("")
  const [selectedIdx,    setSelectedIdx]    = useState(0)
  const [suggestions,    setSuggestions]    = useState<UnifiedSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightedIdx, setHighlightedIdx] = useState(-1)
  const [inputPulse,     setInputPulse]     = useState(false)
  // True while the input holds a venue picked from the dropdown — chips are
  // meaningless for a single-venue search and are greyed out until the user
  // edits the field again.
  const [venuePicked,    setVenuePicked]    = useState(false)
  const [showDevConsole, setShowDevConsole] = useState(false)
  const selectedIdxRef       = useRef(0)
  const debounceRef          = useRef<ReturnType<typeof setTimeout>>(undefined)
  const suggestAbortRef      = useRef<AbortController>(undefined)
  const locatingRef          = useRef(false)
  const watchIdRef           = useRef<number | null>(null)
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
    if (initialLocation) {
      programmaticLocRef.current = initialLocation
      setLocation(initialLocation)
      if (initialChipIdx !== undefined && initialChipIdx >= 0 && initialChipIdx < CHIPS.length) {
        setSelectedIdx(initialChipIdx)
        selectedIdxRef.current = initialChipIdx
      }
      return
    }
    const applyDefaultChip = () => {
      if (initialChipIdx !== undefined && initialChipIdx >= 0 && initialChipIdx < CHIPS.length) {
        setSelectedIdx(initialChipIdx)
        selectedIdxRef.current = initialChipIdx
      }
    }
    try {
      const saved = localStorage.getItem("ap_last_search")
      if (saved) {
        const { idx, loc } = JSON.parse(saved)
        if (typeof idx === "number" && idx >= 0 && idx < CHIPS.length) {
          setSelectedIdx(idx)
          selectedIdxRef.current = idx
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
    if (!isFirstVisit && (initialMode ?? "nearby") === "nearby") {
      onModeChange?.("nearby")
      handleLocate()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Stop watchPosition on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
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
        const res = await fetch(`/api/geocode/unified-suggest?q=${encodeURIComponent(query)}&lang=${locale}${bias}`, { signal: ac.signal })
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
  }, [location, locale, biasCoords?.lat, biasCoords?.lon])

  function clearPickState() {
    programmaticLocRef.current = ""
    pickedVenueRef.current = null
    setVenuePicked(false)
  }

  function switchMode(next: Mode) {
    setMode(next)
    onModeChange?.(next)
    setSuggestions([])
    setShowSuggestions(false)
    if (next !== "nearby") {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      return
    }
    if (nearbyPhase === "idle") {
      handleLocate()
    } else if (typeof nearbyPhase === "object") {
      const label = locale === "de" ? CHIPS[selectedIdx].de : CHIPS[selectedIdx].en
      onSearch(`${label} in ${nearbyPhase.district}`, { lat: nearbyPhase.lat, lon: nearbyPhase.lon })
    }
  }

  function selectChip(idx: number) {
    setSelectedIdx(idx)
    selectedIdxRef.current = idx
    const label = locale === "de" ? CHIPS[idx].de : CHIPS[idx].en
    if (mode === "nearby" && typeof nearbyPhase === "object") {
      onSearch(`${label} in ${nearbyPhase.district}`, { lat: nearbyPhase.lat, lon: nearbyPhase.lon })
    } else if (mode === "text" && !venuePicked && locationPart(location)) {
      setSuggestions([])
      setShowSuggestions(false)
      const quoted = extractQuotedName(location)
      onSearch(`${label} in ${locationPart(location)}`, undefined, quoted || undefined)
    }
  }

  function buildQuery(loc: string) {
    const label = locale === "de" ? CHIPS[selectedIdx].de : CHIPS[selectedIdx].en
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
    onSearch(buildQuery(s.display), undefined, quoted || undefined)
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
          const chip = CHIPS[selectedIdxRef.current]
          // Read locale from a ref so a fix that arrives after the user switched
          // language still uses the current value.
          const label = localeRef.current === "de" ? chip.de : chip.en
          onSearch(d ? `${label} in ${d}` : label, { lat, lon })
        } catch {
          setNearbyPhase("error")
        }
        // Silently track position changes after the initial fix (browser only —
        // native foreground tracking via watchPosition is fine here)
        if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = navigator.geolocation.watchPosition(
          (p) => {
            setNearbyPhase((prev) =>
              typeof prev === "object"
                ? { ...prev, lat: p.coords.latitude, lon: p.coords.longitude }
                : prev
            )
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 30_000 },
        )
      })
      .catch((err) => {
        locatingRef.current = false
        setNearbyPhase("error")
        console.error("[geolocation] error", err instanceof Error ? err.message : String(err))
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
                  ? "bg-primary/10 text-primary"
                  : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {m === "nearby" && <LocateFixed className="w-[1.125rem] h-[1.125rem]" />}
              {m === "text"   && <Compass     className="w-[1.125rem] h-[1.125rem]" />}
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
              {m === "text"   && <Compass     className="w-5 h-5" />}
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

      {/* ── Category chip strip — hidden during amenity focus ── */}
      {!(focusLayers?.size) && (
        <div className="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] -mx-4 px-4">
          {CHIPS.map((chip, idx) => (
            <button
              key={chip.de}
              onClick={() => selectChip(idx)}
              disabled={isLoading || (mode === "text" && venuePicked)}
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

      {/* ── Text search mode ── */}
      {mode === "text" && (
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

    </div>
    </>
  )
}
