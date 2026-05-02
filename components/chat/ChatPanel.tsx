"use client"

import { useState, useRef } from "react"
import { Send, Loader2, LocateFixed, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations, useLocale } from "@/lib/i18n"
import { cn } from "@/lib/utils"

interface Props {
  onSearch:      (query: string) => void
  isLoading:     boolean
  onModeChange?: (mode: "text" | "nearby") => void
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
  const [location,    setLocation]    = useState("")
  const [selectedIdx, setSelectedIdx] = useState(0)
  const selectedIdxRef = useRef(0) // stable ref for async GPS callback

  const district = typeof nearbyPhase === "object" ? nearbyPhase.district : null

  function switchMode(next: Mode) {
    setMode(next)
    onModeChange?.(next)
    if (next === "nearby" && nearbyPhase === "idle") handleLocate()
  }

  function selectChip(idx: number) {
    setSelectedIdx(idx)
    selectedIdxRef.current = idx
    if (mode === "nearby" && district) {
      const label = locale === "de" ? CHIPS[idx].de : CHIPS[idx].en
      onSearch(`${label} in ${district}`)
    }
  }

  function submit() {
    if (isLoading) return
    const label = locale === "de" ? CHIPS[selectedIdx].de : CHIPS[selectedIdx].en
    const q = location.trim() ? `${label} in ${location.trim()}` : label
    onSearch(q)
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
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={t.chat.locationPlaceholder}
            disabled={isLoading}
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm h-[38px]
                       placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1
                       focus-visible:ring-ring disabled:opacity-50"
          />
          <Button
            onClick={submit}
            disabled={isLoading}
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
