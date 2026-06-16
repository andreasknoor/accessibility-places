# Plan: International Search (Suche außerhalb DACH)

Status: **Umgesetzt (v7.0, 2026-06-16)** auf Branch `feat/international-search`.
Länder: DACH + FR, GB, NL, ES, IT, US (die Top-5 + #6 mit konkreten bboxes).
Allowlist + alle Geo-Helper zentral in `lib/config.ts` (`SUPPORTED_COUNTRY_CODES`,
`INTL_COUNTRIES`, `regionForCoordinates`, `endpointsForCoordinates`,
`countryCodesParam`). Weitere Länder (LU/BE/DK/SE/NO/PL) = je ein `INTL_COUNTRIES`-
Eintrag + ein Test. Ursprünglicher Entwurf folgt. Stand 2026-06-15 (App v6.8).
Ersetzt die früheren Einzelentwürfe `global-search.md` und das Memory-Konzept
`project_international_mode`.

## Ziel
Nutzer können auch außerhalb des DACH-Raums Orte finden — über einen bewussten
opt-in Modus, **ohne** das DACH-Verhalten zu verändern. Reichweite per
**kuratierter Länder-Allowlist als Default**; echtes „weltweit" ist eine spätere
Ausbaustufe, kein Startzustand.

Scope: **nur die Live-Such-App.** SEO-Seiten (`lib/cities.ts`, Sitemap,
Validity), Marketing-Texte und die `health`-Route bleiben DACH.

## Verifizierter aktueller Stand (2026-06-15)
- **2 Suchmodi**, nicht 3: `chatMode: "text" | "nearby"` (`HomeClient.tsx:124`).
  Der frühere eigenständige „Ort-Suche"-Modus wurde in v4.13 entfernt; das
  vereinheitlichte Textfeld deckt Area- **und** Venue/Place-Suche in einem Input
  ab (`unified-suggest`). Legacy `defaultSearchMode: "place"` wird beim Laden auf
  `"text"` migriert (`settings.ts:60`).
- **Geo-Schranken in 3 lebenden Pfaden:**
  - `app/api/geocode/unified-suggest/route.ts` — Photon `bbox=DACH_BBOX`
    (`5.87,45.82,17.17,55.06`) + cc-Filter (aktive Autocomplete).
  - `app/api/geocode/route.ts` — Nominatim `countrycodes=de,at,ch`.
  - `app/api/search/route.ts:62` — interne `geocode()`, ebenfalls `countrycodes=de,at,ch`.
  - **Außerhalb Scope:** Legacy `geocode/suggest` + `geocode/place-suggest`
    liegen noch auf der Platte, werden aber nicht mehr vom UI aufgerufen.
    `geocode/reverse` liefert nur das District-Label (keine relevante
    Länder-Sperre).
- **OSM:** privater Hetzner-Server hat nur das DACH-Extract. `overpass-api.de`
  liefert weltweit Daten (verifiziert: Times-Square-Cafés, HTTP 200).
- **Quellen außerhalb DACH:** accessibility.cloud/Wheelmap (global) + OSM
  (Mirrors) tragen bei; Ginto (CH) + Reisen für Alle (DACH) sind dort tot (leer,
  harmlos). Google Places wäre global dicht, ist aber default aus (Kosten,
  Gewicht 0.35). → effektiv 2–3 Quellen.
- **Nearby-Modus** umgeht Geocoding (übergibt Koordinaten direkt) → schon heute
  global lauffähig, aber außerhalb DACH faktisch nur accessibility.cloud-Treffer,
  weil OSM das Race verliert (s. u.).

## Architektur-Entscheidung
1. **User-Setting `internationalMode` (default `false`)** in `AppSettings` —
   bewusster Opt-in, Notbremse, ein zentraler Schalter für beide Suchmodi.
2. **Kuratierte Länder-Allowlist** in `lib/config.ts` zentralisiert (heute ist die
   DACH-Box 4–5× dupliziert): DACH + NL, LU, FR, BE, GB, DK, SE, NO. Erweiterbar.
3. **Zentrale `regionForCoordinates(lat, lon)`** als einzige Wahrheit über die
   Region-Zugehörigkeit. Ersetzt die verstreuten Geo-Checks.
4. Zweistufige Logik:
   - Setting `false` → alles wie heute, DACH-Pfad erzwungen.
   - Setting `true` → pro Suche entscheidet `regionForCoordinates`:
     - **in DACH:** privater Overpass + alle Quellen (unverändert, bleibt optimal).
     - **in Allowlist, außerhalb DACH:** public Mirrors only + accessibility.cloud
       (+ optional Google), DACH-only-Quellen (Ginto, RfA) übersprungen.
     - **außerhalb Allowlist:** wie heute behandeln (keine Treffer-Erwartung).

**Invariante:** DACH-Suchen nutzen IMMER den privaten Server + schnelle
DACH-Quellen — unabhängig vom Toggle. Der Schalter erlaubt nur *zusätzlich* den
internationalen Zweig; er degradiert nie den DACH-Zweig.

## Betroffene Stellen

### 1. OSM-Adapter (`lib/adapters/osm.ts`) — der eigentliche Hebel
- Helper `endpointsForCoordinates(lat, lon, intl)` einführen.
  - außerhalb DACH + intl: privaten Server NICHT als Race-Gewinner zulassen
    (entfernen oder als billigen Verlierer drinlassen). Mirror `overpass-api.de`
    zuerst.
- **An BEIDEN Race-Stellen anwenden:** Venue-Fetch UND Parkplatz-Fetch.
  Gemeinsamer Helper, nicht duplizieren. (🔴 wichtigstes Risiko)
- `country: tags["addr:country"] ?? "DE"` → Fallback `undefined` statt `"DE"`,
  sonst werden Auslandstreffer als DE gelabelt.

### 2. Autocomplete (`app/api/geocode/unified-suggest/route.ts`)
- `bbox=DACH_BBOX`: im intl-Fall durch die Allowlist-Reichweite ersetzen bzw.
  weglassen; `lat/lon` nur als Bias behalten.
- cc-Filter: im intl-Fall gegen die Allowlist prüfen statt nur DACH.
- Mechanik: Query-Param `?intl=1`, den die UI nur bei aktivem Setting setzt.

### 3. Forward-Geocoding (zwei Stellen)
- `app/api/geocode/route.ts` — `countrycodes` dynamisch (Allowlist statt DACH).
- `app/api/search/route.ts:62` interne `geocode()` — gleicher dynamischer
  `countrycodes`-Aufbau, intl-Flag aus dem Request-Body.

### 4. Quellen-Auswahl (`app/api/search/route.ts` + `lib/seo-search.ts`)
- Außerhalb DACH (intl): Ginto + Reisen für Alle überspringen (DACH-only, spart
  Latenz + schont Rate-Limits). Optional Google Places vorschlagen/erzwingen.
- `regionForCoordinates` bestimmt den Quellen-Satz.

### 5. Settings-UI
- `lib/settings.ts`: Feld `internationalMode: boolean` (default `false`),
  Default in `loadSettings()`.
- `components/settings/SettingsSheet.tsx`: Toggle + i18n (DE+EN, beide
  Locale-Dateien, nie hardcoden) mit Erwartungs-Management-Text.
- `HomeClient.tsx`: Setting durchreichen; `?intl=1` an Geocode-GETs anhängen,
  intl-Flag in den `/api/search`-Body, wenn an.

### 6. UX-Hinweis
- Bei aktivem Modus UND Mittelpunkt außerhalb DACH: dezenter Banner
  „Datenqualität variiert / außerhalb DACH eingeschränkt".
- Häufigere Empty-States außerhalb DACH → ggf. Google Places vorschlagen.
- UI bleibt DE/EN (kein Mehr-Sprachen-Ausbau).

## Bewertung
- **Datenlage ⭐⭐⭐ (mittel, länderabhängig):** effektiv 2–3 Quellen außerhalb
  DACH; gut in west-/nordeurop. Großstädten (= die Allowlist), dünn im ländlichen
  Raum. Die kuratierte Liste ist deshalb der richtige Default.
- **Aufwand ⭐⭐ (gering–mittel, ~1–1,5 Tage):** Adapter sind rein
  koordinatenbasiert → keine Adapter-Logik nötig. Hauptarbeit = Param-Threading
  client→server durch die 3 Geo-Pfade + OSM-Endpoint-Wahl + Konstanten
  zentralisieren.

## Technische Risiken
- 🔴 **HOCH:** Privatserver gewinnt `Promise.any`-Race mit gültiger leerer
  `elements:[]`-Antwort (~50–200 ms) → 0 OSM-Treffer außerhalb DACH.
  Region-aware Endpoint-Filter ist **Pflicht**. Doppelstelle (Venue + Parking) →
  zentraler Helper.
- 🟠 mittel: public Mirror Rate-Limits/Latenz (429, 2–15 s) wieder exponiert
  (heute durch Privatserver kaschiert; `overpass-api.de` einzig verlässlich,
  kumi.systems im Test nicht erreichbar). `[timeout:12]` + 20 s Abort bestehen.
- 🟡 niedrig: Photon ohne enge bbox = mehr Rauschen; Nominatim-Policy bei Last;
  Adress-Matching auf DACH kalibriert (Geo-Match trägt sprachneutral);
  Box-Grenzregionen (Bodensee) → Allowlist-Boxen großzügig.
- 🟢 keine: CSP-Domains (Photon/Nominatim/Mirrors) bereits vorhanden.

## Tests
- Unit: `regionForCoordinates` (DACH / Allowlist / außerhalb).
- Unit: `endpointsForCoordinates` (privater Server raus außerhalb DACH).
- API: `unified-suggest` + `geocode` + interne `geocode()` mit/ohne `?intl=1`.
- Regression: Default-Pfad (kein `intl`) bit-identisch zu heute.

## Reihenfolge
1. `internationalMode`-Setting + Toggle (inert) + `?intl=1`-Verdrahtung + Allowlist-Konstanten zentralisieren.
2. `regionForCoordinates` + OSM-Endpoint-Helper (der eigentliche Hebel).
3. Geocoding-Schranken (Autocomplete + beide Forward-Geocodes) hinter `intl`.
4. Quellen-Auswahl + Banner.

## Länder-Empfehlung (Datenanalyse 2026-06-15)
Methodik: `nwr["wheelchair"]`-Count im **15-km-Radius um die Hauptstadt** (gleiche
Fläche je Land → fair vergleichbares Dichtemaß; Ländertotale skalieren mit der
Fläche und sind irreführend). OSM ist außerhalb DACH die dominante Quelle;
Wheelmap/accessibility.cloud-Edits fließen großteils nach OSM → guter Proxy für
die kombinierte Datenlage. Misst Daten-*Präsenz*, nicht den Anteil zugänglicher
Orte. Quelle: overpass-api.de / overpass.openstreetmap.fr.

Gemessene Dichte (Hauptstadt, 15 km):
DE(Berlin) 52.178 [Referenz] · FR(Paris) 58.437 · PL(Warschau) 22.815 ·
ES(Madrid) 21.676 · GB(London) 19.345 · FI(Helsinki) 14.731 · NL(Amsterdam) 10.347 ·
IE(Dublin) 9.824 · CZ(Prag) 8.889 · DK(Kopenhagen) 7.116 · BE(Brüssel) 6.693 ·
SE(Stockholm) 6.290 · IT(Rom) 4.989 · US(Washington DC) 4.721 [NYC 29.001] ·
NO(Oslo) 3.723 · LU(Luxemburg) 2.175. (PT/Lissabon: Count timeoutete, ausgelassen.)

Bewertung kombiniert (1) Datendichte, (2) strategischer Wert (DACH-Grenznähe +
Tourismusströme + DE/EN-UI), (3) dedizierte Quelle möglich.

### Top-5 Empfehlung
| # | Land | bbox (minLon,minLat,maxLon,maxLat) | Begründung |
|---|---|---|---|
| 1 | 🇫🇷 FR | `-5.14,41.33,9.56,51.09` | Dichteste Datenlage, grenzt an DACH, AccèsLibre-Adapter geplant (dedizierte Quelle), riesige Tourismusüberlappung |
| 2 | 🇬🇧 GB | `-8.65,49.84,1.77,60.86` | Hohe Dichte, EN-UI nativer Fit, Top-Reiseziel (UK-Box inkl. NI) |
| 3 | 🇳🇱 NL | `3.36,50.75,7.23,53.56` | Grenzt an DE, flächige Abdeckung (Total 60k), starkes DACH-Reiseaufkommen |
| 4 | 🇪🇸 ES | `-18.16,27.64,4.33,43.79` | Sehr hohe Dichte, #1-Urlaubsziel DACH; Box inkl. Balearen+Kanaren (gewollt, zieht weit nach SW) |
| 5 | 🇮🇹 IT | `6.63,35.49,18.52,47.09` | Grenzt an AT, massiver DACH-Tourismus. ⚠️ niedrige Hauptstadt-Dichte (~5k) → außerhalb Touristenzielen dünn; primär strategisch |

**#6 🇺🇸 US** (`-124.85,24.40,-66.88,49.38`, contiguous; AK/HI ausgeklammert um Box
klein zu halten): Hauptstadt-Dichte (DC 4.721) ~gleichauf mit IT, NYC stark
(29.001) aber Metro-lastig; kein DACH-Anschluss, keine dedizierte Quelle, Long-
haul-Tourismus. Knapp hinter IT — Aufnahme sinnvoll, aber nachrangig; in der
Fläche dünn, Stärke nur in Großmetropolen.

**Datengetriebene Alternative zu #5:** rein nach Dichte gehörte 🇵🇱 PL
(Warschau 22.815, grenzt an DE) auf Platz 5; IT wurde wegen ungleich größerer
DACH-Reisenachfrage vorgezogen. Bei strikt datengetriebener Priorisierung IT↔PL
tauschen. FI datenseitig stark, strategisch schwächer (Distanz).

**Schwächste Kandidaten:** LU (2.175) und NO (3.723) dünn; LU dennoch billig
mitzunehmen (winzig, grenznah). BE/SE/NO/LU (bisher in `project_country_expansion`
gelistet) sind datenseitig schwächer als die hier neu auffälligen ES/PL.

### bbox-Hinweise
- FR/ES/NL/US: Überseegebiete bewusst ausgeklammert bzw. nur das Reiseziel
  (ES-Kanaren) inkludiert — sonst werden Boxen unbrauchbar groß.
- Keine Box ragt in die DACH-Box → kein „privater-Server-gewinnt-leeres-Race"-
  Kanteneffekt.

## Land später hinzufügen (Wartung nach Umsetzung)
Damit ein neues Land **ein Eintrag + ein Test** bleibt, muss die Allowlist als
**deklarative Liste pro Land** angelegt werden (Code UND Box zusammen, nicht zwei
synchron zu haltende Listen):

```ts
// lib/config.ts (Zielstruktur)
const SUPPORTED_COUNTRIES = [
  { code: "DE", bbox: [...] },
  { code: "NL", bbox: [...] },
  // ...
] as const
```

Aus dieser Liste leiten **alle** Geo-Pfade ab: `regionForCoordinates()`
(DACH vs. intl), der Nominatim-`countrycodes`-Aufbau (beide Forward-Geocodes),
der Photon-cc-Filter/Bias in `unified-suggest` und die OSM-Endpoint-Wahl.

**Schritte für ein neues Land:**
1. Einen `{ code, bbox }`-Eintrag in `SUPPORTED_COUNTRIES` ergänzen (ISO-2-Code +
   großzügige Bounding-Box, die **nicht** in die DACH-Box hineinragt — sonst
   kommt an der Kante der „privater Server gewinnt leeres Race"-Effekt zurück).
2. Im `regionForCoordinates`-Unit-Test einen Punkt im neuen Land als
   „intl, in Allowlist" abdecken.

**Vorher prüfen (Datenrealität, kein Code):** Hat das Land in OSM (Mirrors) +
accessibility.cloud/Wheelmap brauchbare Dichte? Ginto/RfA bleiben leer (harmlos).
Sonst fügt man ein Land hinzu, das nur leere Treffer liefert — genau das soll die
kuratierte Liste verhindern.

**Nicht anfassen:** SEO (`lib/cities.ts`, Sitemap, Validity), Marketing-/i18n-
Texte (Modus ist generisch formuliert), CSP (Domains bereits vorhanden).

## Offene produktseitige Fragen
- Google Places im intl-Modus prominenter vorschlagen (einzige dichte Weltquelle,
  aber Kosten)?
- Erste Länderliste final fixieren?
- Marketing-Texte später als separates Ticket nachziehen?
- Echtes „weltweit" jenseits der Allowlist als spätere Stufe?

## Bezug
- Memory: `[[project_country_expansion]]`, `[[project_source_expansion]]`.
