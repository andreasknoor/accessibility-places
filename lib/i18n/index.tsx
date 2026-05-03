"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import de from "./de"
import en from "./en"

export type { Translations } from "./types"

const translations = { de, en } as const
export type Locale = keyof typeof translations

const STORAGE_KEY = "locale"

function detectLocale(): Locale {
  const lang = navigator.language?.slice(0, 2).toLowerCase()
  return lang === "de" ? "de" : "en"
}

interface LocaleContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined)

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Start with "de" so SSR matches; resolve real locale after mount.
  const [locale, setLocaleState] = useState<Locale>("de")

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "de" || stored === "en") setLocaleState(stored)
    else setLocaleState(detectLocale())
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  function setLocale(l: Locale) {
    setLocaleState(l)
    localStorage.setItem(STORAGE_KEY, l)
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  )
}

// Throws when used outside a provider — only the LanguageSwitcher needs this.
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error("useLocale must be used inside <LocaleProvider>")
  return ctx
}

// Works both inside and outside a provider so component tests don't need to wrap.
export function useTranslations() {
  const ctx = useContext(LocaleContext)
  const [autoLocale, setAutoLocale] = useState<Locale>("de")
  useEffect(() => {
    if (!ctx) setAutoLocale(detectLocale())
  }, [ctx])
  const locale = ctx?.locale ?? autoLocale
  return translations[locale]
}

export function getTranslations(locale?: string) {
  const l = (locale?.slice(0, 2).toLowerCase() ?? "de") as Locale
  return translations[l] ?? de
}
