import type { Metadata } from "next"
import type { ReactNode } from "react"
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

// `id` is a stable deep-link slug — kept identical between the DE and EN files
// so /faq#slug and /en/faq#slug resolve to the same question. Do not derive it
// from the question text: rewording a question would silently break shared links.
const FAQ_DE: { id: string; q: string; a: ReactNode; schemaText?: string }[] = [
  {
    id: "what-is",
    q: "Was ist Accessible Places?",
    a: "Accessible Places hilft Menschen mit Rollstuhl oder eingeschränkter Mobilität, barrierefreie Orte in Deutschland, Österreich und der Schweiz zu finden. Im Mittelpunkt steht die Verlässlichkeit der Informationen: Daten aus Google Maps sind in puncto Barrierefreiheit oft unvollständig und lassen sich dort kaum gezielt filtern. Accessible Places löst genau dieses Problem — mit einer schnellen, einfach zu bedienenden Suche, die Informationen aus mehreren Quellen zusammenführt und bewertet.",
  },
  {
    id: "how-to-find",
    q: "Wie finde ich barrierefreie Orte in Deutschland, Österreich und der Schweiz?",
    a: 'Gib einfach einen Ort ein — zum Beispiel "Berlin Mitte" oder "Wien" — und wähle eine Kategorie wie Restaurant oder Hotel. Accessible Places durchsucht sofort mehrere Datenquellen und zeigt dir barrierefreie Orte in deiner Nähe. Die App funktioniert in der gesamten DACH-Region: Deutschland, Österreich und der Schweiz.',
  },
  {
    id: "which-venues",
    q: "Welche barrierefreien Orte kann ich finden — Restaurants, Hotels, Cafés?",
    a: "Restaurants, Cafés, Bars, Kneipen, Biergärten, Imbisse, Hotels, Hostels, Ferienwohnungen, Museen, Theater, Kinos, Bibliotheken, Galerien, Sehenswürdigkeiten und Eisdielen.",
  },
  {
    id: "find-nearby",
    q: "Wie finde ich barrierefreie Restaurants oder Cafés in meiner Nähe?",
    a: 'Tippe auf "In der Nähe" und erteile der App die Standortfreigabe. Accessible Places ermittelt automatisch deinen Standort und sucht barrierefreie Restaurants, Cafés oder andere Orte in deiner direkten Umgebung — ohne dass du einen Ort eingeben musst.',
  },
  {
    id: "vs-google-maps",
    q: "Was ist der Unterschied zu Google Maps bei der Suche nach barrierefreien Orten?",
    a: "Google Maps enthält kaum strukturierte Barrierefreiheitsinformationen und bietet keine gezielte Filterfunktion dafür. Accessible Places ist speziell auf diese Suche ausgerichtet: Die App kombiniert mehrere spezialisierte Datenquellen, bewertet jede Information nach ihrer Verlässlichkeit und zeigt auf einen Blick, wie gut ein Ort für Rollstuhlfahrer geeignet ist.",
  },
  {
    id: "vs-wheelmap",
    q: "Was ist der Unterschied zwischen Wheelmap.org und Accessible Places?",
    a: (
      <>
        <p>
          Wheelmap.org und Accessible Places verfolgen ähnliche Ziele, setzen aber unterschiedliche
          Schwerpunkte — sie sind keine Konkurrenten, sondern ergänzen sich. Wheelmap ist eine der
          größten Crowdsourcing-Plattformen für Barrierefreiheit: Tausende Menschen tragen dort Orte
          direkt ein. Diese wertvollen Daten fließen auch in Accessible Places ein.
        </p>
        <p className="mt-2">Accessible Places konzentriert sich auf vier Dinge:</p>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
          <li>
            <strong className="font-semibold text-foreground">Verlässlichkeit:</strong> Wir zeigen
            nicht nur, ob ein Ort barrierefrei ist, sondern auch, wie verlässlich diese Information
            ist — über einen farbigen Kreis, der die Datenqualität bewertet.
          </li>
          <li>
            <strong className="font-semibold text-foreground">Mehrere Quellen vereint:</strong>{" "}
            Accessible Places führt Daten aus verschiedenen Quellen zu einer einheitlichen Ansicht
            zusammen. Wheelmap und das zugrunde liegende OpenStreetMap sind dabei zwei wichtige
            Bausteine, aber nicht die einzigen.
          </li>
          <li>
            <strong className="font-semibold text-foreground">Beste Daten je Region:</strong> Für
            jede Region binden wir die jeweils stärkste lokale Quelle ein. In der Schweiz etwa
            liefert Ginto besonders hochwertige Barrierefreiheitsdaten. So entsteht überall die
            bestmögliche Datengrundlage.
          </li>
          <li>
            <strong className="font-semibold text-foreground">Rollstuhlparkplätze:</strong>{" "}
            Accessible Places zeigt rollstuhlgerechte Parkplätze direkt auf der Karte. Die Frage „Wo
            ist der nächste Rollstuhlparkplatz?“ lässt sich mit einem Klick beantworten — das bieten
            andere Plattformen so nicht.
          </li>
        </ul>
        <p className="mt-2">
          Wenn du selbst Barrierefreiheitsdaten beitragen möchtest, ist Wheelmap.org der beste Ort
          dafür — neue Einträge erscheinen nach kurzer Zeit auch bei uns.
        </p>
      </>
    ),
    schemaText:
      "Wheelmap.org und Accessible Places verfolgen ähnliche Ziele, setzen aber unterschiedliche Schwerpunkte — sie sind keine Konkurrenten, sondern ergänzen sich. Wheelmap ist eine der größten Crowdsourcing-Plattformen für Barrierefreiheit: Tausende Menschen tragen dort Orte direkt ein. Diese wertvollen Daten fließen auch in Accessible Places ein. Accessible Places konzentriert sich auf vier Dinge: Verlässlichkeit — wir zeigen nicht nur, ob ein Ort barrierefrei ist, sondern auch, wie verlässlich diese Information ist, über einen farbigen Kreis, der die Datenqualität bewertet. Mehrere Quellen vereint — Accessible Places führt Daten aus verschiedenen Quellen zu einer einheitlichen Ansicht zusammen; Wheelmap und das zugrunde liegende OpenStreetMap sind dabei zwei wichtige Bausteine, aber nicht die einzigen. Beste Daten je Region — für jede Region binden wir die jeweils stärkste lokale Quelle ein; in der Schweiz etwa liefert Ginto besonders hochwertige Barrierefreiheitsdaten. Rollstuhlparkplätze — Accessible Places zeigt rollstuhlgerechte Parkplätze direkt auf der Karte, und die Frage „Wo ist der nächste Rollstuhlparkplatz?“ lässt sich mit einem Klick beantworten. Wenn du selbst Barrierefreiheitsdaten beitragen möchtest, ist Wheelmap.org der beste Ort dafür — neue Einträge erscheinen nach kurzer Zeit auch bei uns.",
  },
  {
    id: "reliability",
    q: "Wie verlässlich sind die Barrierefreiheitsinformationen?",
    a: "Die App kombiniert Daten aus mehreren spezialisierten Quellen: OpenStreetMap (OSM), accessibility.cloud (einschließlich Wheelmap.org), Ginto (für die Schweiz) und Google Places. Jede Quelle wird mit einem Verlässlichkeitswert gewichtet — von manuell verifizierten Einträgen bis hin zu automatisch erhobenen Daten. Der farbige Kreis bei jedem Eintrag zeigt auf einen Blick, wie gut die Datenlage ist.",
  },
  {
    id: "coloured-circle",
    q: "Was bedeutet der farbige Kreis bei jedem Eintrag?",
    a: "Grün steht für eine verlässliche Barrierefreiheitsinformation, Gelb für eine mittelgute Datenlage und Rot für eine unsichere oder unvollständige Datenlage. Die Farbe gibt also an, wie verlässlich die verfügbaren Informationen sind — nicht ob ein Ort barrierefrei ist oder nicht.",
  },
  {
    id: "free",
    q: "Ist die Suche nach barrierefreien Orten kostenlos?",
    a: "Ja, vollständig kostenlos und ohne Registrierung nutzbar.",
  },
  {
    id: "up-to-date",
    q: "Sind die Barrierefreiheitsinformationen aktuell und geprüft?",
    a: "Die Daten werden bei jeder Suche live aus den Quellen abgerufen. Manuell verifizierte Einträge von Wheelmap-Nutzern werden mit einem speziellen Badge hervorgehoben.",
  },
  {
    id: "mobile-app",
    q: "Kann ich barrierefreie Orte auch auf dem Smartphone suchen?",
    a: 'Ja — Accessible Places kann als App auf dem Smartphone installiert werden, ohne App Store oder Play Store. Auf iPhone/iPad: Safari öffnen → Teilen-Symbol antippen → "Zum Home-Bildschirm" wählen. Auf Android: Chrome öffnen → Menü (drei Punkte) → "App installieren" oder "Zum Startbildschirm hinzufügen". Die App funktioniert danach wie eine native App — mit eigenem Icon, Vollbild und ohne Browser-Leiste.',
  },
  {
    id: "feedback",
    q: "Wie kann ich Feedback geben oder einen Fehler melden?",
    a: 'Über den „Feedback"-Link am unteren Rand der Seite öffnet sich ein kurzes Formular. Kein Account, keine Registrierung notwendig.',
  },
  {
    id: "contribute-data",
    q: "Wie kann ich selbst Informationen zur Barrierefreiheit von Orten hinzufügen oder ändern?",
    a: (
      <>
        Der einfachste Weg: Rufe den gewünschten Ort auf Wheelmap.org auf und trage dort die
        Barrierefreiheitsinformationen direkt ein — kostenlos und ohne Vorkenntnisse. Wie das Schritt
        für Schritt funktioniert, erklärt das{" "}
        <a
          href="https://news.wheelmap.org/faq/#:~:text=Ortsdetails%20bearbeiten"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline hover:opacity-80"
        >
          Wheelmap-FAQ
        </a>
        . Da Accessible Places die Wheelmap-Daten regelmäßig abruft, stehen neue oder korrigierte
        Einträge in der Regel nach etwa 24 Stunden auch hier zur Verfügung.
      </>
    ),
    schemaText:
      "Der einfachste Weg: Rufe den gewünschten Ort auf Wheelmap.org auf und trage dort die Barrierefreiheitsinformationen direkt ein — kostenlos und ohne Vorkenntnisse. Wie das Schritt für Schritt funktioniert, erklärt das Wheelmap-FAQ unter https://news.wheelmap.org/faq/. Da Accessible Places die Wheelmap-Daten regelmäßig abruft, stehen neue oder korrigierte Einträge in der Regel nach etwa 24 Stunden auch hier zur Verfügung.",
  },
]

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_DE.map(({ q, a, schemaText }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: schemaText ?? (a as string) },
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
          {FAQ_DE.map(({ id, q, a }) => (
            <div
              key={id}
              id={id}
              className="scroll-mt-20 border-b border-border pb-6 last:border-0 last:pb-0"
            >
              <dt className="font-semibold text-sm mb-1.5">
                <a
                  href={`#${id}`}
                  className="group inline-flex items-baseline gap-1.5 hover:underline"
                >
                  <span>{q}</span>
                  <span
                    aria-hidden
                    className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    #
                  </span>
                </a>
              </dt>
              <dd className="text-sm text-muted-foreground leading-relaxed">{a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
