# Changelog

Tabellarische Übersicht neu hinzugekommener **Funktionen** — keine Bugfixes, keine rein
optischen Anpassungen, keine Umbenennungen. Mehrere Commits, die zur selben Funktion
gehören (z. B. mehrstufige Ausbau-Phasen), zählen als eine Zeile mit dem Datum der
Ersteinführung. Neueste Einträge oben; wird bei jeder neuen Funktion fortgeführt.

| Datum | Funktion | Beschreibung | Umfang |
|---|---|---|---|
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
