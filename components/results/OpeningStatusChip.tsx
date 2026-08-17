"use client"

import { CheckCircle2, Clock, XCircle } from "lucide-react"
import { useTranslations, useLocale } from "@/lib/i18n"
import { formatOpeningWhen, closingSoonMinutes, type OpeningStatus } from "@/lib/opening-hours"
import { cn } from "@/lib/utils"

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
    const minutes = closingSoonMinutes(status)
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
        ? t.results.openClosed(formatOpeningWhen(status.opensAt, status.refNow, locale))
        : t.results.openClosedPlain}
    </span>
  )
}
