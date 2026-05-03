"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { useTranslations } from "@/lib/i18n"

export default function ImpressumPage() {
  const t = useTranslations()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-lg mx-auto px-6 py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          {t.impressum.back}
        </Link>

        <h1 className="text-2xl font-bold mb-8">{t.impressum.title}</h1>

        <section className="mb-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {t.impressum.operator}
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
            {t.impressum.contact}
          </h2>
          <p className="text-sm">
            <a
              href="mailto:andreas.knoor@gmail.com"
              className="text-primary hover:underline"
            >
              andreas.knoor@gmail.com
            </a>
          </p>
        </section>

        <section className="border-t border-border pt-6">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t.impressum.disclaimer}
          </p>
        </section>
      </div>
    </div>
  )
}
