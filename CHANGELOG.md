# Changelog

Tabellarische Übersicht neu hinzugekommener **Funktionen** — keine Bugfixes, keine rein
optischen Anpassungen, keine Umbenennungen. Mehrere Commits, die zur selben Funktion
gehören (z. B. mehrstufige Ausbau-Phasen), zählen als eine Zeile mit dem Datum der
Ersteinführung. Neueste Einträge oben; wird bei jeder neuen Funktion fortgeführt.

| Datum | Funktion | Beschreibung | Umfang |
|---|---|---|---|
| 2026-08-17 | Öffnungszeiten: „Geöffnet"-Anzeige und Filter | Orte zeigen jetzt an, ob sie gerade geöffnet sind — als farbige Kurzangabe in der Ergebnisliste („Geöffnet", „Schließt in 20 Min", „Geschlossen · öffnet morgen 09:00"), in der Detailansicht zusätzlich über den rohen Öffnungszeiten aus OpenStreetMap, und im Quickstart-Modus auf der Detailseite. Neuer Filter „Nur jetzt geöffnete Orte"; Orte ohne hinterlegte Zeiten bleiben dabei bewusst sichtbar, weil die Datenlage stark schwankt (Stichprobe: Berlin ⌀76 %, ländlich ⌀39 % getaggte Öffnungszeiten). Ist keine eindeutige Aussage möglich — keine Angabe, unlesbares Format oder unklare Zeitzone —, wird gar nichts angezeigt statt einer vagen Vermutung. Die Bewertung erfolgt in der Zeitzone des Ortes, nicht der des Geräts | M |
| 2026-08-14 | In-App-Bewertungsanfrage (**v12.12**, Android + iOS) | Nach einer erfolgreichen Suche, bei der mindestens ein Ort mit vollständig bekannten Barrierefreiheits-Angaben (Eingang, Toilette, Sitzplätze) gefunden wurde, fragt die native App über den systemeigenen Dialog (Play In-App Review / Apple `SKStoreReviewController`) nach einer Bewertung — ohne die App zu verlassen. Maximal einmal pro App-Version; das Betriebssystem entscheidet selbst, ob und wie oft der Dialog tatsächlich erscheint | S |
| 2026-08-01 | Verlässlichkeit und Barrierefreiheit getrennt dargestellt (**v12.6**) | Der bisherige Score (Prozentzahl + Ampelfarbe für die Datenlage eines Ortes) wurde ersetzt, weil Nutzer:innen Rot fast immer als „nicht barrierefrei" statt als „Datenlage unsicher" gelesen haben. Neu: die Ampelfarbe auf Karte und Ergebnisliste zeigt jetzt ausschließlich, ob ein Ort die selbst gewählten Filterkriterien erfüllt (grün = uneingeschränkt, gelb = mit Einschränkung, grau = keine Angabe); wie gut eine einzelne Angabe belegt ist (Eingang/Toilette/Parkplatz je für sich: „sehr hoch"/„gut"/„gering", berechnet aus einer neuen quellen-additiven Formel statt der alten gedeckelten Mittelwertbildung) steht als Klartext direkt bei dieser Angabe in der Detailansicht. Das rote „Evtl. nicht barrierefrei"-Warnzeichen feuert nur noch bei einem echten „Nein", nicht mehr bei bloß fehlender Angabe | XL |
| 2026-08-01 | Schnellansicht für Karten-Popups (**v12.4**) | Popups auf der Karte öffnen jetzt kompakt (nur Titel + ein Status-Symbol + eine Zeile Kernaussage) statt in voller Länge — auf kleinen Handys deckte ein Popup bisher 40–90 % der Karte ab und erschwerte den Wechsel zwischen Orten. Ein „Mehr"/„Weniger"-Fußzeilen-Button klappt bei Bedarf Details, Chips und Aktionen aus bzw. wieder ein; die Karte rückt beim Aufklappen automatisch nach, falls das Popup sonst über den Kartenrand ragen würde | M |
| 2026-08-01 | Ortssuche im Quickstart-Modus zeigt Ergebnis-Screen statt Detailansicht (**v12.3**) | „Einen konkreten Ort suchen" landet jetzt auf demselben Karte+Liste-Ergebnis-Screen wie die anderen Suchwege: Karte springt zum gefundenen Ort mit offenem Popup, Ergebnis ist in der Liste markiert. „Zurück" führt zur Ortssuche zurück statt zur Kategorie-Auswahl | S |
| 2026-08-01 | Neue Kartendarstellung: MapLibre statt Leaflet (**v12.0**) | Kompletter Wechsel der Karten-Engine auf MapLibre GL JS mit Vektor-Kacheln (OpenFreeMap) statt Leaflet mit Raster-Kacheln — flüssigeres Zoomen/Rotieren-freie Darstellung, GPU-seitiges Clustering. Für Nutzer:innen äußerlich ähnlich (gleiche Pins, Popups, Bedienung), aber neu gerendert; mehrmonatiger interner Testlauf hinter einem Feature-Flag ging der Umstellung voraus. Hauptversionssprung wegen des vollständigen Austauschs der Karten-Implementierung | XL |
| 2026-07-30 | Euroschlüssel-WC-Filter + Marker-Kennzeichnung (**v11.19**) | Neuer Filter „Nur WCs mit Euroschlüssel" in der WC-Suche (Experten-Modus), unabhängig kombinierbar mit „Nur öffentliche/eigenständige WCs". Euroschlüssel-WCs werden auf der Karte zusätzlich als breitere Pillenform mit 🚻+🔑 statt des normalen Quadrat-Badges dargestellt | M |
| 2026-07-25 | Quickstart-Modus als Startansicht (**v11.0**) | Neue Installationen auf Smartphones starten in der reduzierten Ansicht (jetzt „Quickstart-Modus"), Desktop weiterhin im „Experten-Modus" (damals „Turbo-Modus"); bestehende Nutzer:innen bleiben unverändert. Umschalten per Ein-Klick-Icon im Kopfbereich beider Modi (Sprachwahl zieht dafür in die Einstellungen). Externe Links auf einen Ort oder auf Kategorie+Stadt öffnen sich direkt im Quickstart-Modus. Hauptversionssprung, weil damit erstmals eine zweite, eigenständige Oberfläche zur Standardansicht wird | XL |
| 2026-07-24 | Stadtsuche in der Einfachen Ansicht | Dritte, gleichwertige Kachel „In einer anderen Stadt suchen" neben „In meiner Nähe"/„Einen Ort suchen" — Kategorie-Suche in einer frei gewählten Stadt statt nur am eigenen Standort | M |
| 2026-07-24 | Rollstuhl-WC-Pflicht für Cafés/Restaurants/Hotels in der Einfachen Ansicht | Bei diesen drei Kategorien wird zusätzlich ein rollstuhlgerechtes WC vorausgesetzt (nur „Ja" zählt); die Ergebnisliste zeigt dafür auch die WC-Zeile, analog zum Eingang. Gilt auch bei „Alles anzeigen" | S |
| 2026-07-24 | „Hier suchen" in der Einfachen Ansicht | Beim Verschieben der Karte erscheint dieselbe „Hier suchen"-Pille wie im Vollmodus (für Orte und für Parken/WC), um am neuen Kartenausschnitt erneut zu suchen | S |
| 2026-07-23 | Parken/WC in der Einfachen Ansicht | Die zwei Amenity-Kacheln „Parken"/„WC" ergänzen die Kategorie-Kacheln der Einfachen Ansicht als eigene „Was möchten Sie suchen"-Option, inkl. Karte, Liste und Kartenabgleich wie im Vollmodus | S |
| 2026-07-20 | Ein-/ausklappbare Ebenen-Box mit integrierter Legende | „Ebenen: Parkplatz/WC" auf der Karte lässt sich einklappen (Zustand bleibt sitzungsübergreifend gespeichert); eingeklappt zeigt sie kompakte Icon-Chips nur für aktive Ebenen. Die frühere separate Karten-Legende ist eingebaut: jede Checkbox-Zeile zeigt direkt die zugehörige Marker-Farbe darunter, statt in einem zweiten Kasten daneben zu stehen | S |
| 2026-07-20 | 12 weitere Alltagskategorien | Schuhgeschäft, Bekleidung, Kiosk, Fahrradladen, Möbel, Metzgerei, Blumenladen, Waschsalon, Buchhandlung, Reha-Zentrum, Sporthalle, Tankstelle (51 Kategorien insgesamt) | M |
| 2026-07-16 | Hinweis bei möglicherweise nicht barrierefreien Orten | Neuer Warnhinweis + kontextabhängiger „Info ergänzen"-statt-„Melden"-Button, wenn Eingang/WC unbekannt oder negativ sind | M |
| 2026-07-14 | „Navigation starten" | Ein-Klick-Wegweiser vom Ort zur bevorzugten Karten-App des Geräts (Google Maps, Apple Maps) | M |
| 2026-07-13 | Freitext-Erkennung für Parkplatz/WC | Eingaben wie „Parkplatz in Köln" werden automatisch als Amenity-Suche statt als Kategoriesuche erkannt | S |
| 2026-07-11 | 12 weitere Kategorien + Gruppen-Chips | Zweite Kategorien-Erweiterung mit zweistufiger Drill-in-Navigation (Oberkategorie → Unterkategorie) | M |
| 2026-07-08 | Android App Links | Geteilte Ortslinks öffnen direkt in der App statt in einer Browser-Auswahl | M |
| 2026-07-07 | Verlässlichkeits-Anzeige pro Kriterium | Zeigt für Eingang/WC/Parkplatz einzeln an, wie verlässlich die jeweilige Angabe ist (Detailansicht, Karte, Liste) | M |
| 2026-07-06 | Android App Shortcuts | Long-Press aufs App-Icon öffnet Schnellzugriffe (z. B. direkt zur Umkreissuche) | S |
| 2026-07-02 | Anonyme Nutzungsstatistik | Öffentliches Dashboard mit Top-Nutzer:innen, Streak-Zählung, nach Plattform filterbar | M |
| 2026-07-02 | „Datenfehler melden" | Nutzer können über ein vorausgefülltes externes Formular fehlerhafte Daten zu einem Ort melden | M |
| 2026-06-26 | Ortssensitives Einzel-Suchfeld | Löst die getrennten Modus-Tabs (Umkreis/Text) durch ein einziges intelligentes Suchfeld ab | L |
| 2026-06-25 | WC/Parkplatz als eigene Schnellsuche | Aus der Hintergrund-Datenschicht wird ein sichtbarer, eigenständiger Suchmodus mit eigenen Chips | L |
| 2026-06-20 | WCAG-Barrierefreiheits-Überarbeitung | Sechsstufiges Programm: Landmarks, Tastaturbedienung, Fokus-Fallen, Live-Regions, Kontrast-Check, automatisierte Tests | XL |
| 2026-06-17 | iOS Quick Actions & Universal Links | Long-Press-Menü aufs App-Icon, geteilte Links öffnen direkt in der App statt im Browser | M |
| 2026-06-17 | Natives Teilen & Haptik | Systemeigenes Share-Sheet und Vibrationsfeedback statt Web-Fallback | S |
| 2026-06-16 | Native iOS-App | Capacitor-Shell fürs iPhone, gleiche Codebasis wie Android | L |
| 2026-06-16 | Internationaler Suchmodus | Opt-in-Erweiterung über DACH hinaus (FR, GB, NL, ES, IT, US), inkl. neuer Datenquelle AccèsLibre für Frankreich | L |
| 2026-06-14 | Standort-Button „Hier suchen" | GPS-Positionierung auf der Karte mit direkter Möglichkeit, den sichtbaren Ausschnitt zu durchsuchen | M |
| 2026-06-13 | 12 neue Alltagskategorien (Tranche 1) | Ärzte, Apotheken, Supermärkte, Bäckereien u. a. als durchsuchbare Kategorien | M |
| 2026-06-12 | Vereinheitlichtes Ort-/Namens-Suchfeld | Ein Suchfeld statt getrennter Felder, gruppierte Vorschläge (Orte vs. konkrete Venues) | M |
| 2026-06-06 | WC-/Parkplatz-Datenpipeline | Grundlage für eine eigene Suche nach barrierefreien Toiletten/Parkplätzen (Backend + erste Kartenanzeige) | L |
| 2026-06-06 | Easter Eggs | Verstecktes Rollstuhlrennen, Schütteln-zum-Mischen, Dev-Konsole per Tastenkombination | S |
| 2026-06-02/04 | Native Android-App | Erst als TWA, dann als Capacitor-Shell — App lädt die Live-Website nativ, inkl. GPS-Zugriff | L |
| 2026-05-31 | Schwache Parkplatz-Stufe | Zweite Anzeige-Kategorie für rollstuhlgerechte (aber nicht reservierte) Parkplätze auf der Karte | M |

---

## Archiv (älteres Format, bis v9.0)

## v9.0 — Unified Search & Amenity-Chips (2026-06-28)

Major release: Einheitliches Suchfeld, Parkplatz- und WC-Suche als Chips, überarbeitete Karten-Popups, WCAG AA.

### Neu
- **Einheitliches Suchfeld** — die Modi-Tabs „Überall" / „In der Nähe" sind weg. Ein Suchfeld mit inline-GPS-Button (⊕) übernimmt beides. Tippen → Ortssuche, ⊕ tippen → Sofortsuche in der Nähe.
- **🅿 Parken & 🚻 WC als Suchoptionen** — direkt im Chip-Streifen wählbar. Tippen ersetzt die Ergebnisliste durch sortierte Parkplatz- bzw. WC-Ergebnisse auf Karte und Liste.
- **Internationaler Modus** (opt-in) — Suche außerhalb DACH in FR, GB, NL, ES, IT, USA. Aktivierbar in den Einstellungen (Zahnrad).
- **Überarbeitete Karten-Popups** — einheitliches Layout für Venues, Parkplätze und WCs: farbiger Akzentbalken, ein fetter CTA-Button, WCAG-kontraste Textfarben.
- **Neuer Erststart-Screen** — klareres Onboarding mit zwei Aktionskarten (Standortsuche / Ortssuche).
- **WC-Suche via AccèsLibre** — französische Regierungsdatenbank als neue Quelle im internationalen Modus.

### Verbessert
- Parkplatz-Chip zeigt auch nicht-reservierte rollstuhlgerechte Plätze (Standard jetzt an).
- Reservierungsstatus im Parkplatz-Popup als Checkbox-Zeile statt Badge.
- Suchradius-Einstellung für Parkplätze & WCs mit Erklärungstext.
- Kartenausschnitt passt sich bei Parkplatz-/WC-Suche präziser an (GPS-Punkt ausgenommen).
- iOS: Eingabefeld zoomt bei Fokus nicht mehr automatisch rein.
- Nativer App-Splash übergibt nahtlos an die Web-Animation (kein Aufflackern mehr).

### Fixes
- Karten-Popup lag hinter der Trefferanzahl-Anzeige (Z-Order-Bug).
- Splash-Animation spielte bei Cold Launch nicht (React-Reconciliation-Bug).
- Veralteter Standortkontext wurde beim Tippen einer neuen Suche nicht immer gelöscht.

---

## v4.0 — WC-Suche & Amenity-System (2026-06-07)

Major feature release: Rollstuhl-WCs als eigenständige Karten-Ebene neben Parkplätzen.

### Neu
- **WC-Karten-Ebene** — Rollstuhl-WCs werden als eigenständige Marker auf der Karte angezeigt
  - Eigenständige öffentliche WCs (`amenity=toilets`) in Grün
  - WCs in Lokalitäten (`toilets:wheelchair`) in Violett
  - Euroschlüssel (🔑), Wickeltisch (👶), Zugangsbeschränkung (🚪) im Popup
  - Wheelmap-Link im Popup (für OSM-Nodes)
- **Fokus-Modus "Suche nur"** — GPS-basierte Sofortsuche für Parkplätze oder WCs in der Nähe
  - Exklusive Einzel-Auswahl (Parkplätze XOR WCs)
  - Label "Suche nur:" vor den Chips
- **Marker-Toggle** — Zwei unabhängige Pill-Buttons (🅿 Parkplätze / 🚻 WCs) ersetzen den 4-Weg-Segmented-Control
- **Einstellung "Nur öffentliche/eigenständige WCs"** — filtert Venue-WCs aus der Anzeige heraus
- **Suchradius für WC-Suche** — gleiche Einstellung wie für Parkplätze, max. 5 km

### Verbessert
- Legende zeigt Text auf allen Bildschirmgrößen (nicht mehr nur Desktop)
- Alle Karten-Chips (Parkplätze, WCs, Legende) einheitlich groß
- CSP: Vercel Analytics & Speed Insights Script-Domain freigegeben

---

## v3.x — Stable Baseline (bis 2026-06-06)

Letzte stabile Version vor dem Amenity-System: v3.130 (main) / v3.149 (feature/amenity-system).
Enthält: Parkplatz-Enrichment, Fokus-Modus, schwache Parkplatz-Stufe, Place-Search, Ginto-Adapter,
SEO-Landingpages, PWA, Android-App (Capacitor), GlitchTip-Fehlermonitoring.
