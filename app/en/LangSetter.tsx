"use client"

import { useEffect } from "react"

export default function LangSetter() {
  useEffect(() => {
    document.documentElement.lang = "en"
    return () => { document.documentElement.lang = "de" }
  }, [])
  return null
}
