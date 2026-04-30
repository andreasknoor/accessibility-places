"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { Send, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/lib/i18n"

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

export default function ChatPanel({ onSearch, isLoading }: Props) {
  const t = useTranslations()
  const [value, setValue]   = useState("")
  const [mounted, setMounted] = useState(false)
  const textareaRef           = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setMounted(true) }, [])

  const examples = useMemo(() => {
    if (!mounted) return EXAMPLES_DE   // matches server render
    return navigator.language?.startsWith("de") ? EXAMPLES_DE : EXAMPLES_EN
  }, [mounted])

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

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [value])

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

      {/* Example chips */}
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
    </div>
  )
}
