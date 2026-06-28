# Changelog

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
