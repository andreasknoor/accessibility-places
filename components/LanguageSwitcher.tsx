"use client"

import { useLocale, type Locale } from "@/lib/i18n"

export default function LanguageSwitcher() {
  const { locale, setLocale } = useLocale()

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      aria-label="Sprache / Language"
      className="text-xs font-medium bg-card border border-border rounded-md px-2 py-1.5 hover:bg-muted transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <option value="de">DE</option>
      <option value="en">EN</option>
    </select>
  )
}
