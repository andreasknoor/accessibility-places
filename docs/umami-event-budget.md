# Umami-Event-Budget — Reduktionsstrategien (Planung)

**Stand:** 2026-06-20. **Status: nur Planung, nichts umgesetzt.**
Kontext: Umami Cloud läuft optional parallel zu Vercel Analytics
(`NEXT_PUBLIC_UMAMI_WEBSITE_ID`, siehe `docs/analytics-alternatives.md`). Der
Umami-Free-Tier (Hobby) erlaubt **100k Events/Monat**. Umami zählt **Pageviews +
jedes Custom-Event + jede gespeicherte Event-Property** je als ein Event.

## Event-Inventur (heutiger Stand)

Custom-Events feuern über `lib/analytics.ts` → tragen alle die `platform`-Property.

| Event | Props | Umami-Zählungen | Frequenz | Quelle |
|---|---|---|---|---|
| `search` | mode, result_count, platform | **4** | hoch | HomeClient |
| `suggest_pick` | kind, platform | 3 | **sehr hoch** | ChatPanel |
| `detail_sheet_open` | category, platform | 3 | **sehr hoch** | PlaceCard |
| `filter_apply` | criteria, platform | 3 | hoch | HomeClient |
| `search_no_results` | mode, radius_km, platform | 4 | mittel | HomeClient |
| `place_not_found` | reason, platform | 3 | niedrig | HomeClient |
| `amenity_focus_enter` | layers, platform | 3 | niedrig | HomeClient |
| `parking_shown` | platform | 2 | mittel (feuert 2×) | HomeClient |
| **Auto-Pageviews** | — | 1 je View | **größter Block** | Umami-Skript |

Zwei Treiber: (1) **Pageviews** (jede Navigation inkl. 640 SEO-Routen + Bots) —
vermutlich der größte Posten. (2) **Property-Multiplikator** — `search` = 4× statt 1×.

## Strategien (nach Hebel)

### Hebel A — Pageview-Volumen senken (größter Hebel)

- **A1 — Umami-Skript nur auf der App-Shell** (`/`, `/en`), nicht auf
  `/[city]/[category]` (640 Routen) + FAQ/Impressum/etc.
  - ✅ Schneidet den vermutlich dominanten Pageview-Block; SEO via Search Console + Vercel ohnehin messbar.
  - ❌ Keine SEO-Landingpage-Analytics in Umami.
  - Effekt: **groß**, wenn SEO/Bots dominieren.
- **A2 — Auto-Pageview-Tracking aus** (`data-auto-track="false"`), nur Custom-Events.
  - ✅ Eliminiert den größten Mengenposten.
  - ❌ Verlust von Pfaden/Referrern/Verweildauer — Kern klassischer Web-Analytics.
  - Effekt: **sehr groß**, hoher Funktionsverlust.
- **A3 — Bots & Eigen-Traffic ausschließen** (`notrack`-Param wie bei Vercel, Crawler filtern).
  - ✅ Sauberere Daten, etwas weniger Volumen.
  - ❌ Umami filtert Bots teils schon; marginal.
  - Effekt: **klein–mittel**.

### Hebel B — Property-Multiplikator senken

- **B1 — `platform` in den Event-Namen kodieren** statt als Property
  (`search` / `search_ios` / `search_android`).
  - ✅ Spart 1 Zählung pro Custom-Event; Plattform-Filter bleibt (über Namen).
  - ❌ Namens-Wildwuchs; Kombi mit anderen Filtern umständlicher.
  - Effekt: **mittel**.
- **B2 — `platform`-Property nur auf Native** (Web-Mehrheit ohne Property; Abwesenheit = Web).
  - ✅ Spart die Property bei der Mehrheit; minimal-invasiv (`lib/analytics.ts`).
  - ❌ „Web" nicht explizit getaggt.
  - Effekt: **mittel**.
- **B3 — Properties eindampfen (nur Umami-Pfad)**: `result_count`, `radius_km`,
  `criteria`, `category` weglassen, auf Vercel behalten.
  - ✅ `search` von 4 → 2 Zählungen; einfache, zentrale Stelle.
  - ❌ Drill-down-Dimensionen fehlen in Umami (bleiben in Vercel).
  - Effekt: **mittel–groß** (greift bei jedem Event).

### Hebel C — Weniger/seltenere Custom-Events an Umami

- **C1 — Event-Whitelist im Dual-Emit**: nur ausgewählte Events an Umami, Rest Vercel-only.
  - ✅ Gezielt; Vercel bleibt vollständig; eine Liste in `lib/analytics.ts`.
  - ❌ Umami-Bild unvollständig; Pflegeaufwand.
  - Effekt: **groß** je nach Auswahl.
- **C2 — Hochfrequente Events entprellen/entdoppeln**: `parking_shown` (feuert 2×)
  fixen; `filter_apply` (pro Toggle) und `suggest_pick` zusammenfassen.
  - ✅ Weniger Events **und** bessere Datenqualität.
  - ❌ Implementierungsaufwand; leicht veränderte Semantik.
  - Effekt: **mittel**.

### Hebel D — Sampling

- **D1 — Session-Sampling**: nur X % der Sessions an Umami (sticky), 100 % an Vercel.
  - ✅ Linear vorhersagbar; alle Event-Typen bleiben.
  - ❌ Zahlen sind Hochrechnungen; seltene Events unzuverlässig.
  - Effekt: **frei skalierbar**.
- **D2 — Event-typ-spezifisches Sampling**: 100 % `search`, z. B. 10 % `suggest_pick`/`detail_sheet_open`.
  - ✅ Wichtige/seltene Events exakt, laute gedrosselt.
  - ❌ Pro Typ ein Skalierungsfaktor.
  - Effekt: **mittel–groß**, präzise steuerbar.

## Empfohlene Kombination

Größter Effekt bei geringstem Datenverlust, in dieser Reihenfolge:

1. **A1** — SEO-/Statik-Seiten aus Umami raushalten (dominanter Pageview-Block).
2. **B3 + B2/B1** — Properties eindampfen, `platform` schlank → ~Halbierung der Custom-Event-Kosten.
3. **C2** — `parking_shown`-Doppelfeuern fixen, `filter_apply`/`suggest_pick` entprellen.
4. **D1** — Sampling nur als Notfall-Regler, falls weiterhin nahe 100k.

Begründung der Reihenfolge: erst verlustarme strukturelle Maßnahmen (A/B/C),
Sampling (D) zuletzt, weil es die Datentreue mindert.

## Voraussetzung für die Priorisierung

**Erst die realen Vercel-Monatszahlen prüfen** (Pageviews vs. Events). Daran
entscheidet sich, ob Hebel A (Pageviews) oder B/C (Custom-Events) der relevante
ist. Ohne diese Zahlen ist die Priorisierung eine Annahme.
