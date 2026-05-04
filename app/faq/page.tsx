"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { useTranslations, useLocale } from "@/lib/i18n"

const FAQ_DE = [
  {
    q: "Was ist Accessible Places?",
    a: "Accessible Places hilft Menschen mit Rollstuhl oder eingeschränkter Mobilität, barrierefreie Orte in Deutschland, Österreich und der Schweiz zu finden. Im Mittelpunkt steht die Verlässlichkeit der Informationen: Daten aus Google Maps sind in puncto Barrierefreiheit oft unvollständig und lassen sich dort kaum gezielt filtern. Accessible Places löst genau dieses Problem — mit einer schnellen, einfach zu bedienenden Suche, die Informationen aus mehreren Quellen zusammenführt und bewertet.",
  },
  {
    q: "Wie finde ich barrierefreie Orte in Deutschland, Österreich und der Schweiz?",
    a: 'Gib einfach einen Ort ein — zum Beispiel "Berlin Mitte" oder "Wien" — und wähle eine Kategorie wie Restaurant oder Hotel. Accessible Places durchsucht sofort mehrere Datenquellen und zeigt dir barrierefreie Orte in deiner Nähe. Die App funktioniert in der gesamten DACH-Region: Deutschland, Österreich und der Schweiz.',
  },
  {
    q: "Welche barrierefreien Orte kann ich finden — Restaurants, Hotels, Cafés?",
    a: "Restaurants, Cafés, Bars, Kneipen, Biergärten, Imbisse, Hotels, Hostels, Ferienwohnungen, Museen, Theater, Kinos, Bibliotheken, Galerien, Sehenswürdigkeiten und Eisdielen.",
  },
  {
    q: "Wie finde ich barrierefreie Restaurants oder Cafés in meiner Nähe?",
    a: 'Tippe auf "In der Nähe" und erteile der App die Standortfreigabe. Accessible Places ermittelt automatisch deinen Standort und sucht barrierefreie Restaurants, Cafés oder andere Orte in deiner direkten Umgebung — ohne dass du einen Ort eingeben musst.',
  },
  {
    q: "Was ist der Unterschied zu Google Maps bei der Suche nach barrierefreien Orten?",
    a: "Google Maps enthält kaum strukturierte Barrierefreiheitsinformationen und bietet keine gezielte Filterfunktion dafür. Accessible Places ist speziell auf diese Suche ausgerichtet: Die App kombiniert mehrere spezialisierte Datenquellen, bewertet jede Information nach ihrer Verlässlichkeit und zeigt auf einen Blick, wie gut ein Ort für Rollstuhlfahrer geeignet ist.",
  },
  {
    q: "Wie verlässlich sind die Barrierefreiheitsinformationen?",
    a: "Die App kombiniert Daten aus drei Quellen: OpenStreetMap (OSM), accessibility.cloud (einschließlich Wheelmap.org) und Google Places. Jede Quelle wird mit einem Verlässlichkeitswert gewichtet — von manuell verifizierten Einträgen bis hin zu automatisch erhobenen Daten. Der farbige Kreis bei jedem Eintrag zeigt auf einen Blick, wie gut die Datenlage ist.",
  },
  {
    q: "Was bedeutet der farbige Kreis bei jedem Eintrag?",
    a: "Grün steht für eine verlässliche Barrierefreiheitsinformation, Gelb für eine mittelgute Datenlage und Rot für eine unsichere oder unvollständige Datenlage. Die Farbe gibt also an, wie verlässlich die verfügbaren Informationen sind — nicht ob ein Ort barrierefrei ist oder nicht.",
  },
  {
    q: "Ist die Suche nach barrierefreien Orten kostenlos?",
    a: "Ja, vollständig kostenlos und ohne Registrierung nutzbar.",
  },
  {
    q: "Sind die Barrierefreiheitsinformationen aktuell und geprüft?",
    a: "Die Daten werden bei jeder Suche live aus den Quellen abgerufen. Manuell verifizierte Einträge von Wheelmap-Nutzern werden mit einem speziellen Badge hervorgehoben.",
  },
  {
    q: "Kann ich barrierefreie Orte auch auf dem Smartphone suchen?",
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
    a: "Accessible Places helps people with wheelchairs or limited mobility find accessible venues in Germany, Austria and Switzerland. A key focus is data reliability: accessibility information in Google Maps is often incomplete and difficult to filter in a meaningful way. Accessible Places solves exactly this problem — offering a fast, easy-to-use search that aggregates and rates information from multiple sources.",
  },
  {
    q: "How do I find wheelchair-accessible places in Germany, Austria and Switzerland?",
    a: "Simply enter a location — for example \"Berlin Mitte\" or \"Vienna\" — and choose a category such as restaurant or hotel. Accessible Places searches multiple data sources instantly and shows you accessible venues nearby. The app covers the entire DACH region: Germany, Austria and Switzerland.",
  },
  {
    q: "Which wheelchair-accessible venues can I find — restaurants, hotels, cafés?",
    a: "Restaurants, cafés, bars, pubs, beer gardens, fast food / snack bars, hotels, hostels, holiday apartments, museums, theatres, cinemas, libraries, galleries, attractions and ice cream shops.",
  },
  {
    q: "How do I find wheelchair-accessible restaurants or cafés near me?",
    a: "Tap \"Nearby\" and allow location access. Accessible Places automatically detects your position and searches for accessible restaurants, cafés or other venues in your immediate vicinity — no need to type a location.",
  },
  {
    q: "What is the difference from Google Maps when searching for accessible places?",
    a: "Google Maps contains little structured accessibility information and offers no dedicated filter for it. Accessible Places is built specifically for this search: it combines multiple specialised data sources, rates each piece of information by reliability, and shows at a glance how suitable a venue is for wheelchair users.",
  },
  {
    q: "How reliable is the accessibility information?",
    a: "The app combines data from three sources: OpenStreetMap (OSM), accessibility.cloud (including Wheelmap.org) and Google Places. Each source is weighted by its trustworthiness — from manually verified entries to automatically collected data. The coloured circle next to each entry shows at a glance how solid the data is.",
  },
  {
    q: "What does the coloured circle next to each entry mean?",
    a: "Green means reliable accessibility information, yellow means moderate data quality, and red means uncertain or incomplete data. The colour reflects how trustworthy the available information is — not whether a place is accessible or not.",
  },
  {
    q: "Is searching for wheelchair-accessible places free?",
    a: "Yes, completely free and no registration required.",
  },
  {
    q: "Is the accessibility information up to date and verified?",
    a: "Data is fetched live from the sources on every search. Manually verified entries from Wheelmap contributors are highlighted with a special badge.",
  },
  {
    q: "Can I search for accessible places on my smartphone?",
    a: "Yes — Accessible Places can be installed as an app on your phone without the App Store or Play Store. On iPhone/iPad: open Safari → tap the Share icon → select \"Add to Home Screen\". On Android: open Chrome → tap the menu (three dots) → \"Install app\" or \"Add to home screen\". Once installed it behaves like a native app — with its own icon, full screen and no browser bar.",
  },
  {
    q: "How can I give feedback or report a bug?",
    a: "Use the \"Feedback\" link at the bottom of the page to open a GitHub issue directly. You'll need a free GitHub account to submit.",
  },
]

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_DE.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
}

export default function FaqPage() {
  const t = useTranslations()
  const { locale } = useLocale()
  const items = locale === "de" ? FAQ_DE : FAQ_EN

  return (
    <div className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
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
