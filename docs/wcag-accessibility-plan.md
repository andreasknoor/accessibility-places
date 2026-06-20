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

### Phase 1 — KI-machbar: Semantik & Struktur — 🟡 IN ARBEIT (Branch `feat/a11y-wcag`)
Bisher umgesetzt:
- ✅ **Landmarks + Skip-Link**: `<main id="main-content">` in Desktop- (`HomeClient`)
  und Mobile-Shell (`MobileLayout`, Welcome- **und** Tab-Content-Region) sowie in
  allen statischen Seiten (FAQ/Impressum/Datenschutz/Über/EN-Pendants). „Zum Inhalt
  springen"-Link (i18n `common.skipToContent`) als erstes fokussierbares Element.
- ✅ **Tastatur (2.1.1, vorgezogen aus Phase 2):** Treffer­karten waren per Tastatur
  nicht bedienbar (`<div onClick>` ohne Fokus/Enter). Der Ortsname ist jetzt ein
  echter `<button>` (fokussierbar, Enter/Space nativ) mit zugänglichem Namen
  (`results.openDetails(name)`); öffnet das Info-Sheet. Karten-Klick bleibt für Maus.
- ✅ Test: `PlaceCard`-Tastaturtest + axe-Baseline grün.

Weiter umgesetzt:
- ✅ **Zugängliche Namen (4.1.2):** Radius-Slider (`ui/slider` `thumbAriaLabel`,
  i18n `filters.radiusSliderLabel`); alle `SettingsSheet`-Controls (Toggle/Select/
  Slider) via `Row`-`aria-labelledby` (`useId` + `cloneElement`, kein Textduplikat);
  Settings-Panel als `role="dialog"` + `aria-labelledby`. Icon-Buttons (Schließen/
  Karte/Filter/Settings/Sprache) bereits mit `aria-label`.
- ✅ **Bilder (1.1.1):** Orts-Foto `alt={place.name}`; alle Logo-`<img>` dekorativ
  (`alt=""` `aria-hidden`); Kategorie-Emojis `aria-hidden`. Verifiziert.
- ✅ **Formulare/Filter:** axe gegen `FilterPanel`/`ResultsList`/`SettingsSheet`
  (offen) grün → Checkboxen/Controls korrekt benannt.
- ✅ **Sprache (3.1.1):** `lang` am `<html>` (root „de", `/en` via `LangSetter`).
- ✅ **axe-Suite erweitert:** ConfidenceBadge, PlaceCard, FilterPanel, ResultsList,
  SettingsSheet (geöffnet) — alle 0 strukturelle Verstöße.

Noch offen in Phase 1 / Übergabe an Phase 2–3:
- `ChatPanel`, `PlaceDebugSheet`, `MapView` noch nicht in der axe-Suite.
- **Verifikation:** weiterhin 1 manueller Screenreader-Durchlauf ausstehend (Mensch).

### Phase 2 — Dynamische Zustände — ✅ UMGESETZT (Branch `feat/a11y-wcag`)
- ✅ **Live-Regionen (4.1.3):** sr-only `role="status" aria-live="polite"` in
  `ResultsList` sagt Suchstatus an (lädt → „N Orte gefunden" / „keine Treffer",
  i18n `results.resultsAnnounce`). Mobile-Ladebalken bereits `role="status"`.
- ✅ **Fehler (4.1.3):** Fehler-Banner (Desktop + Mobile) als `role="alert"`.
- ✅ **Fokus-Management (2.4.3, 2.1.2):** gemeinsamer Hook `hooks/useFocusTrap`
  (Fokus rein beim Öffnen, Tab-Trap, Esc schließt, Fokus zurück zum Auslöser)
  in `PlaceDebugSheet`, `SettingsSheet` **und** `bottom-sheet`; alle drei jetzt
  `role="dialog" aria-modal aria-labelledby` + `tabIndex=-1`. Behebt den gemeldeten
  Bug „Tab bleibt nach Enter in der Trefferliste statt im Detail-Sheet".
- ✅ **Tastaturbedienung (2.1.1):** Trefferkarten (Phase 1), Chips (native
  `<button>`), Mobile-Tabbar (`<button>` + `aria-current`), Autocomplete-Dropdown
  (`role="combobox"`/`option`, Pfeile/Enter/Esc, `aria-activedescendant`) — alle
  per Tastatur bedienbar. **Karten-Marker → Phase 4.**
- ✅ Tests: Sheet-Fokus + Esc; axe-Suite weiterhin grün.
- **Verifikation:** weiterhin ausstehend: **manueller Tastatur-/Screenreader-Test** (Mensch).

### Native Apps (Capacitor iOS/Android) — 🟡 teilweise umgesetzt
A11y wird zu ~95 % vom Web vererbt (VoiceOver/TalkBack lesen den WebView-Inhalt;
unsere Phase-1/2-Semantik wirkt nativ automatisch). Native-spezifisch:
- ✅ **Pinch-Zoom (1.4.4):** `userScalable: false`/`maximumScale: 1` entfernt
  (`app/layout.tsx`). Native WebViews befolgen `user-scalable=no` (anders als
  mobiles Safari) — hätte sehbehinderte native Nutzer ausgesperrt.
- ✅ **Standort-Berechtigung EN+DE:** beide `Info.plist`-Usage-Strings zweisprachig
  (sicher ohne pbxproj-Eingriff; saubere `.lproj`-Lokalisierung wäre Xcode-Aufgabe).
- ✅ `prefers-reduced-motion` wird vom OS an den WebView durchgereicht (→ Phase 3 CSS deckt nativ ab).
- ⚠️ **iOS Dynamic Type:** WKWebView skaliert Web-Text nicht mit „Größerer Text";
  WKWebView-inhärent, Pinch-Zoom ist die Abmilderung. Android-WebView respektiert
  System-Schriftgröße (kein `textZoom`-Override).
- ⚠️ **Nicht KI-verifizierbar:** echtes VoiceOver/TalkBack-Verhalten in der
  gebauten App → Geräte-Test (Mensch).

### Phase 3 — Wahrnehmung — 🟡 teilweise umgesetzt (Branch `feat/a11y-wcag`)
- ✅ **Kontrast (1.4.3) — Token-basiert maschinell:** `scripts/check-contrast.mjs`
  parst die `:root`-HSL-Tokens, berechnet das WCAG-Verhältnis je fg/bg-Paar und
  gated CI (`npm run check:contrast`, in `accessibility.yml`). 3 Token-Verstöße
  behoben: `muted-foreground` 46.9→44.9 % L; `destructive` 60.2→49.5 % L;
  `destructive-foreground` → reines Weiß. Alle 13 gatenden Paare bestehen.
  `border` (1.23:1) ist **review-only** (dekorative Divider sind von 1.4.11
  ausgenommen; nur sole-indicator-Component-Boundaries müssen 3:1 — Design-Review).
- ✅ **Bewegung (2.3.3, `prefers-reduced-motion`):** zusätzlich zum vorhandenen
  Handling (loading-bar, wheelchair-race/once) globaler Safety-Net in `globals.css`
  (`*` animation/transition-duration → 0.01ms), deckt Tailwind-`animate-*`,
  Marker-Scale, Input-Pulse, Route-Progress, Hover-Transitions ab.
- ⚠️ **Nur Tool/Mensch (nicht KI):**
  - Kontrast komponierter Farben: Ampel-Pins auf Kartenkacheln, Cluster-Icons,
    Text auf Orts-Fotos (Hintergrund variabel/unbekannt → nicht berechenbar).
  - **Reflow/Zoom (1.4.10), Textabstände (1.4.12):** 320 px / 400 % Zoom ohne
    Inhaltsverlust — braucht echtes Browser-Rendering.
- **Verifikation:** Browser-Tool (axe/Lighthouse im echten Rendering) + Augenschein.

### Phase 4 — Karte — ✅ umgesetzt (gleichwertige-Alternative-Ansatz) (Branch `feat/a11y-wcag`)
- ✅ **Benannte Region (1.1.1/1.3.1):** Karten-Container `role="region"` +
  `aria-label` (i18n `map.regionLabel`), das ausdrücklich auf die Ergebnisliste
  als gleichwertige Text-Alternative verweist.
- ✅ **Controls benannt:** Vollbild (`aria-label` ergänzt), Standort, Legende,
  Schließen mit `aria-label`; „Hier suchen" + Parking/WC-Toggles haben sichtbare
  Text-Labels (`aria-pressed` an den Toggles), Emojis `aria-hidden`.
- ⚠️ **Marker nicht einzeln tastaturfokussierbar** (Leaflet-Grenze). Eine
  vollständige AA-Karte ist damit nicht erreichbar — der **konforme Weg ist die
  gleichwertige Alternative**: die Ergebnisliste enthält alle Treffer voll
  tastatur-/AT-bedienbar (Phase 1/2). Bewusste, dokumentierte Entscheidung.
- **Verifikation:** Mensch + AT (Karte ist supplementär; Liste ist der Pfad).

### Phase 5 — Inhalt & Prozess — ✅ umgesetzt (Branch `feat/a11y-wcag`)
- ✅ **Barrierefreiheitserklärung:** als eigener FAQ-Abschnitt „Barrierefreiheit
  dieser App" / „Accessibility of this app" (DE `app/faq`, EN `app/en/faq`) —
  Konformitätsstatus (AA-Ziel, Eigenbewertung), ehrliche Liste bekannter
  Einschränkungen (Karte/Marker, komponierter Kontrast, iOS Dynamic Type) und
  Feedback-Weg. Platzierung bewusst in der FAQ gewählt (kein neuer Footer-Link).
- ✅ **Regression/Prozess:** axe + Kontrast in CI (`accessibility.yml`);
  a11y-Checkliste im neuen `.github/pull_request_template.md`.
- 🟡 **Sinnhaftigkeit (menschlich):** `alt`-Texte/Fehlermeldungen sind gesetzt und
  i18n-isiert; finale inhaltliche Bewertung (3.3.3, Verständlichkeit) bleibt
  menschliche Aufgabe.
- **Verifikation:** Mensch + CI.

---

## Gesamtstatus (Stand v8.40, Branch `feat/a11y-wcag`)
KI-machbarer Teil von Phase 0–5 + Native umgesetzt und in CI abgesichert
(axe-Strukturtests, Token-Kontrast-Gate). **Noch offen — nur durch Menschen
leistbar:** echter Tastatur-/Screenreader-Durchlauf (VoiceOver/TalkBack),
Reflow/Zoom bei 320 px/400 %, visuelle Kontrastprüfung komponierter Flächen
(Karten-Pins, Text auf Fotos), inhaltliche Text-Verständlichkeit, sowie eine
externe formale AA-Konformitätsprüfung für eine rechtsverbindliche Aussage.

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
