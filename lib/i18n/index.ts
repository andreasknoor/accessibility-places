"use client"

import { useState, useEffect } from "react"
import de from "./de"
import en from "./en"

export type { Translations } from "./types"

const translations = { de, en } as const
type Locale = keyof typeof translations

function detectLocale(): Locale {
  const lang = navigator.language?.slice(0, 2).toLowerCase()
  return lang === "de" ? "de" : "en"
}

export function useTranslations() {
  // Start with "de" so server and client initial render match, then update after mount
  const [locale, setLocale] = useState<Locale>("de")
  useEffect(() => { setLocale(detectLocale()) }, [])
  return translations[locale]
}

export function getTranslations(locale?: string) {
  const l = (locale?.slice(0, 2).toLowerCase() ?? "de") as Locale
  return translations[l] ?? de
}
