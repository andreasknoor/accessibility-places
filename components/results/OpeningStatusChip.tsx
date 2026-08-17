"use client"

import { CheckCircle2, Clock, XCircle } from "lucide-react"
import { useTranslations, useLocale } from "@/lib/i18n"
import type { OpeningStatus } from "@/lib/opening-hours"
import { cn } from "@/lib/utils"

// Both dates are in the venue's wall-clock space (see wallClockAt) — so they
// are formatted as plain local time here, with no timeZone option, which
// renders exactly the clock reading a person standing at the venue would see.
function formatWhen(date: Date, refNow: Date, locale: "de" | "en"): string {
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date)
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOfDay(date) - startOfDay(refNow)) / 86_400_000)
  if (diffDays === 0) return locale === "de" ? `heute ${time}` : `today ${time}`
  if (diffDays === 1) return locale === "de" ? `morgen ${time}` : `tomorrow ${time}`
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date)
  return `${weekday} ${time}`
}

interface Props {
  status:     OpeningStatus | null
  size?:      "sm" | "md"
  className?: string
}

// Renders nothing when `status` is null — the deliberate product decision for
// issue #14: missing hours, unparseable syntax, an ambiguous rule, or an
// undeterminable time zone all collapse to "show no opening-hours element at
// all" rather than a hedge. Callers can render this unconditionally.
export default function OpeningStatusChip({ status, size = "sm", className }: Props) {
  const t = useTranslations()
  const { locale } = useLocale()
  if (!status) return null

  const iconSize = size === "sm" ? "w-3 h-3" : "w-4 h-4"

  if (status.state === "open") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-green-700", className)}>
        <CheckCircle2 className={cn(iconSize, "shrink-0")} aria-hidden />
        {t.results.openNow}
      </span>
    )
  }

  if (status.state === "closing_soon") {
    // Clamped at 1 rather than 0 so the label never reads "in 0 Min"; the
    // minute ticker re-evaluates the whole status, so this cannot get stuck
    // counting down past the actual close (it flips to "closed" instead).
    const minutes = Math.max(1, Math.round((status.closesAt.getTime() - status.refNow.getTime()) / 60_000))
    return (
      <span className={cn("inline-flex items-center gap-1 text-amber-700", className)}>
        <Clock className={cn(iconSize, "shrink-0")} aria-hidden />
        {t.results.openClosingSoon(minutes)}
      </span>
    )
  }

  return (
    <span className={cn("inline-flex items-center gap-1 text-red-700", className)}>
      <XCircle className={cn(iconSize, "shrink-0")} aria-hidden />
      {status.opensAt
        ? t.results.openClosed(formatWhen(status.opensAt, status.refNow, locale))
        : t.results.openClosedPlain}
    </span>
  )
}
