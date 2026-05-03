"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Loader2, LocateFixed, MapPin, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations, useLocale } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface Props {
  onSearch:      (query: string) => void
  isLoading:     boolean
  onModeChange?: (mode: "text" | "nearby") => void
  autoFocus?:    boolean
}

const CHIPS = [
  { icon: "🍽", de: "Restaurants", en: "Restaurants"  },
  { icon: "☕", de: "Cafés",       en: "Cafés"         },
  { icon: "🏨", de: "Hotels",      en: "Hotels"        },
  { icon: "🍻", de: "Biergärten",  en: "Beer Gardens"  },
  { icon: "🍺", de: "Kneipen",     en: "Pubs"          },
  { icon: "🏛", de: "Museen",      en: "Museums"       },
  { icon: "🎭", de: "Theater",     en: "Theaters"      },
  { icon: "🎬", de: "Kinos",       en: "Cinemas"       },
  { icon: "🍦", de: "Eisdielen",   en: "Ice Cream"     },
]

type Mode        = "text" | "nearby"
type NearbyPhase = "idle" | "locating" | { district: string } | "error"

type Suggestion = { display: string; name: string }

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const res = await fetch(`/api/geocode/reverse?lat=${lat}&lon=${lon}`)
  if (!res.ok) throw new Error("reverse geocode failed")
  const data = await res.json()
  return data.district ?? ""
}

export default function ChatPanel({ onSearch, isLoading, onModeChange, autoFocus }: Props) {
  const t = useTranslations()
  const { locale } = useLocale()
  const [mode,           setMode]           = useState<Mode>("text")
  const [nearbyPhase,    setNearbyPhase]    = useState<NearbyPhase>("idle")
  const [location,       setLocation]       = useState("")
  const [selectedIdx,    setSelectedIdx]    = useState(0)
  const [suggestions,    setSuggestions]    = useState<Suggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightedIdx, setHighlightedIdx] = useState(-1)
  const [inputPulse,     setInputPulse]     = useState(false)
  const selectedIdxRef    = useRef(0)
  const debounceRef       = useRef<ReturnType<typeof setTimeout>>(undefined)
  const suggestAbortRef   = useRef<AbortController>(undefined)
  const skipSuggestRef    = useRef(false)
  const inputRef          = useRef<HTMLInputElement>(null)

  const district = typeof nearbyPhase === "object" ? nearbyPhase.district : null

  // Show attention pulse only on the very first page visit
  useEffect(() => {
    const key = "as_first_visit"
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, "1")
      setInputPulse(true)
    }
  }, [])

  // Fetch location autocomplete suggestions (Photon via backend proxy)
  useEffect(() => {
    // Skip fetch when location was set by selecting a suggestion (not by the user typing)
    if (skipSuggestRef.current) {
      skipSuggestRef.current = false
      return
    }

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

  function switchMode(next: Mode) {
    setMode(next)
    onModeChange?.(next)
    if (next !== "nearby") return
    if (nearbyPhase === "idle") {
      handleLocate()
    } else if (district) {
      // District already known — re-run search with the currently selected chip
      const label = locale === "de" ? CHIPS[selectedIdx].de : CHIPS[selectedIdx].en
      onSearch(`${label} in ${district}`)
    }
  }

  function selectChip(idx: number) {
    setSelectedIdx(idx)
    selectedIdxRef.current = idx
    if (mode === "nearby" && district) {
      const label = locale === "de" ? CHIPS[idx].de : CHIPS[idx].en
      onSearch(`${label} in ${district}`)
    }
  }

  function buildQuery(loc: string) {
    const label = locale === "de" ? CHIPS[selectedIdx].de : CHIPS[selectedIdx].en
    return loc.trim() ? `${label} in ${loc.trim()}` : label
  }

  function submit() {
    if (isLoading) return
    setSuggestions([])
    setShowSuggestions(false)
    onSearch(buildQuery(location))
  }

  function selectSuggestion(s: Suggestion) {
    // Preserve any quoted nameHint the user typed; replace the location part
    const quotedPart = location.match(/["'„""‟"«»‹›][^"'„""‟"«»‹›]+["'„""‟"«»‹›]/u)?.[0] ?? ""
    const newLocation = quotedPart ? `${quotedPart} ${s.display}` : s.display
    skipSuggestRef.current = true  // setLocation below will trigger useEffect — skip the fetch
    setLocation(newLocation)
    setSuggestions([])
    setShowSuggestions(false)
    setHighlightedIdx(-1)
    onSearch(buildQuery(newLocation))
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
    if (!("geolocation" in navigator)) { setNearbyPhase("error"); return }
    setNearbyPhase("locating")
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const d = await reverseGeocode(pos.coords.latitude, pos.coords.longitude)
          setNearbyPhase({ district: d })
          const chip = CHIPS[selectedIdxRef.current]
          const label = locale === "de" ? chip.de : chip.en
          onSearch(d ? `${label} in ${d}` : label)
        } catch {
          setNearbyPhase("error")
        }
      },
      () => setNearbyPhase("error"),
      { timeout: 10_000, enableHighAccuracy: false },
    )
  }

  return (
    <div className="flex flex-col gap-3 p-4 border-b border-border bg-card">

      {/* ── Segmented control ── */}
      <div className="flex rounded-lg border border-border bg-muted p-0.5 gap-0.5">
        {(["text", "nearby"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-colors",
              mode === m
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "text"
              ? <><Send className="w-3.5 h-3.5" />{t.chat.modeText}</>
              : <><MapPin className="w-3.5 h-3.5" />{t.chat.modeNearby}</>
            }
          </button>
        ))}
      </div>

      {/* ── Category chip strip (shared) ── */}
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

      {/* ── Text search mode ── */}
      {mode === "text" && (
        <div className="flex gap-2 items-center">
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
              onChange={(e) => { setLocation(e.target.value); setHighlightedIdx(-1) }}
              onKeyDown={handleKeyDown}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              placeholder={t.chat.locationPlaceholder}
              disabled={isLoading}
              autoFocus={autoFocus}
              className={cn(
                "w-full rounded-md border border-input bg-background px-3 py-2 text-sm h-[38px]",
                "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1",
                "focus-visible:ring-ring disabled:opacity-50",
                location && "pr-7",
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
                {suggestions.map((s, i) => (
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
                    {s.display}
                  </li>
                ))}
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
          {nearbyPhase === "idle" && (
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

          {district !== null && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <LocateFixed className="w-3 h-3 shrink-0 text-primary" />
              <span className="text-primary font-medium">{t.chat.nearbyIn(district)}</span>
            </p>
          )}
        </>
      )}

    </div>
  )
}
