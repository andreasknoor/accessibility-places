"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Loader2, LocateFixed, Compass, X, Building2, Coffee, UtensilsCrossed, Beer, BookOpen, Hotel, Landmark, Film, Library, GalleryHorizontal, Star, IceCream, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations, useLocale } from "@/lib/i18n"
import { useIsMobile } from "@/hooks/useIsMobile"
import { cn } from "@/lib/utils"

type Coords = { lat: number; lon: number }

interface Props {
  onSearch:          (query: string, coords?: Coords, nameHint?: string) => void
  onPlaceSearch?:    (nameHint: string, coords?: Coords) => void
  isLoading:         boolean
  onModeChange?:     (mode: "text" | "nearby" | "place") => void
  autoFocus?:        boolean
  initialLocation?:  string
  initialChipIdx?:   number
  initialMode?:      "text" | "nearby" | "place"
  onGpsResolved?:    (coords: Coords) => void
  skipAutoLocate?:   boolean
  hasGpsCoords?:     boolean
  locateTrigger?:    number
  biasCoords?:       Coords
  // Parkplatz-Modus toggle in the nearby-info row.
  parkingFocusMode?:        boolean
  onToggleParkingFocus?:    () => void
  isParkingFocusLoading?:   boolean
  parkingFocusHint?:        string | null
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

type Mode        = "text" | "nearby" | "place"
type NearbyPhase = "idle" | "locating" | { district: string; lat: number; lon: number } | "error"

type Suggestion = { display: string; name: string }

type PlaceSuggestion = Suggestion & { lat: number | null; lon: number | null; osmKey: string | null; osmValue: string | null }

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

export default function ChatPanel({ onSearch, onPlaceSearch, isLoading, onModeChange, autoFocus, initialLocation, initialChipIdx, initialMode, onGpsResolved, skipAutoLocate, hasGpsCoords, locateTrigger, biasCoords, parkingFocusMode, onToggleParkingFocus, isParkingFocusLoading, parkingFocusHint }: Props) {
  const t = useTranslations()
  const { locale } = useLocale()
  const isMobile = useIsMobile()
  const [mode,           setMode]           = useState<Mode>(initialMode ?? "nearby")
  const [nearbyPhase,    setNearbyPhase]    = useState<NearbyPhase>("idle")
  const [location,       setLocation]       = useState("")
  const [name,           setName]           = useState("")
  const [showNameField,  setShowNameField]  = useState(false)
  const [selectedIdx,    setSelectedIdx]    = useState(0)
  const [suggestions,    setSuggestions]    = useState<Suggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightedIdx, setHighlightedIdx] = useState(-1)
  const [inputPulse,         setInputPulse]         = useState(false)
  const [nameSuggestions,    setNameSuggestions]    = useState<PlaceSuggestion[]>([])
  const [showNameSuggestions, setShowNameSuggestions] = useState(false)
  const [nameHighlightedIdx,  setNameHighlightedIdx]  = useState(-1)
  const selectedIdxRef       = useRef(0)
  const debounceRef          = useRef<ReturnType<typeof setTimeout>>(undefined)
  const suggestAbortRef      = useRef<AbortController>(undefined)
  const nameDebounceRef      = useRef<ReturnType<typeof setTimeout>>(undefined)
  const nameAbortRef         = useRef<AbortController>(undefined)
  // Holds the place-name set programmatically by selecting a name suggestion.
  // Name autocomplete is suppressed while `name` equals this value — this
  // survives the biasCoords/locale re-renders that fire after the place search
  // completes (setSearchCenter → biasCoords change), which a one-shot flag would
  // miss, causing the dropdown to re-open. Cleared when the user types. Same
  // rationale as restoredLocRef for the location field.
  const selectedNameRef      = useRef("")
  const skipSuggestRef       = useRef(false)
  const locatingRef          = useRef(false)
  const watchIdRef           = useRef<number | null>(null)
  // Holds the location value that was set programmatically on restore.
  // Autocomplete is suppressed as long as location equals this value —
  // survives locale re-renders that would otherwise consume the one-shot
  // skipSuggestRef too early. Cleared when the user types.
  const restoredLocRef    = useRef("")
  const inputRef          = useRef<HTMLInputElement>(null)
  const handleLocateRef   = useRef<() => void>(() => {})
  // Refs mirror `name` and `locale` so async callbacks in handleLocate (GPS success,
  // watchPosition) read the current value rather than the closure-captured snapshot.
  const nameRef           = useRef("")
  const localeRef         = useRef(locale)

  const district = typeof nearbyPhase === "object" ? nearbyPhase.district : null

  // Restore last search on mount (chip + location, never nearby mode).
  // URL-derived initialLocation takes priority over localStorage.
  useEffect(() => {
    if (initialLocation) {
      restoredLocRef.current = initialLocation
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
          restoredLocRef.current = loc
          setLocation(loc)
        }
      } else {
        applyDefaultChip()
      }
    } catch { applyDefaultChip() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-trigger geolocation when the effective start mode is "nearby"
  // (either an explicit prop or the default when no preference is saved)
  useEffect(() => {
    if (!skipAutoLocate && (initialMode ?? "nearby") === "nearby") {
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

  // Keep mirrors of name/locale in refs so the async GPS callbacks read live values.
  useEffect(() => { nameRef.current = name })
  useEffect(() => { localeRef.current = locale })

  // Fire locate when the parent bumps locateTrigger (e.g. welcome-screen dismiss)
  useEffect(() => {
    if (!locateTrigger) return
    setMode("nearby")
    onModeChange?.("nearby")
    handleLocateRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateTrigger])

  // Fetch location autocomplete suggestions (Photon via backend proxy)
  useEffect(() => {
    // Skip fetch when location was set by selecting a suggestion (not by the user typing)
    if (skipSuggestRef.current) {
      skipSuggestRef.current = false
      return
    }
    // Skip fetch for the restored value — stays suppressed across locale
    // re-renders until the user actually modifies the field.
    if (restoredLocRef.current && location === restoredLocRef.current) return

    // Autocomplete on the non-quoted part of the input
    const query = location.replace(/["'„""‟"«»‹›][^"'„""‟"«»‹›]*["'„""‟"«»‹›]?/gu, "").trim()

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
        const res = await fetch(`/api/geocode/suggest?q=${encodeURIComponent(query)}&lang=${locale}`, { signal: ac.signal })
        if (!res.ok) return
        const data: Suggestion[] = await res.json()
        setSuggestions(data)
        setShowSuggestions(data.length > 0)
        setHighlightedIdx(-1)
      } catch { /* ignore — covers AbortError and network errors */ }
    }, 300)

    return () => {
      clearTimeout(debounceRef.current)
      suggestAbortRef.current?.abort()
    }
  }, [location, locale])

  // Fetch place-name suggestions — only active in "place" mode; in text mode the
  // name field is a filter and Photon autocomplete would be confusing/redundant.
  useEffect(() => {
    // Suppress while name matches a just-selected suggestion — survives the
    // biasCoords re-render fired by setSearchCenter after the search completes.
    if (name && name === selectedNameRef.current) {
      setNameSuggestions([])
      setShowNameSuggestions(false)
      return
    }
    if (mode !== "place" || location.trim() || name.length < 2) {
      setNameSuggestions([])
      setShowNameSuggestions(false)
      return
    }
    clearTimeout(nameDebounceRef.current)
    nameAbortRef.current?.abort()
    nameDebounceRef.current = setTimeout(async () => {
      const ac = new AbortController()
      nameAbortRef.current = ac
      try {
        const bias = biasCoords ? `&lat=${biasCoords.lat}&lon=${biasCoords.lon}` : ""
        const res = await fetch(`/api/geocode/place-suggest?q=${encodeURIComponent(name)}&lang=${locale}${bias}`, { signal: ac.signal })
        if (!res.ok) return
        const data = await res.json()
        setNameSuggestions(data)
        setShowNameSuggestions(data.length > 0)
        setNameHighlightedIdx(-1)
      } catch { /* AbortError or network error */ }
    }, 300)
    return () => {
      clearTimeout(nameDebounceRef.current)
      nameAbortRef.current?.abort()
    }
  }, [name, location, locale, mode, biasCoords?.lat, biasCoords?.lon])

  function switchMode(next: Mode) {
    setMode(next)
    onModeChange?.(next)
    setShowNameField(false)
    setName("")
    selectedNameRef.current = ""
    setNameSuggestions([])
    setShowNameSuggestions(false)
    if (next !== "nearby") {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
    if (next === "place") {
      // Clear location so name-suggest fires unconditionally in place mode
      setLocation("")
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    if (next !== "nearby") return
    if (nearbyPhase === "idle") {
      handleLocate()
    } else if (typeof nearbyPhase === "object") {
      const label = locale === "de" ? CHIPS[selectedIdx].de : CHIPS[selectedIdx].en
      onSearch(`${label} in ${nearbyPhase.district}`, { lat: nearbyPhase.lat, lon: nearbyPhase.lon }, name.trim() || undefined)
    }
  }

  function selectChip(idx: number) {
    setSelectedIdx(idx)
    selectedIdxRef.current = idx
    const label = locale === "de" ? CHIPS[idx].de : CHIPS[idx].en
    if (mode === "nearby" && typeof nearbyPhase === "object") {
      onSearch(`${label} in ${nearbyPhase.district}`, { lat: nearbyPhase.lat, lon: nearbyPhase.lon }, name.trim() || undefined)
    } else if (mode === "text" && location.trim()) {
      setSuggestions([])
      setShowSuggestions(false)
      onSearch(`${label} in ${location.trim()}`, undefined, name.trim() || undefined)
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
    clearTimeout(nameDebounceRef.current)
    nameAbortRef.current?.abort()
    if (mode === "place") {
      setNameSuggestions([])
      setShowNameSuggestions(false)
      if (name.trim()) onPlaceSearch?.(name.trim())
      return
    }
    if (!location.trim()) {
      if (name.trim()) onPlaceSearch?.(name.trim())
      return
    }
    setSuggestions([])
    setShowSuggestions(false)
    try { localStorage.setItem("ap_last_search", JSON.stringify({ idx: selectedIdx, loc: location.trim() })) } catch { /* ignore */ }
    onSearch(buildQuery(location), undefined, name.trim() || undefined)
  }

  function selectNameSuggestion(s: { display: string; name: string; lat: number | null; lon: number | null }) {
    selectedNameRef.current = s.name
    setName(s.name)
    setNameSuggestions([])
    setShowNameSuggestions(false)
    setNameHighlightedIdx(-1)
    const coords = s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : undefined
    onPlaceSearch?.(s.name, coords)
  }

  function selectSuggestion(s: Suggestion) {
    const newLocation = s.display
    skipSuggestRef.current = true
    setLocation(newLocation)
    setSuggestions([])
    setShowSuggestions(false)
    setHighlightedIdx(-1)
    try { localStorage.setItem("ap_last_search", JSON.stringify({ idx: selectedIdx, loc: newLocation.trim() })) } catch { /* ignore */ }
    onSearch(buildQuery(newLocation), undefined, name.trim() || undefined)
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
    if (e.key === "Enter") submit()
  }

  function handleLocate() {
    if (locatingRef.current) return
    if (!("geolocation" in navigator)) { setNearbyPhase("error"); return }
    locatingRef.current = true
    setNearbyPhase("locating")
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        locatingRef.current = false
        const { latitude: lat, longitude: lon } = pos.coords
        try {
          const d = await reverseGeocode(lat, lon)
          setNearbyPhase({ district: d, lat, lon })
          onGpsResolved?.({ lat, lon })
          const chip = CHIPS[selectedIdxRef.current]
          // Read locale/name from refs so a fix that arrives after the user typed
          // or switched language still uses the current values.
          const label = localeRef.current === "de" ? chip.de : chip.en
          const nameHint = nameRef.current.trim() || undefined
          onSearch(d ? `${label} in ${d}` : label, { lat, lon }, nameHint)
        } catch {
          setNearbyPhase("error")
        }
        // Silently track position changes after the initial fix
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
      },
      () => { locatingRef.current = false; setNearbyPhase("error") },
      { timeout: 10_000, enableHighAccuracy: true },
    )
  }

  return (
    <div className="flex flex-col gap-3 p-4 border-b border-border bg-card relative z-20">

      {/* ── Mode selector ── */}
      {isMobile ? (
        <div className="flex rounded-md overflow-hidden border border-border">
          {(["nearby", "text", "place"] as Mode[]).map((m) => (
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
              {m === "place"  && <Building2   className="w-[1.125rem] h-[1.125rem]" />}
              <span className="text-xs font-medium leading-none flex items-center gap-1">
                {m === "text"   && t.chat.modeText}
                {m === "nearby" && t.chat.modeNearby}
                {m === "place"  && t.chat.modePlace}
                {m === "nearby" && (
                  <span className={cn("inline-block w-1.5 h-1.5 rounded-full", hasGpsCoords ? "bg-green-500" : "bg-muted-foreground/30")} />
                )}
              </span>
              {mode === m && <span className="absolute bottom-0 inset-x-0 h-0.5 bg-primary" />}
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {(["nearby", "text", "place"] as Mode[]).map((m) => (
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
              {m === "place"  && <Building2   className="w-5 h-5" />}
              <span className="text-sm font-semibold leading-tight flex items-center gap-1">
                {m === "text"   && t.chat.modeText}
                {m === "nearby" && t.chat.modeNearby}
                {m === "place"  && t.chat.modePlace}
                {m === "nearby" && (
                  <span className={cn("inline-block w-1.5 h-1.5 rounded-full", hasGpsCoords ? "bg-green-400" : "bg-white/30")} />
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ── Category chip strip — hidden in place mode ── */}
      {mode !== "place" && (
        <div className="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] -mx-4 px-4">
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

      {/* ── Text search mode ── */}
      {mode === "text" && (
        <>
        <div className="flex gap-2 items-center">
          {/* Location input */}
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
              onChange={(e) => { restoredLocRef.current = ""; setLocation(e.target.value); setHighlightedIdx(-1) }}
              onKeyDown={handleKeyDown}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              placeholder={t.chat.locationPlaceholder}
              disabled={isLoading}
              autoFocus={autoFocus}
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

            {/* Autocomplete dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <ul
                role="listbox"
                className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-lg overflow-hidden"
              >
                {suggestions.map((s, i) => {
                  const commaIdx = s.display.indexOf(",")
                  const splitAt  = commaIdx !== -1 ? commaIdx : s.display.lastIndexOf(" (")
                  const bold     = splitAt !== -1 ? s.display.slice(0, splitAt) : s.display
                  const rest     = splitAt !== -1 ? s.display.slice(splitAt)    : ""
                  return (
                    <li
                      key={s.display}
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
                      <span className="font-semibold">{bold}</span>{rest}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Name input — desktop: inline flex-1 alongside location, behind toggle */}
          {!isMobile && showNameField && (
            <div className="relative flex-1">
              <input
                value={name}
                onChange={(e) => { setName(e.target.value) }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return
                  if (!location.trim() && name.trim()) onPlaceSearch?.(name.trim())
                  else submit()
                }}
                placeholder={t.chat.namePlaceholder}
                disabled={isLoading}
                autoFocus
                className={cn(
                  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm h-[38px]",
                  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1",
                  "focus-visible:ring-ring disabled:opacity-50",
                  name && "pr-7",
                )}
              />
              {name && (
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); setName(""); setShowNameField(false) }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={t.chat.nameToggleHide}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          <Button
            onClick={submit}
            disabled={isLoading || (!location.trim() && !name.trim())}
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

        {/* Mobile: name field behind toggle, shown as second row */}
        {isMobile && showNameField && (
          <div className="relative">
            <input
              value={name}
              onChange={(e) => { setName(e.target.value) }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return
                if (!location.trim() && name.trim()) onPlaceSearch?.(name.trim())
                else submit()
              }}
              placeholder={t.chat.namePlaceholder}
              disabled={isLoading}
              autoFocus
              className={cn(
                "w-full rounded-md border border-input bg-background px-3 py-2 text-sm h-[38px]",
                "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1",
                "focus-visible:ring-ring disabled:opacity-50",
                name && "pr-7",
              )}
            />
            {name && (
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setName(""); setShowNameField(false) }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={t.chat.nameToggleHide}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Toggle to reveal the name filter */}
        {!showNameField && (
          <button
            type="button"
            onClick={() => setShowNameField(true)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
          >
            {t.chat.nameToggleShow}
          </button>
        )}
        </>
      )}

      {/* ── Place search mode ── */}
      {mode === "place" && (
        <>
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <input
                value={name}
                onChange={(e) => { selectedNameRef.current = ""; setName(e.target.value); setNameHighlightedIdx(-1) }}
                onKeyDown={(e) => {
                  if (showNameSuggestions && nameSuggestions.length > 0) {
                    if (e.key === "ArrowDown") { e.preventDefault(); setNameHighlightedIdx((i) => Math.min(i + 1, nameSuggestions.length - 1)); return }
                    if (e.key === "ArrowUp")   { e.preventDefault(); setNameHighlightedIdx((i) => Math.max(i - 1, -1)); return }
                    if (e.key === "Escape")    { setShowNameSuggestions(false); setNameHighlightedIdx(-1); return }
                    if (e.key === "Enter") {
                      e.preventDefault()
                      if (nameHighlightedIdx >= 0) { selectNameSuggestion(nameSuggestions[nameHighlightedIdx]); return }
                    }
                  }
                  if (e.key === "Enter") submit()
                }}
                onBlur={() => setTimeout(() => setShowNameSuggestions(false), 150)}
                onFocus={() => nameSuggestions.length > 0 && setShowNameSuggestions(true)}
                placeholder={t.chat.placeModePlaceholder}
                disabled={isLoading}
                autoFocus={autoFocus}
                className={cn(
                  "w-full rounded-md border bg-background px-3 py-2 text-sm h-[38px]",
                  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1",
                  "focus-visible:ring-ring disabled:opacity-50",
                  isMobile ? "border-primary" : "border-input",
                  name && "pr-7",
                )}
              />
              {name && (
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); setName(""); setNameSuggestions([]); setShowNameSuggestions(false) }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Clear"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              {showNameSuggestions && nameSuggestions.length > 0 && (
                <ul
                  role="listbox"
                  className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-lg overflow-hidden"
                >
                  {nameSuggestions.map((s, i) => (
                    <li
                      key={s.display}
                      role="option"
                      aria-selected={i === nameHighlightedIdx}
                      onMouseDown={(e) => { e.preventDefault(); selectNameSuggestion(s) }}
                      className={cn(
                        "px-3 py-2 text-sm cursor-pointer transition-colors",
                        i === nameHighlightedIdx
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <PlaceCategoryIcon osmKey={s.osmKey} osmValue={s.osmValue} />
                        <span>
                          <span className="font-semibold">{s.name}</span>
                          {s.display !== s.name && <span className="text-muted-foreground">{s.display.slice(s.name.length)}</span>}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button
              onClick={submit}
              disabled={isLoading || !name.trim()}
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
          <p className="text-xs text-muted-foreground">{t.chat.placeSearchHint}</p>
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

          {(district !== null || (onToggleParkingFocus && typeof nearbyPhase === "object")) && (
            <div className="flex items-center gap-2 min-w-0">
              {district !== null && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
                  <LocateFixed className="w-3 h-3 shrink-0 text-primary" />
                  <span className="text-primary font-medium truncate">{t.chat.nearbyIn(district)}</span>
                </p>
              )}
              {onToggleParkingFocus && typeof nearbyPhase === "object" && (
                <div className="ml-auto flex flex-col items-end gap-0.5 shrink-0">
                  <button
                    onClick={onToggleParkingFocus}
                    disabled={isParkingFocusLoading}
                    role="switch"
                    aria-checked={parkingFocusMode}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60 disabled:cursor-wait"
                  >
                    {isParkingFocusLoading
                      ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                      : <span aria-hidden>🅿</span>
                    }
                    <span>{t.chat.parkingModeToggle}</span>
                    <span className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors ${parkingFocusMode ? "bg-blue-600" : "bg-muted-foreground/40"}`}>
                      <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${parkingFocusMode ? "translate-x-3" : "translate-x-0.5"}`} />
                    </span>
                  </button>
                  {parkingFocusHint && (
                    <p className="text-[11px] text-amber-600">{parkingFocusHint}</p>
                  )}
                </div>
              )}
            </div>
          )}

        </>
      )}

    </div>
  )
}
