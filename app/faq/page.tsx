import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { FaqAccordion, type FaqCategory } from "@/components/faq/FaqAccordion"

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
const FAQ_CATEGORIES_DE: FaqCategory[] = [
  {
    id: "grundlagen",
    icon: "💡",
    label: "Grundlagen",
    items: [
      {
        id: "what-is",
        q: "Was ist Accessible Places?",
        a: "Accessible Places hilft Menschen mit Rollstuhl oder eingeschränkter Mobilität, barrierefreie Orte in Deutschland, Österreich und der Schweiz zu finden. Im Mittelpunkt steht die Verlässlichkeit der Informationen: Daten aus Google Maps sind in puncto Barrierefreiheit oft unvollständig und lassen sich dort kaum gezielt filtern. Accessible Places löst genau dieses Problem — mit einer schnellen, einfach zu bedienenden Suche, die Informationen aus mehreren Quellen zusammenführt und bewertet.",
      },
      {
        id: "which-venues",
        q: "Welche barrierefreien Orte kann ich finden — Restaurants, Hotels, Cafés?",
        a: "Restaurants, Cafés & Eisdielen, Bars, Kneipen, Biergärten, Imbisse, Hotels, Hostels, Ferienwohnungen, Museen, Theater, Kinos, Bibliotheken, Galerien, Sehenswürdigkeiten und Zoos — sowie Alltagsorte wie Apotheken, Arztpraxen, Zahnärzte, Tierärzte, Krankenhäuser, Drogerien, Supermärkte, Bäckereien, Friseure, Banken und Postfilialen.",
      },
      {
        id: "free",
        q: "Ist die Suche nach barrierefreien Orten kostenlos?",
        a: "Ja, vollständig kostenlos und ohne Registrierung nutzbar.",
      },
    ],
  },
  {
    id: "suchen-finden",
    icon: "🔍",
    label: "Suchen & Finden",
    items: [
      {
        id: "how-to-find",
        q: "Wie finde ich barrierefreie Orte in Deutschland, Österreich und der Schweiz?",
        a: 'Gib einfach einen Ort ein — zum Beispiel "Berlin Mitte" oder "Wien" — und wähle eine Kategorie wie Restaurant oder Hotel. Accessible Places durchsucht sofort mehrere Datenquellen und zeigt dir barrierefreie Orte in deiner Nähe. Die App funktioniert in der gesamten DACH-Region: Deutschland, Österreich und der Schweiz.',
      },
      {
        id: "find-nearby",
        q: "Wie finde ich barrierefreie Restaurants oder Cafés in meiner Nähe?",
        a: "Tippe auf den Standort-Button (⌖) neben dem Suchfeld und erteile der App die Standortfreigabe. Accessible Places ermittelt automatisch deinen Standort und sucht barrierefreie Restaurants, Cafés oder andere Orte in deiner direkten Umgebung — ohne dass du einen Ort eingeben musst.",
      },
      {
        id: "all-categories",
        q: "Welche Typen von Orten werden gesucht, wenn ich „Alle“ auswähle?",
        a: (
          <>
            <p>
              Mit dem Chip &bdquo;Alle&ldquo; durchsucht Accessible Places folgende 27 Orts-Kategorien gleichzeitig:
            </p>
            <p className="mt-2">
              <strong className="font-semibold text-foreground">Gastronomie:</strong> Restaurant, Café &amp; Eis, Bar, Kneipe/Pub, Biergarten, Imbiss/Fast Food ·{" "}
              <strong className="font-semibold text-foreground">Übernachtung:</strong> Hotel, Hostel, Ferienwohnung ·{" "}
              <strong className="font-semibold text-foreground">Kultur &amp; Freizeit:</strong> Museum, Theater, Kino, Bibliothek, Galerie, Sehenswürdigkeit, Zoo/Tierpark ·{" "}
              <strong className="font-semibold text-foreground">Gesundheit:</strong> Apotheke, Arztpraxis, Zahnarzt, Tierarzt, Krankenhaus ·{" "}
              <strong className="font-semibold text-foreground">Alltag:</strong> Drogerie, Supermarkt, Bäckerei, Friseur, Bank, Post
            </p>
            <p className="mt-2">
              Die sichtbaren Kategorie-Chips sind also nur eine Auswahl der beliebtesten Kategorien — &bdquo;Alle&ldquo; geht darüber hinaus. Nicht enthalten sind die Schnellsuche-Chips 🅿 Parken und 🚻 WC: Sie starten eine eigene Suche nach Parkplätzen bzw. WCs und sind keine Orts-Kategorie.
            </p>
          </>
        ),
        schemaText:
          "Mit dem Chip „Alle“ durchsucht Accessible Places folgende 27 Orts-Kategorien gleichzeitig: Gastronomie (Restaurant, Café & Eis, Bar, Kneipe/Pub, Biergarten, Imbiss/Fast Food), Übernachtung (Hotel, Hostel, Ferienwohnung), Kultur & Freizeit (Museum, Theater, Kino, Bibliothek, Galerie, Sehenswürdigkeit, Zoo/Tierpark), Gesundheit (Apotheke, Arztpraxis, Zahnarzt, Tierarzt, Krankenhaus) und Alltag (Drogerie, Supermarkt, Bäckerei, Friseur, Bank, Post). Die sichtbaren Kategorie-Chips sind nur eine Auswahl der beliebtesten Kategorien — „Alle“ geht darüber hinaus. Nicht enthalten sind die Schnellsuche-Chips 🅿 Parken und 🚻 WC: Sie starten eine eigene Suche nach Parkplätzen bzw. WCs und sind keine Orts-Kategorie.",
      },
      {
        id: "international-search",
        q: "Kann ich auch außerhalb von Deutschland, Österreich und der Schweiz suchen?",
        a: "Ja — über die internationale Suche, die du in den Einstellungen (Zahnrad-Symbol → „Internationale Suche\") aktivieren kannst. Standardmäßig ist sie ausgeschaltet, da Accessible Places primär auf die DACH-Region ausgelegt ist. Eingeschaltet hebt sie die Ländergrenze auf und durchsucht zusätzlich Frankreich, Großbritannien, die Niederlande, Spanien, Italien und die USA. Wichtig: Diese Funktion befindet sich noch in der Beta-Phase. Außerhalb der DACH-Region stehen weniger spezialisierte Datenquellen zur Verfügung, und die Datenlage variiert stark je nach Land — in großen Städten findest du meist brauchbare Treffer, in ländlichen Gegenden oft nur wenige oder gar keine. Ergebnisse können also unvollständig sein. Wir arbeiten daran, die internationale Abdeckung weiter zu verbessern.",
      },
      {
        id: "find-parking-toilet",
        q: "Wie finde ich ein Rollstuhl-WC oder einen Rollstuhlparkplatz in der Nähe?",
        a: (
          <>
            <p>
              Tippe auf den Standort-Button (⌖) oder gib deinen Ort ein. Unterhalb des Suchfelds findest du die Schnellsuche-Chips{" "}
              <strong className="font-semibold text-foreground">🅿 Parken</strong> und{" "}
              <strong className="font-semibold text-foreground">🚻 WC</strong>. Ein Tippen auf einen Chip ersetzt die normalen Suchergebnisse und zeigt auf der Karte rollstuhlgerechte Parkplätze bzw. barrierefreie WCs im eingestellten Suchradius (anpassbar unter Einstellungen).
            </p>
            <p className="mt-2">
              WC-Marker erscheinen in <strong className="font-semibold text-foreground">Grün</strong> für eigenständige öffentliche WCs (z.&nbsp;B. auf Plätzen oder in Parks) und in <strong className="font-semibold text-foreground">Violett</strong> für WCs in Lokalen oder anderen Orten. Tippe auf einen Marker für Details wie Euroschlüssel-Pflicht oder Wickeltisch.
            </p>
            <p className="mt-2">
              Alternativ kannst du über die <strong className="font-semibold text-foreground">Marker-Buttons</strong> links unten in der Karte (🅿 und 🚻) Parkplatz- oder WC-Marker zusätzlich zu deinen normalen Suchergebnissen einblenden.
            </p>
          </>
        ),
        schemaText:
          "Tippe auf den Standort-Button (⌖) oder gib deinen Ort ein. Unterhalb des Suchfelds findest du die Schnellsuche-Chips 🅿 Parken und 🚻 WC. Ein Tippen auf einen Chip ersetzt die normalen Suchergebnisse und zeigt rollstuhlgerechte Parkplätze bzw. barrierefreie WCs im eingestellten Suchradius. WC-Marker erscheinen in Grün für eigenständige öffentliche WCs und in Violett für WCs in Lokalen. Tippe auf einen Marker für Details wie Euroschlüssel-Pflicht oder Wickeltisch. Alternativ kannst du über die Marker-Buttons links unten in der Karte Parkplatz- oder WC-Marker zusätzlich zu deinen normalen Suchergebnissen einblenden.",
      },
    ],
  },
  {
    id: "daten-verlaesslichkeit",
    icon: "📊",
    label: "Daten & Verlässlichkeit",
    items: [
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
        id: "up-to-date",
        q: "Sind die Barrierefreiheitsinformationen aktuell und geprüft?",
        a: "Die Daten werden bei jeder Suche live aus den Quellen abgerufen. Manuell verifizierte Einträge von Wheelmap-Nutzern werden mit einem speziellen Badge hervorgehoben.",
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
                <strong className="font-semibold text-foreground">Mehrere Quellen, transparent bewertet:</strong>{" "}
                Accessible Places führt Daten aus verschiedenen Quellen zu einer einheitlichen Ansicht
                zusammen — von professionell zertifizierten Vor-Ort-Erhebungen über ehrenamtlich
                gepflegte Karten wie Wheelmap und OpenStreetMap bis zu automatisch zusammengetragenen
                Angaben, etwa aus Google Places. Jede Quelle hat ihre Stärken: Eine zertifizierte
                Erhebung dokumentiert einen Ort bis ins Detail, die Community bei Wheelmap und
                OpenStreetMap deckt eine enorme Breite an Orten ab und trägt vor Ort geprüfte
                Informationen bei, während automatisch erfasste Daten zwar fast überall verfügbar, aber
                oft ungenauer sind. Entsprechend unterschiedlich ist, wie umfassend und gesichert die
                Angaben pro Ort ausfallen. Statt diese Unterschiede zu verwischen, macht Accessible
                Places sie sichtbar: Ein farbiger Kreis zeigt bei jedem Eintrag auf einen Blick, wie
                belastbar die Information ist, und in der Detailansicht kannst du nachvollziehen, aus
                welchen Quellen sie stammt.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Beste Daten je Region:</strong> Für
                jede Region binden wir die jeweils stärkste lokale Quelle ein. In der Schweiz etwa
                liefert Ginto besonders hochwertige Barrierefreiheitsdaten. So entsteht überall die
                bestmögliche Datengrundlage.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Listenansicht statt Karte:</strong>{" "}
                Wheelmap.org zeigt Orte primär als Karte — du navigierst, um zu sehen, was in der Nähe
                ist. Accessible Places liefert die Ergebnisse zuerst als sortierte Liste: mit
                Verlässlichkeitsgrad, Eingangs- und Toiletteninformationen auf einen Blick. Die Karte ist
                als Alternative jederzeit verfügbar, steht aber nicht im Vordergrund.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Rollstuhlparkplätze:</strong>{" "}
                Accessible Places zeigt rollstuhlgerechte Parkplätze direkt auf der Karte. Die Frage &bdquo;Wo
                ist der nächste Rollstuhlparkplatz?&ldquo; lässt sich mit einem Klick beantworten — das bieten
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
          "Wheelmap.org und Accessible Places verfolgen ähnliche Ziele, setzen aber unterschiedliche Schwerpunkte — sie sind keine Konkurrenten, sondern ergänzen sich. Wheelmap ist eine der größten Crowdsourcing-Plattformen für Barrierefreiheit: Tausende Menschen tragen dort Orte direkt ein. Diese wertvollen Daten fließen auch in Accessible Places ein. Accessible Places konzentriert sich auf vier Dinge: Mehrere Quellen, transparent bewertet — Accessible Places führt Daten aus verschiedenen Quellen zu einer einheitlichen Ansicht zusammen, von professionell zertifizierten Vor-Ort-Erhebungen über ehrenamtlich gepflegte Karten wie Wheelmap und OpenStreetMap bis zu automatisch zusammengetragenen Angaben, etwa aus Google Places; jede Quelle hat ihre Stärken, und weil sie unterschiedlich umfassend und gesichert sind, zeigt ein farbiger Kreis bei jedem Eintrag, wie belastbar die Information ist. Beste Daten je Region — für jede Region binden wir die jeweils stärkste lokale Quelle ein; in der Schweiz etwa liefert Ginto besonders hochwertige Barrierefreiheitsdaten. Listenansicht statt Karte — Wheelmap.org zeigt Orte primär als Karte; Accessible Places liefert die Ergebnisse zuerst als sortierte Liste mit Verlässlichkeitsgrad und Detailinfos auf einen Blick — die Karte ist als Alternative jederzeit verfügbar. Rollstuhlparkplätze — Accessible Places zeigt rollstuhlgerechte Parkplätze direkt auf der Karte, und die Frage nach dem nächsten Rollstuhlparkplatz lässt sich mit einem Klick beantworten. Wenn du selbst Barrierefreiheitsdaten beitragen möchtest, ist Wheelmap.org der beste Ort dafür — neue Einträge erscheinen nach kurzer Zeit auch bei uns.",
      },
    ],
  },
  {
    id: "app-mitmachen",
    icon: "📱",
    label: "App & Mitmachen",
    items: [
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
    ],
  },
  {
    id: "barrierefreiheit-app",
    icon: "♿",
    label: "Barrierefreiheit dieser App",
    items: [
      {
        id: "a11y-statement",
        q: "Wie barrierefrei ist die App selbst?",
        a: "Accessible Places ist mit dem Ziel WCAG 2.1/2.2 Stufe AA entwickelt. Die Oberfläche ist per Tastatur bedienbar, mit Screenreadern (VoiceOver, TalkBack) nutzbar, kennzeichnet Bedienelemente mit zugänglichen Namen, sagt Suchergebnisse aktiv an und respektiert die Systemeinstellung „Bewegung reduzieren\". Farbkontraste der Bedienoberfläche erfüllen die WCAG-AA-Schwellen. Eine vollständige formale Konformitätsprüfung durch eine externe Stelle steht noch aus — die Erklärung beruht auf Eigenbewertung und automatisierten Tests.",
      },
      {
        id: "a11y-limitations",
        q: "Welche bekannten Einschränkungen gibt es?",
        a: (
          <>
            <p>Trotz sorgfältiger Umsetzung sind einige Bereiche noch nicht vollständig barrierefrei:</p>
            <ul className="list-disc pl-5 mt-2 flex flex-col gap-1.5">
              <li>
                <strong className="font-semibold text-foreground">Kartenansicht:</strong> Die einzelnen
                Markierungen auf der Karte lassen sich nicht per Tastatur ansteuern (technische Grenze der
                Kartenbibliothek). Als gleichwertige Alternative enthält die <strong className="font-semibold text-foreground">Ergebnisliste</strong> alle
                Treffer und ist vollständig per Tastatur und Screenreader bedienbar.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Kontrast auf der Karte:</strong> Farbige
                Markierungen und Text auf Fotos liegen über wechselnden Hintergründen; der Kontrast kann dort
                im Einzelfall unter den Zielwerten liegen.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Schriftgröße in der iOS-App:</strong> Die
                native iOS-App folgt der Einstellung &bdquo;Größerer Text&ldquo; nicht automatisch; Zwei-Finger-Zoom
                ist jedoch möglich.
              </li>
            </ul>
          </>
        ),
        schemaText:
          "Bekannte Einschränkungen: Kartenmarkierungen sind nicht per Tastatur ansteuerbar — die Ergebnisliste ist die gleichwertige, voll bedienbare Alternative. Kontrast von Markierungen/Text über Karten und Fotos kann im Einzelfall unter den Zielwerten liegen. Die native iOS-App folgt der Einstellung „Größerer Text\" nicht automatisch, Zwei-Finger-Zoom ist möglich.",
      },
      {
        id: "a11y-feedback",
        q: "Wie melde ich ein Barrierefreiheitsproblem?",
        a: 'Wenn dir eine Barriere auffällt, freuen wir uns über einen Hinweis über den „Feedback\"-Link am unteren Seitenrand — ohne Account oder Registrierung. Wir bemühen uns, gemeldete Probleme zeitnah zu beheben.',
      },
    ],
  },
]

const allItems = FAQ_CATEGORIES_DE.flatMap((c) => c.items)

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: allItems.map(({ q, a, schemaText }) => ({
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
      <main className="max-w-3xl mx-auto px-6 pt-safe-10 pb-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Zurück
        </Link>

        <h1 className="text-2xl font-bold mb-2">Häufige Fragen</h1>
        <p className="text-sm text-muted-foreground mb-8">
          {allItems.length} Fragen in {FAQ_CATEGORIES_DE.length} Kategorien
        </p>

        <FaqAccordion categories={FAQ_CATEGORIES_DE} />
      </main>
    </div>
  )
}
