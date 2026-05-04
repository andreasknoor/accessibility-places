"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { useTranslations, useLocale } from "@/lib/i18n"

const FAQ_DE = [
  {
    q: "Was ist Accessible Places?",
    a: "Accessible Places hilft Menschen mit Rollstuhl oder eingeschränkter Mobilität, barrierefreie Orte in Deutschland, Österreich und der Schweiz zu finden — Restaurants, Cafés, Hotels, Museen und mehr.",
  },
  {
    q: "Welche Länder werden unterstützt?",
    a: "Deutschland, Österreich und die Schweiz (DACH-Region).",
  },
  {
    q: "Welche Kategorien gibt es?",
    a: "Restaurants, Cafés, Bars, Kneipen, Biergärten, Imbisse, Hotels, Hostels, Ferienwohnungen, Museen, Theater, Kinos, Bibliotheken, Galerien, Sehenswürdigkeiten und Eisdielen.",
  },
  {
    q: "Woher kommen die Barrierefreiheitsdaten?",
    a: "Die App kombiniert Daten aus drei Quellen: OpenStreetMap (OSM), accessibility.cloud (einschließlich Wheelmap.org) und Google Places. Die Daten werden zusammengeführt und mit einem Verlässlichkeitswert versehen.",
  },
  {
    q: "Was bedeutet der farbige Kreis bei jedem Eintrag?",
    a: "Grün steht für eine verlässliche Barrierefreiheitsinformation, Gelb für eine mittelgute Datenlage und Rot für eine unsichere oder unvollständige Datenlage. Die Farbe gibt also an, wie verlässlich die verfügbaren Informationen sind — nicht ob ein Ort barrierefrei ist oder nicht.",
  },
  {
    q: "Ist die App kostenlos?",
    a: "Ja, vollständig kostenlos und ohne Registrierung nutzbar.",
  },
  {
    q: "Wie aktuell sind die Daten?",
    a: "Die Daten werden bei jeder Suche live aus den Quellen abgerufen. Manuell verifizierte Einträge von Wheelmap-Nutzern werden besonders gekennzeichnet.",
  },
  {
    q: "Gibt es Accessible Places auch als App fürs Smartphone?",
    a: 'Ja — Accessible Places kann als App auf dem Smartphone installiert werden, ohne App Store oder Play Store. Auf iPhone/iPad: Safari öffnen → Teilen-Symbol antippen → "Zum Home-Bildschirm" wählen. Auf Android: Chrome öffnen → Menü (drei Punkte) → "App installieren" oder "Zum Startbildschirm hinzufügen". Die App funktioniert danach wie eine native App — mit eigenem Icon, Vollbild und ohne Browser-Leiste.',
  },
  {
    q: "Wie kann ich Feedback geben oder einen Fehler melden?",
    a: 'Über den "Feedback"-Link am unteren Rand der Seite kannst du direkt ein GitHub-Issue erstellen. Dafür benötigst du einen kostenlosen GitHub-Account.',
  },
]

const FAQ_EN = [
  {
    q: "What is Accessible Places?",
    a: "Accessible Places helps people with wheelchairs or limited mobility find accessible venues in Germany, Austria and Switzerland — restaurants, cafés, hotels, museums and more.",
  },
  {
    q: "Which countries are supported?",
    a: "Germany, Austria and Switzerland (the DACH region).",
  },
  {
    q: "Which categories are available?",
    a: "Restaurants, cafés, bars, pubs, beer gardens, fast food / snack bars, hotels, hostels, holiday apartments, museums, theatres, cinemas, libraries, galleries, attractions and ice cream shops.",
  },
  {
    q: "Where does the accessibility data come from?",
    a: "The app combines data from three sources: OpenStreetMap (OSM), accessibility.cloud (including Wheelmap.org) and Google Places. Data is merged and assigned a reliability score.",
  },
  {
    q: "What does the coloured circle next to each entry mean?",
    a: "Green means reliable accessibility information, yellow means moderate data quality, and red means uncertain or incomplete data. The colour reflects how trustworthy the available information is — not whether a place is accessible or not.",
  },
  {
    q: "Is the app free?",
    a: "Yes, completely free and no registration required.",
  },
  {
    q: "How up to date is the data?",
    a: "Data is fetched live from the sources on every search. Manually verified entries from Wheelmap contributors are highlighted with a special badge.",
  },
  {
    q: "Is Accessible Places available as a smartphone app?",
    a: "Yes — Accessible Places can be installed as an app on your phone without the App Store or Play Store. On iPhone/iPad: open Safari → tap the Share icon → select \"Add to Home Screen\". On Android: open Chrome → tap the menu (three dots) → \"Install app\" or \"Add to home screen\". Once installed it behaves like a native app — with its own icon, full screen and no browser bar.",
  },
  {
    q: "How can I give feedback or report a bug?",
    a: 'Use the "Feedback" link at the bottom of the page to open a GitHub issue directly. You\'ll need a free GitHub account to submit.',
  },
]

export default function FaqPage() {
  const t = useTranslations()
  const { locale } = useLocale()
  const items = locale === "de" ? FAQ_DE : FAQ_EN

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-lg mx-auto px-6 py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          {t.faq.back}
        </Link>

        <h1 className="text-2xl font-bold mb-8">{t.faq.title}</h1>

        <dl className="flex flex-col gap-6">
          {items.map(({ q, a }) => (
            <div key={q} className="border-b border-border pb-6 last:border-0 last:pb-0">
              <dt className="font-semibold text-sm mb-1.5">{q}</dt>
              <dd className="text-sm text-muted-foreground leading-relaxed">{a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
