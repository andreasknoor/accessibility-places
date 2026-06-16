# Plan: AccèsLibre-Adapter (FR)

Status: **Entwurf — nicht umgesetzt.** Stand 2026-06-16.
AccèsLibre = staatliche französische Barrierefreiheits-DB (acceslibre.beta.gouv.fr),
offene REST-API. Erstes „Ginto-Äquivalent" außerhalb DACH (für FR im intl-Modus).

## API-Eckdaten (verifiziert gegen OpenAPI-Schema `/api/openapi`)
- Endpoint: `GET https://acceslibre.beta.gouv.fr/api/erps/`
- Auth: Header `Authorization: Api-Key <KEY>` (kostenloser Key via Kontaktformular).
  **Pflicht** — ohne Key 403 (`Informations d'authentification non fournies`).
- **`around` = `latitude,longitude`** (bestätigt: `?around=45.76,4.83`).
- **Es gibt KEIN `distance`-Parameter.** Radius-Kontrolle läuft über
  **`zone`** = Bounding-Box `min_longitude,min_latitude,max_longitude,max_latitude`
  (z. B. `?zone=4.849,44.885,4.982,44.963`). → Adapter rechnet Center+radiusKm
  in eine bbox um und nutzt `zone`. `around` (proximity-Ordering) optional zusätzlich.
- Pagination: `page` / `page_size`.
- Nützliche Zusatz-Parameter: `equipments` (z. B. `having_adapted_parking`,
  `having_public_transportation`), `clean=true` (droppt null-Werte),
  `readable=true` (menschenlesbare Acc-Werte), `activite` (slug),
  `created_or_updated_in_last_days`.
- Identität: `uuid`, `slug`, `nom`, `numero`, `voie`, `code_postal`, `commune`,
  `coordonnees`/`geom` (**GeoJSON [lon, lat] → muss getauscht werden**), `activite`,
  `site_internet`, `telephone`.
- Accessibility: `accessibilite`-Objekt mit **91 Feldern** — relevant: `entree_*`,
  `sanitaires_*`, `stationnement_*`, `cheminement_ext_*`, `accueil_*`. Booleans sind
  Tri-State `[true, false, null]`.

## Field-Mapping → App-Datenmodell (`lib/types.ts`)

### Entrance → `accessibility.entrance` (A11yValue + EntranceDetails)
| AccèsLibre | Typ | → unser Feld | Mapping-Regel |
|---|---|---|---|
| `entree_plain_pied` | bool | value / `EntranceDetails.isLevel` | `true` → **yes** |
| `entree_marches` | int | `EntranceDetails.stepCount` | >0 + Rampe/Aufzug → **limited**; >0 ohne → **no** |
| `entree_marches_rampe` | enum (aucune/fixe/amovible) | `EntranceDetails.hasRamp` | ≠ aucune → hasRamp=true → hebt auf **limited** |
| `entree_ascenseur` | bool | `EntranceDetails.hasHoist` | true bei Stufen → **limited** |
| `entree_largeur_mini` | int (cm) | `EntranceDetails.doorWidthCm` | ⚠️ ist *Durchgangsbreite*, nicht reine Türbreite — Näherung |
| `entree_porte_type` | enum (manuelle/automatique) | `EntranceDetails.hasAutomaticDoor` | „automatique" → true (⚠️ NICHT `entree_porte_manoeuvre` = Türform) |
| `entree_pmr` | bool | (value-Signal) | dedizierter PMR-Eingang → stützt **yes/limited** |
| `cheminement_ext_plain_pied` | bool | (value-Signal) | Außenweg mit Stufen kann **yes**→**limited** drücken |
| `commentaire` | text | `EntranceDetails.description` | direkt |

Ableitung value (Priorität): `plain_pied=true` → **yes** · sonst `marches>0` mit
(rampe≠aucune \|\| ascenseur) → **limited** · `marches>0` ohne → **no** · alles null → **unknown**.

### Toilet → `accessibility.toilet` (A11yValue + ToiletDetails)
| AccèsLibre | Typ | → unser Feld | Regel |
|---|---|---|---|
| `sanitaires_adaptes` | bool/int | value / `ToiletDetails.isDesignated` | true → **yes** |
| `sanitaires_presence` | bool | (Kontext) | presence=true & adaptes=false → **no** |

value: `adaptes` truthy → **yes** · `presence=true & !adaptes` → **no** · sonst **unknown**.

### Parking → `accessibility.parking` (A11yValue + ParkingDetails)
| AccèsLibre | Typ | → unser Feld | Regel |
|---|---|---|---|
| `stationnement_pmr` | bool | value / `ParkingDetails.hasWheelchairSpaces` | true → **yes** (on-site) |
| `stationnement_presence` | bool | (Kontext) | presence=true & pmr=false → **no** |
| `stationnement_ext_pmr` | bool | value | nur ext_pmr=true → **limited** (entschieden) |

### Identität → `Place`
| AccèsLibre | → Place |
|---|---|
| `uuid` | `id` = `acceslibre:<uuid>` |
| `nom` | `name` |
| `numero`/`voie`/`code_postal`/`commune` | `address.*`, `country: "FR"` (fix) |
| `coordonnees` [lon,lat] | `coordinates {lat, lon}` — **Reihenfolge tauschen** |
| `activite` | `category` via `FROM_ACCESLIBRE`-Map (s.u.) |
| `site_internet` / `telephone` | `website` / `phone` |
| `slug` | neues `Place.acceslibreUrl` = `…/erp/<slug>/` (analog `gintoUrl`) |

## Was gut zusammenpasst ✅
- **Entrance ist der Glücksfall:** AccèsLibre liefert Stufenzahl, Rampentyp,
  Aufzug, Durchgangsbreite, Plain-pied — **füllt `EntranceDetails` reicher als
  jede andere Quelle** (OSM hat meist nur binäres `wheelchair=*`). Direkter Fit.
- **On-site PMR-Parking** → `parking.value` + `hasWheelchairSpaces` sauber.
- **Proximity-Suche** (`around`+`distance`) passt 1:1 auf das Adapter-Pattern
  (wie Ginto `lat/lng/within`).
- **Identität** (Name/Adresse/Coords/Web/Tel) sauber strukturiert.

## Lücken, Probleme, Kompromisse ⚠️
1. **Toilet-Details bleiben arm:** AccèsLibre hat nur `sanitaires_adaptes` (bool).
   Unsere reiche `ToiletDetails` (Haltegriffe, Wendekreis, Türbreite) bleibt leer
   — besser als OSM-Binär, aber kein Vergleich zu RfA/Ginto-Detailtiefe.
2. **„limited" ist unterrepräsentiert:** AccèsLibre ist überwiegend binär
   (plain_pied ja/nein, adapté ja/nein). FR-Daten skewen yes/no; unser
   Mittel-Tier entsteht fast nur aus „Stufen + Rampe". Bewusst akzeptieren.
3. **Kein Verifikationsdatum:** Kein zuverlässiges check_date-Äquivalent
   (`updated` = Editier-, nicht Prüfdatum). → `verifiedRecently` bleibt `false`
   (gleiche Entscheidung wie Ginto). Kompromiss.
4. **PMR-Semantik:** „PMR" = *personne à mobilité réduite* (breiter als nur
   Rollstuhl). Mappt sauber auf yes/no, konflatiert aber Mobilität allgemein mit
   Rollstuhl-Zugänglichkeit. Akzeptabler Bedeutungs-Drift.
5. **`entree_largeur_mini`** ist Durchgangs-, nicht Türbreite → `doorWidthCm` ist
   eine Näherung. In Metadata den Originalwert mitführen.
6. **`stationnement_ext_pmr` (Parkplatz in der Nähe):** **Entschieden →** auf
   **limited** mappen (nicht `nearbyOnly`, das bleibt OSM-Enrichment vorbehalten).
   ext-Detail in Metadata mitführen.
7. **Kategorie-Taxonomie-Explosion:** `activite` hat ~300 französische Werte →
   unsere 28 Kategorien. Eine `FROM_ACCESLIBRE`-Map deckt die abgedeckten ab
   (Restaurant, Café, Hôtel, Musée, Pharmacie, Boulangerie …); nicht abbildbare
   (Mairie, École, Bureau de vote) fallen auf einen Default oder werden gar nicht
   getroffen (Suche ist kategoriegetrieben → unkritisch). **Hauptaufwand des Mappings.**
8. **Koordinaten-Reihenfolge** [lon,lat] (GeoJSON) — klassischer Bug, swap nicht vergessen.
9. **Reliability-Gewicht:** AccèsLibre ist contributor-sourced (ERP-Betreiber,
   Verbände, Behörden) mit definiertem Schema, staatlich kuratiert. **Entschieden →
   `acceslibre: 0.90`** (gleichauf mit `ginto`). Kein per-Eintrag-Qualitätssignal
   in der API → ein fester Wert.

## Betroffene Stellen (Lockstep, analog Ginto)
- `lib/types.ts`: `SourceId += "acceslibre"`; `ActiveSources += acceslibre`;
  `Place.acceslibreUrl?`.
- `lib/config.ts`: `RELIABILITY_WEIGHTS.acceslibre = 0.90`.
- `lib/adapters/acceslibre.ts`: **neu** (REST statt GraphQL; Pattern wie ginto.ts).
- `lib/adapters/index.ts`: `startAdapterTasks` → `if (sources.acceslibre) …`.
- `app/api/search/route.ts`: in `sources`-Aufbau aufnehmen; **nur aktiv wenn
  `international && regionForCoordinates(...) === "intl"` und Punkt in FR-bbox**
  (Geo-Fence wie Ginto/CH, FR-bbox steht schon in `INTL_COUNTRIES`). Stats-Tracking.
- `app/HomeClient.tsx`: `DEFAULT_SOURCES.acceslibre` (default true im intl-Kontext).
- `components/filters/FilterPanel.tsx`: `SOURCE_ORDER` + Toggle.
- `lib/i18n/de.ts` + `en.ts`: Quellen-Label + Attribution (DE+EN).
- `PlaceDebugSheet`: `acceslibreUrl`-Link (Icon wie `gintoUrl`).
- `.env` / CLAUDE.md: `ACCESLIBRE_API_KEY` (silently skip wenn absent).
- `next.config.ts` CSP: `acceslibre.beta.gouv.fr` zu `connect-src`.
- `__tests__/lib/`: Adapter-Unit-Test mit Fixture (Mapping-Regeln, coord-swap).

## Reihenfolge
1. Key besorgen, eine echte Antwort als Test-Fixture speichern (API-Semantik ist
   bereits gegen `/api/openapi` verifiziert: `around=lat,lon`, Radius via `zone`-bbox).
2. `FROM_ACCESLIBRE`-Kategorie-Map + `extractValues`-Äquivalent (entrance/toilet/parking).
3. Adapter + Unit-Test (coord-swap, value-Ableitung, Kategorie-Fallback).
4. Verdrahtung (types/config/index/route/UI/i18n/CSP), Geo-Fence auf FR.
5. Reliability-Gewicht final entscheiden; Doku + CLAUDE.md-Adapterabschnitt.

## Bezug
- `[[project-international-search-plan]]`, `[[project_source_expansion]]`.
- Pattern-Vorlage: `lib/adapters/ginto.ts`.
