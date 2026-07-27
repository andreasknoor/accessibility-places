# A.Cloud Datenqualitäts-Analyse (2026-07-26)

Automatisierter Lauf über 12 Orte (Großstadt + ländlich, DE/AT/CH). Skript: `scripts/analyze-acloud-data-quality.ts` (+ `repair-osm-in-analysis.ts` für 5 zunächst an Overpass-Timeouts gescheiterte Orte). Rohdaten: `docs/analysis/acloud-data-quality-raw.json`.

Gesamt-Google-Requests: 120 (~$4.20) — die OSM-Reparatur hat KEINE zusätzlichen Google-Requests verursacht (nur kostenlose A.Cloud/OSM-Aufrufe wiederholt).

## Pro Ort

| Ort | Land | Typ | A.Cloud-Treffer | Eingang bekannt | OSM-Match-Rate | OSM-Übereinstimmung | Google-Match-Rate | Google-Übereinstimmung | Dauerhaft geschlossen (Google) |
|---|---|---|---|---|---|---|---|---|---|
| Berlin | DE | city | 56 | 89% | 11% | 100% | 100% | 50% | 2/10 |
| München | DE | city | 49 | 100% | 8% | 100% | 100% | 67% | 0/10 |
| Wien | AT | city | 45 | 100% | 24% | 100% | 100% | 75% | 1/10 |
| Graz | AT | city | 64 | 100% | 41% | 88% | 100% | 57% | 0/10 |
| Zürich | CH | city | 62 | 100% | 23% | 86% | 100% | 50% | 1/10 |
| Genf | CH | city | 36 | 100% | 50% | 100% | 100% | 33% | 0/10 |
| Bad Berleburg | DE | rural | 48 | 96% | 52% | 92% | 100% | 83% | 2/10 |
| Prenzlau | DE | rural | 65 | 91% | 60% | 95% | 100% | 78% | 0/10 |
| Lienz | AT | rural | 56 | 100% | 46% | 88% | 100% | 100% | 0/10 |
| Zwettl | AT | rural | 55 | 98% | 33% | 100% | 100% | 88% | 0/10 |
| Appenzell | CH | rural | 37 | 100% | 49% | 100% | 90% | 71% | 0/9 |
| Scuol | CH | rural | 56 | 100% | 9% | 60% | 90% | 25% | 0/9 |

## Aggregiert: Großstadt vs. ländlich

**Großstädte** — A.Cloud-Treffer gesamt: 312, OSM-Match-Rate: 25%, OSM-Übereinstimmung unter Matches: 94%
**Ländliche Orte** — A.Cloud-Treffer gesamt: 317, OSM-Match-Rate: 41%, OSM-Übereinstimmung unter Matches: 93%

## Aggregiert: Land

**DE** — A.Cloud-Treffer gesamt: 218, davon laut Google dauerhaft geschlossen: 10%
**AT** — A.Cloud-Treffer gesamt: 220, davon laut Google dauerhaft geschlossen: 3%
**CH** — A.Cloud-Treffer gesamt: 191, davon laut Google dauerhaft geschlossen: 3%

## OSM check_date-Altersverteilung (bei gematchten Orten)

| Alter | Anzahl |
|---|---|
| none | 157 |
| <1y | 32 |
| 1-2y | 15 |
| 2-5y | 6 |
| 5y+ | 0 |

## Beispiele für Abweichungen (max. 5 pro Ort und Quelle)

### Berlin
**A.Cloud vs. Google:**
- Spandauer Straße/Marienkirche: A.Cloud=no, Google=yes (businessStatus: OPERATIONAL)
- Palm Beach: A.Cloud=limited, Google=yes (businessStatus: OPERATIONAL)
- Happy Noodles: A.Cloud=limited, Google=no (businessStatus: OPERATIONAL)

### München
**A.Cloud vs. Google:**
- Glockenspiel: A.Cloud=yes, Google=no (businessStatus: OPERATIONAL)
- Glockenspiel cafe: A.Cloud=limited, Google=no (businessStatus: OPERATIONAL)

### Wien
**A.Cloud vs. Google:**
- Haas & Haas: A.Cloud=yes, Google=no (businessStatus: OPERATIONAL)
- Stephansdom: A.Cloud=no, Google=yes (businessStatus: OPERATIONAL)

### Graz
**A.Cloud vs. OSM:**
- Landeszeughaus: A.Cloud=no, OSM=yes (kein check_date)
- Bank Austria: A.Cloud=yes, OSM=no (OSM check_date: 2026-02-07)
- Only: A.Cloud=limited, OSM=yes (kein check_date)
**A.Cloud vs. Google:**
- Bärenapotheke: A.Cloud=limited, Google=yes (businessStatus: OPERATIONAL)
- Landeszeughaus: A.Cloud=no, Google=yes (businessStatus: OPERATIONAL)
- New Yorker: A.Cloud=limited, Google=yes (businessStatus: OPERATIONAL)

### Zürich
**A.Cloud vs. OSM:**
- Palette: A.Cloud=limited, OSM=no (OSM check_date: 2025-09-03)
- ViCafe Bahnhofstrasse: A.Cloud=yes, OSM=limited (OSM check_date: 2024-08-09)
**A.Cloud vs. Google:**
- Au Gratin: A.Cloud=limited, Google=yes (businessStatus: OPERATIONAL)
- Newsbar: A.Cloud=no, Google=yes (businessStatus: OPERATIONAL)

### Genf
**A.Cloud vs. Google:**
- Arthur's: A.Cloud=limited, Google=yes (businessStatus: OPERATIONAL)
- Mandarin Oriental: A.Cloud=limited, Google=yes (businessStatus: OPERATIONAL)
- Boréal Coffee Shop: A.Cloud=no, Google=yes (businessStatus: OPERATIONAL)
- McDonald's: A.Cloud=no, Google=yes (businessStatus: OPERATIONAL)
- Grand Théâtre de Genève: A.Cloud=limited, Google=yes (businessStatus: OPERATIONAL)

### Bad Berleburg
**A.Cloud vs. OSM:**
- Alte Schule: A.Cloud=no, OSM=limited (kein check_date)
- St. Marien: A.Cloud=no, OSM=limited (kein check_date)
**A.Cloud vs. Google:**
- Eiscafé San Remo: A.Cloud=limited, Google=yes (businessStatus: OPERATIONAL)

### Prenzlau
**A.Cloud vs. OSM:**
- Woolworth: A.Cloud=no, OSM=yes (kein check_date)
- Rathaus Prenzlau: A.Cloud=no, OSM=yes (kein check_date)
**A.Cloud vs. Google:**
- Fleischer Thiel: A.Cloud=limited, Google=yes (businessStatus: OPERATIONAL)
- Deutsche Bank: A.Cloud=limited, Google=yes (businessStatus: OPERATIONAL)

### Lienz
**A.Cloud vs. OSM:**
- City-Cafe Glanzl: A.Cloud=yes, OSM=limited (kein check_date)
- Lienz: A.Cloud=limited, OSM=yes (kein check_date)
- Sankt Andrae: A.Cloud=no, OSM=yes (kein check_date)

### Zwettl
**A.Cloud vs. Google:**
- Café Süd: A.Cloud=no, Google=yes (businessStatus: OPERATIONAL)

### Appenzell
**A.Cloud vs. Google:**
- Sankt Mauritius: A.Cloud=no, Google=yes (businessStatus: OPERATIONAL)
- Romantik Hotel Säntis: A.Cloud=limited, Google=yes (businessStatus: OPERATIONAL)

### Scuol
**A.Cloud vs. OSM:**
- Jugendherberge Scuol: A.Cloud=limited, OSM=yes (kein check_date)
- Apoteca & Drogaria Engiadinaisa: A.Cloud=limited, OSM=yes (kein check_date)
**A.Cloud vs. Google:**
- Jugendherberge Scuol: A.Cloud=limited, Google=yes (businessStatus: OPERATIONAL)
- Hotel Arnica: A.Cloud=no, Google=yes (businessStatus: OPERATIONAL)
- Pastizaria Cantieni: A.Cloud=limited, Google=yes (businessStatus: OPERATIONAL)
- Post Scuol: A.Cloud=limited, Google=yes (businessStatus: OPERATIONAL)
- Hotel Belvédère: A.Cloud=limited, Google=yes (businessStatus: OPERATIONAL)

## Google-Flächen-Sweep (Variante B) — Rückwärts-Abdeckung

| Ort | Sweep-Kategorien | Google-Treffer | davon auch bei A.Cloud |
|---|---|---|---|
| Berlin | restaurant, cafe, pub | 166 | 2% |
| München | restaurant, clothes, fast_food | 130 | 1% |
| Wien | restaurant, cafe, museum | 172 | 0% |
| Graz | clothes, restaurant, cafe | 164 | 4% |
| Zürich | restaurant, fast_food, convenience | 89 | 3% |
| Genf | hotel, restaurant, theater | 153 | 1% |
| Bad Berleburg | restaurant, hotel, clothes | 92 | 5% |
| Prenzlau | supermarket, restaurant, bank | 78 | 10% |
| Lienz | restaurant, supermarket, bar | 124 | 2% |
| Zwettl | supermarket, restaurant, pub | 76 | 5% |
| Appenzell | restaurant, place_of_worship, supermarket | 110 | 4% |
| Scuol | hotel, restaurant, cafe | 79 | 3% |

## Methodische Hinweise

- A.Cloud liefert kein nutzbares Aktualitäts-Datum in den Rohdaten (bestätigt: der Adapter übergibt nie `verifiedAt`/`verifiedRecently` für diese Quelle) — Aktualität wird deshalb ausschließlich indirekt über OSM `check_date` und Google `businessStatus`/Werte-Abgleich erschlossen, nicht direkt gemessen.
- "Übereinstimmung" bezieht sich nur auf das Kriterium Eingang (am häufigsten in allen drei Quellen befüllt); Toilette/Parken wurden nicht separat ausgewertet, ließen sich aber mit denselben Rohdaten nachrechnen.
- Ein Match-Fehlschlag (kein OSM/Google-Gegenstück gefunden) bedeutet nicht zwingend "falsch" — kann auch heißen, der Ort ist nur A.Cloud bekannt.
- Variante A prüft eine Stichprobe (max. 10 je Ort), keine Vollerhebung.
- Alle 12 Orte lieferten am Ende OSM-Daten; 5 davon (Berlin, München, Wien, Bad Berleburg, Appenzell) brauchten wegen Overpass-Timeouts (HTTP 504) einen zweiten Anlauf über `repair-osm-in-analysis.ts` — keine Auswirkung auf die Google-Kosten, da dieser Reparaturlauf nur die kostenlosen A.Cloud/OSM-Aufrufe wiederholt hat.
