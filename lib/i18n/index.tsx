"use client"

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
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

function localeFromQuery(): Locale | null {
  const q = new URLSearchParams(window.location.search).get("lang")?.slice(0, 2).toLowerCase()
  return q === "de" || q === "en" ? q : null
}

interface LocaleContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined)

export function LocaleProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  // Start with initialLocale (for route-controlled pages like /en) or "de" (SSR default).
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? "de")

  // useLayoutEffect, not useEffect: the server can only render one language
  // (the root layout's "de"), so the real locale is always a client-side
  // correction. A passive effect applies it AFTER paint, which showed every
  // non-German visitor a German first frame before it flipped. A layout
  // effect runs synchronously before the browser paints, so the correction is
  // never visible — the same pattern useIsMobile and HomeClient's own
  // localStorage-derived state already use. Resolving during render instead
  // is not an option: it would be a genuine hydration mismatch (React #418).
  /* eslint-disable react-hooks/set-state-in-effect -- intentional: hydration-safe sync of browser/storage-derived state, mirrors useIsMobile */
  useLayoutEffect(() => {
    // Skip browser/storage detection when the route itself controls the locale.
    if (initialLocale) return
    const fromQuery = localeFromQuery()
    if (fromQuery) {
      setLocaleState(fromQuery)
      localStorage.setItem(STORAGE_KEY, fromQuery)
      return
    }
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "de" || stored === "en") setLocaleState(stored)
    else setLocaleState(detectLocale())
  }, [initialLocale])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keep <html lang> honest. The root layout hardcodes lang="de" because it is
  // a Server Component that cannot know the visitor's language, so without
  // this an English visitor on "/" got English text inside a document
  // declared as German — a WCAG 2.2 SC 3.1.1 failure, and a concrete one:
  // screen readers pick their pronunciation from this attribute, so they
  // would read English with German phonetics.
  //
  // The /en/* routes nest their own LocaleProvider (initialLocale="en"); that
  // inner one is the authority there, so the outer auto-detecting instance
  // must keep its hands off. Gated on the path rather than on effect ordering,
  // which runs child-before-parent and would let the outer one win.
  useLayoutEffect(() => {
    if (!initialLocale && window.location.pathname.startsWith("/en")) return
    document.documentElement.lang = locale
  }, [locale, initialLocale])

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
