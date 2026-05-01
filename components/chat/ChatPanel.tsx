"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { Send, Loader2, LocateFixed } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations, useLocale } from "@/lib/i18n"

interface Props {
  onSearch:  (query: string) => void
  isLoading: boolean
}

const EXAMPLES_DE = [
  "Restaurants in Berlin Mitte",
  "Hotels in München",
  "Museen in Frankfurt",
  "Cafés in Hamburg",
  "Kinos in Köln",
  "Theater in Dresden",
]

const EXAMPLES_EN = [
  "Restaurants in Berlin Mitte",
  "Hotels in Munich",
  "Museums in Frankfurt",
  "Cafés in Hamburg",
  "Cinemas in Cologne",
  "Theaters in Dresden",
]

const NEARBY_CHIPS = [
  { icon: "🍽", de: "Restaurants", en: "Restaurants" },
  { icon: "☕", de: "Cafés",       en: "Cafés"       },
  { icon: "🍺", de: "Kneipen",     en: "Pubs"        },
  { icon: "🏨", de: "Hotels",      en: "Hotels"      },
  { icon: "🏛", de: "Museen",      en: "Museums"     },
  { icon: "🎬", de: "Kinos",       en: "Cinemas"     },
]

type NearbyState =
  | { phase: "idle" }
  | { phase: "locating" }
  | { phase: "ready"; district: string }
  | { phase: "error" }

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=14`,
  )
  if (!res.ok) throw new Error("reverse geocode failed")
  const data = await res.json()
  const a = data.address ?? {}
  return a.suburb ?? a.city_district ?? a.city ?? a.town ?? a.village ?? ""
}

export default function ChatPanel({ onSearch, isLoading }: Props) {
  const t = useTranslations()
  const { locale } = useLocale()
  const [value,  setValue]  = useState("")
  const [nearby, setNearby] = useState<NearbyState>({ phase: "idle" })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const examples = useMemo(() => locale === "de" ? EXAMPLES_DE : EXAMPLES_EN, [locale])

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
    if (!("geolocation" in navigator)) { setNearby({ phase: "error" }); return }
    setNearby({ phase: "locating" })
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const district = await reverseGeocode(pos.coords.latitude, pos.coords.longitude)
          setNearby({ phase: "ready", district })
        } catch {
          setNearby({ phase: "error" })
        }
      },
      () => setNearby({ phase: "error" }),
      { timeout: 10_000, enableHighAccuracy: false },
    )
  }

  function handleNearbyChip(chip: typeof NEARBY_CHIPS[0]) {
    const district = nearby.phase === "ready" ? nearby.district : ""
    const label    = locale === "de" ? chip.de : chip.en
    onSearch(district ? `${label} in ${district}` : label)
  }

  return (
    <div className="flex flex-col gap-3 p-4 border-b border-border bg-card">

      {/* Input row */}
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
          variant="outline"
          size="sm"
          onClick={handleLocate}
          disabled={isLoading || nearby.phase === "locating"}
          title={t.chat.nearbyButton}
          aria-label={t.chat.nearbyButton}
          className="shrink-0 px-2.5"
        >
          {nearby.phase === "locating"
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <LocateFixed className="w-4 h-4" />
          }
        </Button>
        <Button
          onClick={submit}
          disabled={!value.trim() || isLoading}
          size="sm"
          className="shrink-0"
        >
          {isLoading
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Send className="w-4 h-4" />
          }
          <span className="ml-1.5">{isLoading ? t.chat.thinking : t.chat.send}</span>
        </Button>
      </div>

      {/* Nearby chips — shown after successful location lookup */}
      {nearby.phase === "ready" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <LocateFixed className="w-3 h-3 shrink-0" />
            {t.chat.nearbyIn(nearby.district)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {NEARBY_CHIPS.map((chip) => (
              <button
                key={chip.de}
                onClick={() => handleNearbyChip(chip)}
                disabled={isLoading}
                className="text-xs px-2 py-1 rounded-full bg-primary/10 hover:bg-primary/20 text-primary
                           transition-colors disabled:opacity-40"
              >
                {chip.icon} {locale === "de" ? chip.de : chip.en}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Location error */}
      {nearby.phase === "error" && (
        <p className="text-xs text-destructive">{t.chat.locationError}</p>
      )}

      {/* Example chips — shown when nearby is not active */}
      {nearby.phase !== "ready" && (
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
      )}

    </div>
  )
}
