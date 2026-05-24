import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

const BASE = "https://accessible-places.org"

export const metadata: Metadata = {
  title: "Über die App",
  description:
    "Accessible Places ist eine kostenlose Web-App, die Rollstuhlfahrern und Menschen mit Gehbehinderung hilft, verlässliche Barrierefreiheitsdaten in Deutschland, Österreich und der Schweiz zu finden.",
  alternates: {
    canonical: `${BASE}/ueber-uns`,
    languages: { de: `${BASE}/ueber-uns`, en: `${BASE}/en/ueber-uns` },
  },
}

export default function UeberUnsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-6 py-10">

        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Zurück
        </Link>

        <h1 className="text-2xl font-bold mb-3 leading-snug">
          Accessible Places: Die neue Echtzeit-Plattform für verlässliche Rollstuhl-Navigation in der DACH-Region
        </h1>
        <p className="text-sm text-muted-foreground mb-8">Ein Überblick über das Projekt, die Idee dahinter und wie die App funktioniert.</p>

        {/* Projekt im Überblick — bordered box */}
        <div className="rounded-xl border border-border bg-card p-5 mb-10">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-4">Das Projekt im Überblick</h2>
          <dl className="grid gap-2.5 text-sm">
            {[
              ["Name",                "Accessible Places"],
              ["Website",             "accessible-places.org"],
              ["Konzept",             "Aggregation und Echtzeit-Bewertung von Barrierefreiheitsdaten aus mehreren Quellen"],
              ["Region",              "Deutschland, Österreich und die Schweiz (DACH)"],
              ["Datenquellen",        "OpenStreetMap (OSM), accessibility.cloud (u. a. Wheelmap.org), Ginto (Schweiz), Google Places"],
              ["Geschäftsmodell",     "100 % kostenlos · werbefrei · ohne Registrierung · privates Non-Profit-Projekt"],
            ].map(([label, value]) => (
              <div key={label} className="grid grid-cols-[10rem_1fr] gap-x-3">
                <dt className="font-medium text-muted-foreground shrink-0">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex flex-col gap-10 text-sm leading-relaxed">

          <section>
            <h2 className="text-lg font-bold mb-3">Was ist Accessible Places?</h2>
            <p className="text-muted-foreground">
              Mal ehrlich: Jeder von uns liebt Ausflüge an neue, unbekannte Orte. Einfach mal rauskommen, Neues entdecken und eine gute, vor allem sorgenfreie Zeit verbringen. Genau das wünschen sich natürlich auch Menschen im Rollstuhl oder mit Gehbehinderung – doch die Realität im Alltag sieht meistens alles andere als sorgenfrei aus.
            </p>
            <p className="text-muted-foreground mt-3">
              Bei der Urlaubs- oder Wochenendplanung ploppen sofort handfeste Fragen auf: Hat das Restaurant eigentlich einen stufenlosen Eingang? Gibt es ein Rollstuhl-WC mit stabilen Haltegriffen? Und wie sieht es mit einem breiten Behindertenparkplatz direkt am Eingang aus – oder gibt es zumindest in der näheren Umgebung eine Parkmöglichkeit? Und wenn ja: Wo genau?
            </p>
            <p className="text-muted-foreground mt-3">
              Solche essentiellen Fragen sind im Netz leider oft unheimlich schwer zu beantworten. Genau dafür wurde „Accessible Places" entwickelt. Die Web-App will Schluss machen mit der mühsamen Suche nach Rollstuhl-relevanten Informationen über unzählige verschiedene Websites hinweg. Und sie beantwortet die wohl wichtigste Frage überhaupt: Wie verlässlich sind die Informationen wirklich?
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">Das Problem mit den Standard-Karten</h2>
            <p className="text-muted-foreground">
              Wenn wir unterwegs sind, wandert der Finger meistens automatisch zu Google Maps, Bing Maps oder Apple Maps. Das ist für die reine Routenführung super, stößt beim Thema Barrierefreiheit aber schnell an Grenzen. Strukturierte Informationen sucht man dort oft vergebens, und gezielte Filter für Rollstuhlfahrer fehlen fast völlig. Man wühlt sich stattdessen mühsam durch Rezensionen, weil ein Label wie „Rollstuhlgeeignet: Ja" im Alltag oft viel zu ungenau oder schlicht veraltet ist. Im schlimmsten Fall steht man dann abends vor einer unüberwindbaren Stufe.
            </p>
            <p className="text-muted-foreground mt-3">
              Accessible Places geht einen anderen Weg. Statt sich auf eine einzige, oft lückenhafte Quelle zu verlassen, führt die Plattform die Daten verschiedener Spezialisten live und in Echtzeit zusammen. Bei einer Abfrage zapft die Seite im Hintergrund Quellen wie OpenStreetMap, accessibility.cloud (wozu auch die bekannten Daten von Wheelmap.org gehören) oder Ginto mit speziellen Informationen für die Schweiz an. Auf Wunsch können Daten von Google Maps ergänzend hinzugefügt werden – allerdings als reine Anreicherung und niemals als einzige Informationsquelle, auf die man sich blind verlassen muss.
            </p>
            <blockquote className="mt-4 pl-4 border-l-2 border-primary italic text-foreground">
              „Wer im Rollstuhl sitzt, braucht keine vagen Vermutungen, sondern verlässliche Fakten."
            </blockquote>
            <p className="text-muted-foreground mt-3">
              Mit Accessible Places wollte ich ein Tool schaffen, das die besten Datenquellen bündelt und dem Nutzer sofort transparent anzeigt, wie sicher eine Information im Moment ist – ohne Barrieren, ohne Kosten und ohne Datensammlung im Hintergrund.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">Nicht suchen, sondern finden: Drei Wege ans Ziel</h2>
            <p className="text-muted-foreground mb-4">
              Das oberste Ziel von Accessible Places ist es, je nach Situation den kürzesten Weg zur gewünschten Information bereitzustellen. Dafür bietet das Tool drei intuitive Suchmodi:
            </p>
            <ol className="flex flex-col gap-4">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center mt-0.5">1</span>
                <div>
                  <p className="font-semibold">In der Nähe</p>
                  <p className="text-muted-foreground mt-0.5">Perfekt für spontane Entscheidungen von unterwegs. Die App ermittelt (nach Freigabe) automatisch den Standort des Smartphones und zeigt sofort die nächsten barrierefreien Restaurants, Cafés oder Kinos in der direkten Umgebung an.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center mt-0.5">2</span>
                <div>
                  <p className="font-semibold">Erkunden</p>
                  <p className="text-muted-foreground mt-0.5">Ideal für die Urlaubs- oder Ausflugsplanung im Vorfeld. Nutzer geben einfach den Zielort und eine Kategorie (z.&nbsp;B. Hotel oder Theater) ein. Die besten Treffer werden übersichtlich in einer Liste oder grafisch auf einer Karte dargestellt.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center mt-0.5">3</span>
                <div>
                  <p className="font-semibold">Ort suchen</p>
                  <p className="text-muted-foreground mt-0.5">Die gezielte Abfrage für eine ganz bestimmte Location. Wer wissen möchte, wie es um die Barrierefreiheit einer konkreten Sehenswürdigkeit, eines Museums oder einer Bar steht, gibt einfach den Namen ein und erhält sofort alle verfügbaren Details zu Eingang, WC und Parkplatz.</p>
                </div>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">Der Farbcode: Warum Rot nicht gleich „ungeeignet" bedeutet</h2>
            <p className="text-muted-foreground mb-4">
              Ein zentrales Element, das beim Nutzen sofort ins Auge fällt, ist das Ampelsystem in Kombination mit einem „Verlässlichkeitswert". Diese Farbcodes finden sich sowohl in den Suchergebnissen als auch als kleine Kreise in der Kartenansicht. Hier verbirgt sich ein entscheidender, innovativer Ansatz: Die Ampelfarben zeigen primär nicht an, ob ein Ort barrierefrei ist, sondern wie verlässlich die Datenlage im Hintergrund aktuell ist.
            </p>
            <ul className="flex flex-col gap-3">
              <li className="flex items-start gap-3">
                <span className="text-lg leading-none mt-0.5">🔴</span>
                <p className="text-muted-foreground"><span className="font-semibold text-foreground">Rot</span> bedeutet nicht automatisch, dass der Ort unzugänglich ist. Es heißt lediglich, dass die Datenlage im Moment noch unvollständig oder unsicher ist (z.&nbsp;B. wenn nur unbestätigte Basisdaten von Google Maps vorliegen).</p>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-lg leading-none mt-0.5">🟡</span>
                <p className="text-muted-foreground"><span className="font-semibold text-foreground">Gelb</span> steht für eine solide, mittelgute und plausible Datenbasis.</p>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-lg leading-none mt-0.5">🟢</span>
                <p className="text-muted-foreground"><span className="font-semibold text-foreground">Grün</span> bedeutet: Die Informationen sind absolut verlässlich und wurden in der Regel durch die Community (z.&nbsp;B. von Wheelmap-Nutzern) manuell geprüft und verifiziert. Zudem werden manuell geprüfte Einträge mit einem speziellen Badge hervorgehoben.</p>
              </li>
            </ul>
            <p className="text-muted-foreground mt-4">
              Dieser ehrliche Ansatz vermeidet böse Überraschungen vor Ort. Man weiß sofort, wann man den Daten der App blind vertrauen kann und wann es ratsam ist, zur Sicherheit doch noch kurz telefonisch beim Betreiber nachzufragen.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">Ein echtes Herzensprojekt für die DACH-Region – komplett kostenlos</h2>
            <p className="text-muted-foreground">
              Accessible Places ist ein privates, nicht-kommerzielles Hobby-Projekt. Es ist komplett kostenlos, verlangt keinerlei Registrierung oder persönliche Daten und ist zu 100&nbsp;% werbefrei.
            </p>
            <p className="text-muted-foreground mt-3">
              Das Ganze funktioniert bereits flächendeckend in Deutschland, Österreich und der Schweiz. Egal, ob in Berlin-Mitte, Wien oder Zürich nach einem barrierefreien Hotel, einem gemütlichen Café oder einer Eisdiele gesucht wird – die Plattform hilft, mit minimalem Aufwand an die besten verfügbaren Informationen zum Thema Barrierefreiheit zu gelangen. Bei Fehlern oder Verbesserungsvorschlägen können Nutzer zudem unkompliziert über ein integriertes Formular sofort Feedback geben.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">Praktischer Tipp: Die App ohne App-Store-Zwang nutzen</h2>
            <p className="text-muted-foreground mb-4">
              Man muss nicht erst den Apple App Store oder Google Play Store bemühen, um sich das Tool herunterzuladen. Da Accessible Places als moderne Progressive Web App (PWA) entwickelt wurde, lässt sie sich direkt aus dem mobilen Browser heraus installieren:
            </p>
            <ul className="flex flex-col gap-3">
              <li className="flex items-start gap-2.5">
                <span className="text-base leading-none mt-0.5">📱</span>
                <p className="text-muted-foreground"><span className="font-semibold text-foreground">iPhone (Safari):</span> Unten auf das Teilen-Symbol tippen (das Viereck mit dem Pfeil nach oben) und „Zum Home-Bildschirm" wählen.</p>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="text-base leading-none mt-0.5">🤖</span>
                <p className="text-muted-foreground"><span className="font-semibold text-foreground">Android (Chrome):</span> Oben rechts auf das Drei-Punkte-Menü tippen und „App installieren" oder „Zum Startbildschirm hinzufügen" wählen.</p>
              </li>
            </ul>
            <p className="text-muted-foreground mt-4">
              Schon landet Accessible Places als vollwertige App auf dem Startbildschirm des Smartphones, inklusive eigenem Icon und im schicken Vollbildmodus ohne störende Browserleisten.
            </p>
          </section>

          <p className="text-muted-foreground pt-2 border-t border-border">
            Einfach, unabhängig und wirklich nützlich. Probieren Sie es am besten direkt selbst aus unter:{" "}
            <Link href="/" className="text-primary hover:underline font-medium">
              accessible-places.org
            </Link>
          </p>

        </div>
      </div>
    </div>
  )
}
