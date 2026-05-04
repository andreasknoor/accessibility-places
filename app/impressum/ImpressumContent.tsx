"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { APP_VERSION } from "@/lib/config"

const ENCODED = "YW5kcmVhcy5rbm9vckBnbWFpbC5jb20="

const STRINGS = {
  de: {
    back:       "Zurück",
    title:      "Impressum",
    operator:   "Betreiber",
    contact:    "Kontakt",
    version:    "Version",
    disclaimer: "Dieses Projekt ist ein privates, nicht-kommerzielles Hobby-Projekt. Für die Vollständigkeit, Richtigkeit und Aktualität der angezeigten Barrierefreiheitsinformationen wird keine Haftung übernommen.",
  },
  en: {
    back:       "Back",
    title:      "Legal Notice",
    operator:   "Operator",
    contact:    "Contact",
    version:    "Version",
    disclaimer: "This is a private, non-commercial hobby project. No liability is assumed for the completeness, accuracy or timeliness of the accessibility information displayed.",
  },
}

interface Props { lang: "de" | "en" }

export default function ImpressumContent({ lang }: Props) {
  const s = STRINGS[lang]
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    setEmail(atob(ENCODED))
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-lg mx-auto px-6 py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          {s.back}
        </Link>

        <h1 className="text-2xl font-bold mb-8">{s.title}</h1>

        <section className="mb-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {s.operator}
          </h2>
          <p className="text-sm leading-relaxed">
            Andreas Knoor<br />
            Bredower Weg 2<br />
            14612 Falkensee<br />
            Deutschland
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {s.contact}
          </h2>
          <p className="text-sm">
            {email ? (
              <a href={`mailto:${email}`} className="text-primary hover:underline">
                {email}
              </a>
            ) : (
              <span className="text-muted-foreground">…</span>
            )}
          </p>
        </section>

        <section className="mb-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {s.version}
          </h2>
          <p className="text-sm tabular-nums">{APP_VERSION}</p>
        </section>

        <section className="border-t border-border pt-6">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {s.disclaimer}
          </p>
        </section>
      </div>
    </div>
  )
}
