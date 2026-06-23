"use client"

import { useState } from "react"
import { X, Globe } from "lucide-react"
import { useTranslations } from "@/lib/i18n"

// Dismissible bottom banner prompting users who access the app from outside the
// DACH region (with international mode off) to enable international search.
// Two honest variants:
//   • "intl"    → tier is in the opt-in allowlist → full support once enabled.
//   • "outside" → not in the allowlist → nearby/GPS works, name search does not.
// onActivate enables the appropriate sources (handled by the caller); onClose
// hides it (remember=true persists the dismissal).
export default function IntlHintBanner({
  tier,
  onActivate,
  onClose,
}: {
  tier: "intl" | "outside"
  onActivate: () => void
  onClose: (remember: boolean) => void
}) {
  const t = useTranslations()
  const [remember, setRemember] = useState(false)

  const title = tier === "intl" ? t.intlHint.titleFull : t.intlHint.titleLimited
  const body  = tier === "intl" ? t.intlHint.bodyFull  : t.intlHint.bodyLimited

  return (
    <div
      role="region"
      aria-label={title}
      className="fixed bottom-0 inset-x-0 z-[1000] flex justify-center px-3 pb-3 pointer-events-none"
    >
      <div className="pointer-events-auto w-full max-w-md rounded-xl border border-border bg-card shadow-lg p-4">
        <div className="flex items-start gap-3">
          <Globe className="w-5 h-5 text-primary shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">{title}</p>
            <p className="text-sm text-muted-foreground mt-1">{body}</p>
          </div>
          <button
            onClick={() => onClose(remember)}
            aria-label={t.common.close}
            className="shrink-0 -mt-1 -mr-1 p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 mt-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="rounded border-border"
            />
            {t.intlHint.dontShowAgain}
          </label>
          <button
            onClick={onActivate}
            className="shrink-0 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {t.intlHint.activate}
          </button>
        </div>
      </div>
    </div>
  )
}
