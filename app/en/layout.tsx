"use client"

import { useEffect } from "react"
import { LocaleProvider } from "@/lib/i18n"

export default function EnLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = "en"
    return () => { document.documentElement.lang = "de" }
  }, [])

  return (
    <LocaleProvider initialLocale="en">
      {children}
    </LocaleProvider>
  )
}
