import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

const BASE = "https://accessible-places.org"

export const metadata: Metadata = {
  title: "Häufige Fragen",
  description: "Antworten auf häufige Fragen zu Accessible Places — barrierefreie Orte in Deutschland, Österreich und der Schweiz verlässlich finden.",
  alternates: {
    canonical: `${BASE}/faq`,
    languages: { de: `${BASE}/faq`, en: `${BASE}/en/faq` },
  },
}

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
          Zurück
        </Link>

        <h1 className="text-2xl font-bold mb-8">Häufige Fragen</h1>

        <dl className="flex flex-col gap-6">
          {FAQ_DE.map(({ q, a }) => (
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
