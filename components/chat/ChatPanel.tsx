"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { Send, Loader2, LocateFixed, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations, useLocale } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface Props {
  onSearch:      (query: string) => void
  isLoading:     boolean
  onModeChange?: (mode: "text" | "nearby") => void
}

const EXAMPLES_DE = [
  "Restaurants in Berlin Mitte",
  "Hotels in München",
  "Museen in Frankfurt",
  "Cafés in Hamburg",
  "Kinos in Köln",
]

const EXAMPLES_EN = [
  "Restaurants in Berlin Mitte",
  "Hotels in Munich",
  "Museums in Frankfurt",
  "Cafés in Hamburg",
  "Cinemas in Cologne",
]

const NEARBY_CHIPS = [
  { icon: "🍽", de: "Restaurants", en: "Restaurants" },
  { icon: "☕", de: "Cafés",       en: "Cafés"       },
  { icon: "🍺", de: "Kneipen",     en: "Pubs"        },
  { icon: "🏨", de: "Hotels",      en: "Hotels"      },
  { icon: "🏛", de: "Museen",      en: "Museums"     },
  { icon: "🎬", de: "Kinos",       en: "Cinemas"     },
]

type Mode        = "text" | "nearby"
type NearbyPhase = "idle" | "locating" | { district: string } | "error"

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=14`,
  )
  if (!res.ok) throw new Error("reverse geocode failed")
  const data = await res.json()
  const a = data.address ?? {}
  return a.suburb ?? a.city_district ?? a.city ?? a.town ?? a.village ?? ""
}

export default function ChatPanel({ onSearch, isLoading, onModeChange }: Props) {
  const t = useTranslations()
  const { locale } = useLocale()
  const [mode,        setMode]        = useState<Mode>("text")
  const [nearbyPhase, setNearbyPhase] = useState<NearbyPhase>("idle")
  const [value,       setValue]       = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const examples = useMemo(() => locale === "de" ? EXAMPLES_DE : EXAMPLES_EN, [locale])

  function switchMode(next: Mode) {
    setMode(next)
    onModeChange?.(next)
    if (next === "nearby" && nearbyPhase === "idle") handleLocate()
  }

  function submit() {
    const q = value.trim()
    if (!q || isLoading) return
    onSearch(q)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [value])

  function handleLocate() {
    if (!("geolocation" in navigator)) { setNearbyPhase("error"); return }
    setNearbyPhase("locating")
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const district = await reverseGeocode(pos.coords.latitude, pos.coords.longitude)
          setNearbyPhase({ district })
        } catch {
          setNearbyPhase("error")
        }
      },
      () => setNearbyPhase("error"),
      { timeout: 10_000, enableHighAccuracy: false },
    )
  }

  function handleNearbyChip(chip: typeof NEARBY_CHIPS[0]) {
    const district = typeof nearbyPhase === "object" ? nearbyPhase.district : ""
    const label    = locale === "de" ? chip.de : chip.en
    onSearch(district ? `${label} in ${district}` : label)
  }

  const district = typeof nearbyPhase === "object" ? nearbyPhase.district : null

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

      {/* ── Text search mode ── */}
      {mode === "text" && (
        <>
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t.chat.placeholder}
              rows={1}
              disabled={isLoading}
              className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm
                         placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1
                         focus-visible:ring-ring disabled:opacity-50 min-h-[38px] leading-snug"
            />
            <Button
              onClick={submit}
              disabled={!value.trim() || isLoading}
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

          <div className="flex flex-wrap gap-1.5">
            {examples.map((ex) => (
              <button
                key={ex}
                onClick={() => { setValue(ex); textareaRef.current?.focus() }}
                disabled={isLoading}
                className="text-xs px-2 py-1 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground
                           hover:text-foreground transition-colors disabled:opacity-40 text-left leading-snug"
              >
                {ex}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── Nearby mode ── */}
      {mode === "nearby" && (
        <>
          {/* idle: prominent locate button */}
          {nearbyPhase === "idle" && (
            <Button
              onClick={handleLocate}
              disabled={isLoading}
              variant="outline"
              className="w-full gap-2"
            >
              <LocateFixed className="w-4 h-4" />
              {t.chat.locateButton}
            </Button>
          )}

          {/* locating: spinner */}
          {nearbyPhase === "locating" && (
            <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t.chat.locateButton} …
            </div>
          )}

          {/* error: message + retry */}
          {nearbyPhase === "error" && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-destructive">{t.chat.locationError}</p>
              <Button variant="outline" size="sm" onClick={handleLocate}>
                <LocateFixed className="w-3.5 h-3.5 mr-1.5" />
                {t.chat.locateButton}
              </Button>
            </div>
          )}

          {/* ready: district label + chips */}
          {district !== null && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <LocateFixed className="w-3 h-3 shrink-0 text-primary" />
                <span className="text-primary font-medium">{t.chat.nearbyIn(district)}</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {NEARBY_CHIPS.map((chip) => (
                  <button
                    key={chip.de}
                    onClick={() => handleNearbyChip(chip)}
                    disabled={isLoading}
                    className="text-xs px-2.5 py-1.5 rounded-full bg-primary/10 hover:bg-primary/20
                               text-primary font-medium transition-colors disabled:opacity-40"
                  >
                    {chip.icon} {locale === "de" ? chip.de : chip.en}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

    </div>
  )
}
