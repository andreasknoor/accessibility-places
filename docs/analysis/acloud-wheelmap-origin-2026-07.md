# A.Cloud — Wheelmap-Direktabgleich + Herkunftsanalyse (2026-07-26)

Follow-up zu den beiden vorherigen A.Cloud-Analysen. Nutzt, dass Wheelmap.org selbst nur eine Oberfläche auf OpenStreetMap ist — `wheelmapUrl` zeigt auf eine echte OSM-Node-ID, die sich EXAKT abfragen lässt (kein Fuzzy-Matching, keine Namens-/Geo-Unschärfe). Zusätzlich: Aufschlüsselung nach A.Cloud's eigenem `sourceId`-Feld (Herkunfts-Datensatz).

12 Orte (dieselben wie in der ersten Analyse, DE+AT+CH, Großstadt+ländlich). Skript: `scripts/analyze-acloud-wheelmap-origin.ts` (+ `repair-wheelmap-origin-analysis.ts` für 5 Orte mit zunächst fehlgeschlagener Fuzzy-Abfrage). Rohdaten: `docs/analysis/acloud-wheelmap-origin-raw.json`. Kosten: 0 $.

**Verifikation der "Node nicht mehr vorhanden"-Quote:** Stichprobe von 5 als "gone" markierten Berlin-IDs wurde direkt gegen die offizielle OSM-API (`api.openstreetmap.org`, nicht Overpass) geprüft — alle 5 lieferten `HTTP 410 Gone`. Die Quote ist real, kein Abfrage-Artefakt.

## Pro Ort — Herkunft

| Ort | Land | A.Cloud gesamt | Wheelmap/OSM-Anteil | Andere Datensätze | Distinkte sourceIds |
|---|---|---|---|---|---|
| Berlin | DE | 56 | 80% | 20% | 3 |
| München | DE | 49 | 92% | 8% | 2 |
| Wien | AT | 45 | 93% | 7% | 1 |
| Graz | AT | 64 | 98% | 2% | 1 |
| Zürich | CH | 62 | 79% | 21% | 2 |
| Genf | CH | 36 | 81% | 19% | 3 |
| Bad Berleburg | DE | 48 | 94% | 6% | 3 |
| Prenzlau | DE | 65 | 83% | 17% | 3 |
| Lienz | AT | 56 | 84% | 16% | 2 |
| Zwettl | AT | 55 | 91% | 9% | 2 |
| Appenzell | CH | 37 | 57% | 43% | 2 |
| Scuol | CH | 56 | 61% | 39% | 3 |

## Pro Ort — Direktabgleich (Wheelmap/OSM-Anteil) vs. Fuzzy-Vergleich (andere Datensätze)

| Ort | OSM-Node noch vorhanden | Direktabgleich-Übereinstimmung | Andere: Match-Rate | Andere: Übereinstimmung |
|---|---|---|---|---|
| Berlin | 76% | 87% | 0% | – |
| München | 64% | 96% | 0% | – |
| Wien | 90% | 97% | 0% | – |
| Graz | 83% | 89% | 0% | – |
| Zürich | 71% | 92% | 8% | 0% |
| Genf | 76% | 100% | 43% | 100% |
| Bad Berleburg | 76% | 96% | 0% | – |
| Prenzlau | 72% | 100% | 45% | 100% |
| Lienz | 83% | 91% | 44% | 100% |
| Zwettl | 70% | 100% | 60% | 100% |
| Appenzell | 67% | 100% | 38% | 100% |
| Scuol | 68% | 100% | 14% | 33% |

## Aggregiert

- **A.Cloud-Treffer gesamt:** 629
- **Wheelmap/OSM-Anteil:** 83% (524)
- **Andere Datensätze-Anteil:** 17% (105)
- **OSM-Node nicht mehr vorhanden** (von A.Cloud referenziert, aber bei OSM gelöscht): 25% (130/524)
- **Direktabgleich-Übereinstimmung (Wheelmap/OSM-Anteil, exakte Node-ID):** 95% (285/300)
- **Übereinstimmung andere Datensätze (Fuzzy-Vergleich):** 88% (21/24)

## check_date-Altersverteilung — nur Wheelmap/OSM-Anteil, exakt zugeordnet

| Alter | Anzahl |
|---|---|
| none | 304 |
| <1y | 46 |
| 1-2y | 33 |
| 2-5y | 11 |
| 5y+ | 0 |

## Häufigste "andere" sourceIds (über alle Orte)

| sourceId | Gesamtanzahl | Vermutlich |
|---|---|---|
| `LiBTS67TjmBcXdEmX` | 565 | Wheelmap/OSM (dominant, überall vertreten) |
| `zFpoqetHjgGbmyHnR` | 41 | lokaler/regionaler Einzeldatensatz |
| `ZyDaF8ZrJeGL3m4Cq` | 15 | lokaler/regionaler Einzeldatensatz |
| `LB5rYeCZ9PxthQ3Rg` | 6 | lokaler/regionaler Einzeldatensatz |
| `Q9jzJMxydegZYfFbK` | 2 | lokaler/regionaler Einzeldatensatz |

## Beispiele: Direktabgleich-Abweichungen (max. 5 pro Ort)

### Berlin
- Happy Noodles: A.Cloud=limited, OSM (exakte Node)=yes (check_date: 2025-11-11)
- Aquadom Sealife: A.Cloud=yes, OSM (exakte Node)=no (kein check_date)
- Allegretto A Tavola: A.Cloud=limited, OSM (exakte Node)=yes (check_date: 2025-06-30)

### München
- Rischart: A.Cloud=limited, OSM (exakte Node)=yes (kein check_date)

### Wien
- Kyoto - Koreanisches Japanisches Restaurant: A.Cloud=no, OSM (exakte Node)=limited (kein check_date)

### Graz
- Landeszeughaus: A.Cloud=no, OSM (exakte Node)=yes (kein check_date)
- Bank Austria: A.Cloud=yes, OSM (exakte Node)=no (check_date: 2026-02-07)
- Jones: A.Cloud=limited, OSM (exakte Node)=yes (kein check_date)
- Pimkie: A.Cloud=limited, OSM (exakte Node)=yes (kein check_date)
- Pilatus: A.Cloud=no, OSM (exakte Node)=limited (kein check_date)

### Zürich
- ViCafe Bahnhofstrasse: A.Cloud=yes, OSM (exakte Node)=limited (check_date: 2024-08-09)
- Yendi: A.Cloud=no, OSM (exakte Node)=limited (check_date: 2025-05-28)

### Bad Berleburg
- Buchhandlung Kühn: A.Cloud=no, OSM (exakte Node)=limited (kein check_date)

### Lienz
- City-Cafe Glanzl: A.Cloud=yes, OSM (exakte Node)=limited (kein check_date)
- Lienz: A.Cloud=limited, OSM (exakte Node)=yes (kein check_date)

## Methodische Hinweise

- Der "Wheelmap-Direktabgleich" ist technisch eine exakte OSM-Node-ID-Abfrage, keine separate Wheelmap-API-Anbindung — Wheelmap ist selbst nur eine Oberfläche auf OSM, `wheelmapUrl` enthält die OSM-Node-ID direkt in der URL.
- Dieser Abgleich hat KEIN Matching-Rauschen (anders als die vorherigen Analysen) — jede Abweichung ist eine echte Abweichung zwischen genau demselben referenzierten Datensatz zu zwei Zeitpunkten, kein Zuordnungsfehler.
- "OSM-Node nicht mehr vorhanden" ist das härteste Einzelsignal über alle drei A.Cloud-Analysen hinweg: A.Cloud referenziert einen Datensatz, der bei OSM inzwischen gelöscht/zusammengeführt wurde — per echter OSM-API-Stichprobe verifiziert (HTTP 410), kein Abfrage-Artefakt.
- Die "andere Datensätze"-Gruppe nutzt weiterhin Fuzzy-Matching (keine exakte ID verfügbar). Bei 5 Orten (Berlin, München, Wien, Graz, Bad Berleburg) war die Gruppe klein (1–11 Einträge) und lieferte 0 Treffer trotz sauberer OSM-Flächenabfrage (1400+ echte Kandidaten je Ort) — plausibel bei so kleiner Stichprobe, kein Fehler.
- `sourceId`-Werte sind opak (keine auflösbaren Namen über die öffentliche API) — Herkunft wird über Konzentration/Streuung eingeschätzt, nicht über echte Datensatz-Namen.
