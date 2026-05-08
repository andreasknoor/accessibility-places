"use client"

import { usePathname, useRouter } from "next/navigation"
import { useLocale, type Locale } from "@/lib/i18n"

const PATH_MAP: Record<string, Record<Locale, string>> = {
  "/":              { de: "/",           en: "/en" },
  "/en":            { de: "/",           en: "/en" },
  "/faq":           { de: "/faq",        en: "/en/faq" },
  "/en/faq":        { de: "/faq",        en: "/en/faq" },
  "/impressum":     { de: "/impressum",  en: "/en/impressum" },
  "/en/impressum":  { de: "/impressum",  en: "/en/impressum" },
}

export default function LanguageSwitcher() {
  const { locale, setLocale } = useLocale()
  const pathname  = usePathname()
  const router    = useRouter()

  function handleChange(newLocale: Locale) {
    setLocale(newLocale)
    const mapped = PATH_MAP[pathname]?.[newLocale]
    if (mapped) router.push(mapped)
  }

  return (
    <select
      value={locale}
      onChange={(e) => handleChange(e.target.value as Locale)}
      aria-label="Sprache / Language"
      className="text-xs font-medium bg-card border border-border rounded-md px-2 py-1.5 hover:bg-muted transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <option value="de">DE</option>
      <option value="en">EN</option>
    </select>
  )
}
