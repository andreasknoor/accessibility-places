import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

const BASE = "https://accessible-places.org"

export const metadata: Metadata = {
  title: "Datenschutz",
  description: "Datenschutzerklärung für Accessible Places — barrierefreie Orte in der DACH-Region finden.",
  alternates: {
    canonical: `${BASE}/datenschutz`,
    languages: { de: `${BASE}/datenschutz`, en: `${BASE}/en/privacy` },
  },
}

export default function DatenschutzPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-lg mx-auto px-6 py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Zurück
        </Link>

        <h1 className="text-2xl font-bold mb-8">Datenschutzerklärung</h1>

        <div className="flex flex-col gap-6 text-sm text-muted-foreground leading-relaxed">

          <section>
            <h2 className="font-semibold text-foreground mb-2">1. Verantwortlicher</h2>
            <p>
              Verantwortlicher im Sinne der DSGVO ist Andreas Knoor. Kontaktdaten
              sind dem{" "}
              <Link href="/impressum" className="text-primary underline hover:opacity-80">
                Impressum
              </Link>{" "}
              zu entnehmen.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground mb-2">2. Erhobene Daten und Zwecke</h2>

            <h3 className="font-medium text-foreground mt-3 mb-1">Standortdaten</h3>
            <p>
              Die Funktion &ldquo;In der Nähe&rdquo; nutzt die Geolocation-API des Browsers, um
              deinen aktuellen Standort zu ermitteln. Die Koordinaten werden
              ausschließlich für die Suche verwendet und nicht dauerhaft gespeichert.
              Die Standortabfrage erfolgt nur nach expliziter Zustimmung.
            </p>

            <h3 className="font-medium text-foreground mt-3 mb-1">Suchanfragen</h3>
            <p>
              Suchanfragen (Ort, Kategorie) werden serverseitig verarbeitet und an
              externe Datendienste weitergeleitet (siehe Abschnitt 3). Es werden keine
              Suchanfragen dauerhaft gespeichert.
            </p>

            <h3 className="font-medium text-foreground mt-3 mb-1">Nutzungseinstellungen</h3>
            <p>
              Einstellungen wie Filtervoreinstellungen und Anzeigeoptionen werden
              ausschließlich lokal im Gerätespeicher (localStorage) abgelegt und nicht
              an Server übermittelt.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground mb-2">3. Externe Dienste</h2>
            <p className="mb-2">
              Die App nutzt folgende externe Dienste. Bei jeder Suche werden die
              notwendigen Daten (Standortkoordinaten oder Ortsbezeichnung, Kategorie)
              an diese Dienste übermittelt:
            </p>
            <ul className="list-disc pl-5 flex flex-col gap-1.5">
              <li>
                <strong className="text-foreground">OpenStreetMap / Overpass API</strong> —
                Abfrage von Barrierefreiheitsdaten.
                Betreiber: OpenStreetMap Foundation, UK.{" "}
                <a href="https://wiki.osmfoundation.org/wiki/Privacy_Policy" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80">Datenschutzerklärung</a>
              </li>
              <li>
                <strong className="text-foreground">Nominatim / Photon (Komoot)</strong> —
                Ortssuche und Adressvorschläge.
                Betreiber: OpenStreetMap Foundation bzw. Komoot GmbH, Berlin.{" "}
                <a href="https://www.komoot.com/de-de/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80">Datenschutzerklärung Komoot</a>
              </li>
              <li>
                <strong className="text-foreground">accessibility.cloud</strong> —
                Barrierefreiheitsdaten (inkl. Wheelmap.org). Betreiber: Sozialhelden e.V., Berlin.{" "}
                <a href="https://www.accessibility.cloud/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80">Datenschutzerklärung</a>
              </li>
              <li>
                <strong className="text-foreground">Ginto</strong> —
                Barrierefreiheitsdaten Schweiz. Betreiber: Ginto AG, Schweiz.{" "}
                <a href="https://ginto.guide" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80">ginto.guide</a>
              </li>
              <li>
                <strong className="text-foreground">Google Places API</strong> —
                Ergänzende Ortsdaten. Betreiber: Google Ireland Ltd., Dublin.{" "}
                <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80">Datenschutzerklärung</a>
              </li>
              <li>
                <strong className="text-foreground">Vercel</strong> —
                Hosting und Infrastruktur. Betreiber: Vercel Inc., San Francisco.{" "}
                <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80">Datenschutzerklärung</a>
              </li>
              <li>
                <strong className="text-foreground">Vercel Analytics / Speed Insights</strong> —
                Anonyme Nutzungsstatistiken und Core Web Vitals. Es werden keine
                personenbezogenen Daten erhoben. Betreiber: Vercel Inc.
              </li>
              <li>
                <strong className="text-foreground">Tally</strong> —
                Feedback-Formular. Betreiber: Tally BV, Belgien.{" "}
                <a href="https://tally.so/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80">Datenschutzerklärung</a>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-foreground mb-2">4. Kartenansicht</h2>
            <p>
              Kartenkacheln werden von OpenStreetMap-Servern geladen. Dabei wird
              deine IP-Adresse an den jeweiligen Tile-Server übermittelt.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground mb-2">5. Rechtsgrundlage</h2>
            <p>
              Die Verarbeitung erfolgt auf Grundlage von Art. 6 Abs. 1 lit. b DSGVO
              (Vertragserfüllung / vorvertragliche Maßnahmen) sowie Art. 6 Abs. 1 lit. f
              DSGVO (berechtigtes Interesse an einer funktionsfähigen App).
              Standortdaten werden nur auf Grundlage deiner ausdrücklichen Einwilligung
              (Art. 6 Abs. 1 lit. a DSGVO) verarbeitet.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground mb-2">6. Deine Rechte</h2>
            <p>
              Du hast das Recht auf Auskunft, Berichtigung, Löschung und
              Einschränkung der Verarbeitung sowie das Recht auf Datenübertragbarkeit
              und Widerspruch. Anfragen richtest du an die im{" "}
              <Link href="/impressum" className="text-primary underline hover:opacity-80">
                Impressum
              </Link>{" "}
              genannte Kontaktadresse. Außerdem hast du das Recht, dich bei einer
              Datenschutzaufsichtsbehörde zu beschweren.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground mb-2">7. Änderungen</h2>
            <p>
              Diese Datenschutzerklärung kann bei Bedarf aktualisiert werden. Die
              aktuelle Fassung ist stets unter accessible-places.org/datenschutz
              abrufbar.
            </p>
          </section>

        </div>
      </div>
    </div>
  )
}
