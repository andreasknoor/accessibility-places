# WCAG-Barrierefreiheit — Selbsteinschätzung & Umsetzungsplan

**Stand:** 2026-06-20. **Status: nur Planung, nichts umgesetzt.**
Ziel: Konformität zu **WCAG 2.2 Level AA** (= Basis für EN 301 549 / BFSG).

---

## Teil 1 — Ehrliche Selbsteinschätzung der KI-Beteiligung

### Was die KI verlässlich kann
- WCAG-2.2-Normtext verstehen und auf Code-Muster übersetzen.
- Statische Defekte finden: fehlende `alt`, Buttons ohne Namen, `div onClick`
  statt `button`, fehlende Labels/`lang`, Heading-Struktur, fehlende
  `aria-live` (aktuell **0** im Projekt), Markup-Tastaturfallen.
- Struktur-/Semantik-Fixes vorschlagen und implementieren.

### Harte Grenzen (nicht verhandelbar, keine Spekulation)
1. **Keine Wahrnehmung:** kein Sehen des Renderings, kein Screenreader, keine
   Tastatur-/Switch-Bedienung. Damit NICHT verifizierbar, nur plausibilisierbar:
   - Kontrast **1.4.3 / 1.4.11** (reale Farben, Overlays, Pins auf Karten, Text auf Fotos)
   - Reflow/Zoom **1.4.10**, Textabstände **1.4.12**
   - Fokus sichtbar/Reihenfolge **2.4.7 / 2.4.3** (Laufzeitverhalten)
   - Screenreader-Ausgabe **4.1.2 / 1.3.1** (nur realer AT-Test zeigt Sinnhaftigkeit)
2. **Menschliche Urteilskriterien:** Sinnhaftigkeit von `alt`-Texten,
   Verständlichkeit (3.1.5), Hilfreichkeit von Fehlermeldungen (3.3.3), kognitive Last.
3. **Laufzeit/Kontext entgeht statischer Analyse:** NDJSON-Streaming-Updates,
   Leaflet-Karten-Interaktion, Portale/Sheets/Fokusfallen, dynamisches `aria-expanded`.
4. **Keine Konformitäts-Zertifizierung möglich** — durch kein Tool. axe-core deckt
   ~30–40 % der SC ab; AA-Aussage braucht manuelle Experten-/AT-Tests.
5. **KI-Eigenrisiken:** SC-Nummern-Verwechslung, Überselbstsicherheit → daher
   Verifikationsschritte + Quellenprüfung im Plan, kein Verlass auf Gedächtnis.

### Realistische Aufwandsverteilung
- ~40–50 % AA-Arbeit: **KI direkt** (Markup/Semantik/ARIA/Struktur).
- ~20–30 %: **KI bereitet vor, Mensch/Tool verifiziert** (Kontrast, Fokusreihenfolge).
- ~30 %: **nur menschliche/AT-Tests** (Screenreader, Tastatur, Zoom, Kognition).

### Rollenverteilung
- **KI:** Code-/Semantik-Schicht, Aufbereitung, Fix-Implementierung.
- **Automatische Tools (axe, Lighthouse, Pa11y):** Regressionsnetz.
- **Mensch:** reale AT- und Wahrnehmungstests (nicht delegierbar).

---

## Teil 2 — Umsetzungsplan

> Reihenfolge: erst Audit-Infrastruktur, dann KI-machbare strukturelle Fixes,
> dann die Bereiche, die menschliche Verifikation brauchen. Jede Phase nennt,
> WER verifiziert.

### Phase 0 — Grundlagen & Audit-Infrastruktur (Voraussetzung) — ✅ UMGESETZT (Branch `feat/a11y-phase0-audit`)
- ✅ Ziel = WCAG 2.2 AA. Scope: App-Shell `/`+`/en`, SEO-Seiten, statische Seiten, native WebView.
- ✅ Automatisiertes Testing: `vitest-axe` in die bestehende vitest/jsdom-Suite
  integriert. Matcher in `vitest.setup.ts` registriert; Tests unter
  `__tests__/a11y/`; npm-Script `test:a11y`; CI-Workflow
  `.github/workflows/accessibility.yml` (läuft auf jedem Push/PR).
- ✅ Baseline: `ConfidenceBadge` und `PlaceCard` — **0 strukturelle Verstöße**.
- ⚠️ **Bewusste Grenze:** jsdom hat kein Layout/Paint → axe prüft hier NUR die
  strukturelle Teilmenge (Namen/Rollen/Labels/ARIA), **nicht** Kontrast/Reflow/
  Fokus-Sichtbarkeit. Dafür: manuelle/AT-Tests (Phase 3) + ggf. späteres
  Playwright+axe-Setup für echtes Browser-Rendering.
- **Manuelles Test-Setup** (zu nutzen ab Phase 1): VoiceOver (macOS: ⌘F5;
  iOS: Einst.→Bedienungshilfen), NVDA (Win), Nur-Tastatur (Tab/Shift-Tab/Enter/
  Esc/Pfeile), Browser-Zoom 400 %, `prefers-reduced-motion` (OS-Einstellung).
- **Verifikation:** ✅ Tooling grün in lokaler Suite; CI-Workflow eingecheckt.
  Offen: erster manueller Screenreader-Baseline-Durchlauf (Mensch).

### Phase 1 — KI-machbar: Semantik & Struktur (hohe Sicherheit)
- **Landmarks & Headings (1.3.1, 2.4.1):** `header`/`main`/`nav`/`footer`,
  „Skip to content"-Link, konsistente h1→hN-Hierarchie pro Seite.
- **Zugängliche Namen (4.1.2):** alle Icon-Buttons (Karte, Filter, Settings,
  Schließen, Sortierung, Sprache) mit `aria-label`/`aria-labelledby` prüfen
  (16× `aria-label` vorhanden — auf Vollständigkeit prüfen).
- **Bilder (1.1.1):** `alt` für Orts-Fotos (`PlaceDebugSheet`), dekorative SVGs
  `aria-hidden`, informative SVGs mit Namen (6× `<img>`, 2× `<svg>`-Dateien).
- **Formulare/Filter (3.3.2, 1.3.1):** Checkbox-/Radio-Labels in `FilterPanel`,
  `SettingsSheet`, Suchfeld-Label in `ChatPanel`.
- **Sprache (3.1.1/3.1.2):** `lang` am `<html>` (DE/EN-Layouts; bereits via
  `LangSetter` — verifizieren), inline-Sprachwechsel markieren.
- **Verifikation:** KI + axe; danach 1 manueller Screenreader-Durchlauf.

### Phase 2 — KI-machbar mit Laufzeit-Risiko: dynamische Zustände
- **Live-Regionen (4.1.3) — derzeit 0:** Suchstatus/Ergebnisanzahl/Ladezustand/
  Fehler als `aria-live="polite"` ansagen (NDJSON-Stream, „Keine Treffer",
  Radius-Erweiterung, „Treffer für <Name>"-Banner).
- **Fokus-Management (2.4.3, 2.1.2):** Sheets/Popovers (`PlaceDebugSheet`,
  `SettingsSheet`, `bottom-sheet`, `popover`) — Fokus fangen, bei Schließen
  zurückgeben, Esc schließt, keine Fokusfalle.
- **Tastaturbedienung (2.1.1):** Chips, Karten-Marker-Auswahl, Mobile-Tabbar,
  Autocomplete-Dropdown (Pfeile/Enter/Esc — `aria-activedescendant` vorhanden,
  prüfen) voll per Tastatur.
- **Verifikation:** zwingend **manueller Tastatur- + Screenreader-Test** (KI kann
  Markup setzen, aber das Erlebnis nicht prüfen).

### Phase 3 — Mensch/Tool nötig: Wahrnehmung
- **Kontrast (1.4.3/1.4.11):** Theme-Tokens in `globals.css` rechnerisch prüfen;
  **kritisch & nur visuell prüfbar:** Ampel-Pins (grün/gelb/rot) auf Kartenkacheln,
  Confidence-Badges, Text auf Orts-Fotos, Cluster-Icons.
- **Reflow/Zoom (1.4.10), Textabstände (1.4.12):** bei 320 px CSS-Breite und
  400 % Zoom kein Inhaltsverlust/horizontales Scrollen.
- **Bewegung (2.3.3, `prefers-reduced-motion`):** Splash, NavigationProgress,
  Marker-Animationen, Easter-Eggs (WheelchairRace) respektieren die Einstellung.
- **Verifikation:** **Mensch** (Kontrast-Tool + Augenschein + Zoom-Test).

### Phase 4 — Karte (Sonderfall, hohes Risiko)
- Leaflet-Karten sind notorisch schwer barrierefrei. Optionen prüfen:
  textbasierte Alternative zur Kartenansicht (Ergebnisliste deckt das großteils
  ab), Tastatur-Navigation der Marker, ARIA für Popups.
- **Realistische Erwartung:** vollständige AA-Karte ist evtl. nicht erreichbar;
  dann dokumentierte, gleichwertige Alternative (Liste) als Konformitätsweg.
- **Verifikation:** Mensch + AT.

### Phase 5 — Inhalt & Prozess
- **Sinnhaftigkeit (menschlich):** `alt`-Texte, Fehlermeldungen (3.3.3),
  Verständlichkeit der Texte review-en.
- **Barrierefreiheitserklärung** (BFSG-Pflicht für betroffene Anbieter)
  erstellen — inkl. ehrlicher Liste bekannter Einschränkungen (z. B. Karte).
- **Regression:** axe in CI als Dauerschutz; a11y-Checkliste in PR-Template.
- **Verifikation:** Mensch + CI.

---

## Wichtige Klarstellung
Dieser Plan macht die Website **messbar barrierefreier** und kann einen großen
Teil der AA-Kriterien erfüllen. Er kann **keine** AA-Konformität *garantieren* —
das erfordert die in Phase 2–5 markierten menschlichen/AT-Tests. Wer eine
rechtsverbindliche Aussage braucht, sollte zusätzlich ein externes
Accessibility-Audit beauftragen.

## Quellen (vor Detailarbeit gegenprüfen, nicht aus Gedächtnis)
- WCAG 2.2 Recommendation — https://www.w3.org/TR/WCAG22/
- How to Meet WCAG (Quickref) — https://www.w3.org/WAI/WCAG22/quickref/
- EN 301 549 / BFSG-Kontext — offizielle Quellen prüfen
