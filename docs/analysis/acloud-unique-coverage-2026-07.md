# A.Cloud — Einzigartiger Deckungsbeitrag (2026-07-27)

Die entscheidende Messung für die Frage "A.Cloud ganz entfernen?": Wie viele A.Cloud-Orte würden aus den Ergebnissen KOMPLETT verschwinden, weil keine andere aktive Quelle sie kennt? Genauigkeit ist irrelevant für einen Ort, den sonst niemand listet.

Methode: pro Ort A.Cloud vs. den kombinierten Pool aus OSM + Ginto (echte Adapter, `findMatch`-Logik). Skript: `scripts/analyze-acloud-unique-coverage.ts`. Rohdaten: `docs/analysis/acloud-unique-coverage-raw.json`. Kosten: 0 $.

**HARTE EINSCHRÄNKUNG:** Reisen für Alle (RfA) ist in Produktion aktiv (Gewicht 1.0, DE-fokussiert, hohe Qualität), aber lokal ohne API-Key nicht testbar. Für **DE-Orte** ist die "einzigartig"-Zahl daher eine **OBERGRENZE** — RfA könnte einige davon in Produktion abdecken. Für **AT/CH** (RfA dünn/leer) ist die Zahl verlässlich. Google ist im DACH-Standard AUS und daher korrekt ausgeschlossen.

## Pro Ort

| Ort | Land | Typ | A.Cloud | in OSM/Ginto vorhanden | einzigartig | davon echter Alleinbeitrag (anderer Datensatz) | davon tote wheelmap-Node | davon wheelmap lebt |
|---|---|---|---|---|---|---|---|---|
| Berlin | DE | city | 56 | 11% | 89% | 11 | 11 | 28 |
| München | DE | city | 49 | 12% | 88% | 4 | 15 | 24 |
| Wien | AT | city | 45 | 24% | 76% | 3 | 4 | 27 |
| Graz | AT | city | 64 | 41% | 59% | 1 | 11 | 26 |
| Zürich | CH | city | 62 | 42% | 58% | 4 | 11 | 20 |
| Genf | CH | city | 36 | 53% | 47% | 2 | 7 | 8 |
| Bad Berleburg | DE | rural | 48 | 54% | 46% | 2 | 7 | 13 |
| Prenzlau | DE | rural | 65 | 57% | 43% | 5 | 14 | 9 |
| Lienz | AT | rural | 56 | 48% | 52% | 5 | 6 | 18 |
| Zwettl | AT | rural | 55 | 33% | 67% | 2 | 14 | 21 |
| Appenzell | CH | rural | 37 | 46% | 54% | 10 | 5 | 5 |
| Scuol | CH | rural | 56 | 27% | 73% | 9 | 9 | 23 |

## Aggregiert

- **A.Cloud gesamt:** 629
- **bereits in OSM/Ginto vorhanden (redundant):** 37% (234)
- **einzigartig (kein OSM/Ginto-Pendant):** 63% (395)
  - davon **echter Alleinbeitrag** (andere lokale Datensätze, ohne Pendant): **58** (9%) ← das würde bei Entfernung wirklich verloren gehen
  - davon tote wheelmap-Node (410, ohnehin wertlos): 114
  - davon wheelmap-Node lebt aber vom OSM-Adapter nicht geliefert (Radius/Cap-Randfall): 222
  - davon Node-Status unklar: 1

**Nach Land (echter Alleinbeitrag):** DE 22 (Obergrenze — RfA ungetestet), AT+CH 36 (verlässlich).

## Beispiele für einzigartige A.Cloud-Orte

### Berlin
- Aquadom Sealife [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- Spandauer Straße/Marienkirche [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Stefanie Bumann & Team [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- Happy Noodles [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Zendo [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- dean & david [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)

### München
- Marienplatz [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Rischart [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- Rischart [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- Café Remer [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Hugendubel [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- Beyond by Geisel [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)

### Wien
- Haas & Haas [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Haas & Haas [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Stephansdom [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Stephansdom [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- OSSIG [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Stephansdom Krypta [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)

### Graz
- Hut & Mode [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Tamaris [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Huber [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Saray [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- Nordsee [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- Jones [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)

### Zürich
- Au Gratin [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Newsbar [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Arslonga [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Burger King [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- Movie [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- abc [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag

### Genf
- Crédit Suisse [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- Crédit Suisse [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- coop city [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Grand-Théatre [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- grand theatre [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- victoria hall [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)

### Bad Berleburg
- Landhaus Elisabeth [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- SPZ [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Schloss-Schänke [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- Café-Restaurant Hof Mühlbach [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Odebornklinik [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- Rothaarklinik [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag

### Prenzlau
- Medizinisches Versorgungszentrum (MVZ) [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Fleischer Thiel [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- Deutsche Bank [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- China Imbiss [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- St. Jacobi [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- Volksbank Uckermark [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)

### Lienz
- Weltladen Lienz [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- CineX - Haupteingang [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- CineX Kino [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Lienz [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Twilight Bar [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- 9900 Lienz [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag

### Zwettl
- Gourmet-Spar [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Cinemaplexx [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Café Süd [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Zum Fliegenden Holländer [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Vögele [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Hypolzmühle [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag

### Appenzell
- Aoler [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Raiffeisen [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- Weissbad [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Klink Teufen [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- Klinik Teufen [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- altes Feuerwehrhaus [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag

### Scuol
- Volg [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- La Butia Schlerin Café creativ [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Mein Dörfl Bar-Bungalov [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Zernez [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)
- Zernez [wheelmap]: OSM-Node gelöscht (410) — kein echter Deckungsbeitrag
- Café Franco [wheelmap]: OSM-Node lebt, aber OSM-Adapter lieferte ihn nicht (Radius/Cap-Randfall)

## Interpretation

- **"redundant"** = die App würde diesen Ort auch ohne A.Cloud zeigen (via OSM/Ginto). Für diese Orte ist A.Cloud entbehrlich (und laut den Voranalysen im Schnitt veralteter).
- **"echter Alleinbeitrag"** ist die einzige Zahl, die gegen eine Entfernung spricht: Orte, die NUR A.Cloud kennt und die bei Entfernung ersatzlos aus der App verschwänden.
- Tote wheelmap-Nodes zählen NICHT als Deckungsbeitrag — der Live-OSM-Adapter lässt sie ohnehin weg; A.Cloud hält hier nur eine Leiche warm.
- RfA-Einschränkung beachten: DE-Alleinbeitrag ist eine Obergrenze; die AT/CH-Zahl ist die belastbare.

## KORREKTUR / Nachtrag (Spot-Check 2026-07-27)

Die Kategorie **"wheelmap-Node lebt aber vom OSM-Adapter nicht geliefert" (222) ist irreführend gelabelt** und darf NICHT als "einzigartige Abdeckung" gelesen werden. Ein Spot-Check (Scuol + Berlin, je 14 Einträge inspiziert) zeigt, dass dieser Bucket eine **Mischung aus Messartefakten** ist, kein echter Deckungsbeitrag:

- **Definitionslogik:** Wheelmap-abgeleitete A.Cloud-Einträge stammen per Definition aus OSM-Nodes — der zugrunde liegende Ort IST also in OSM. Ein Nicht-Match kann daher NIE echte einzigartige Abdeckung sein, sondern immer nur ein Artefakt (Matchfehler, `out 2000`-Cap in dichten Städten, Overpass-Rate-Limiting) oder eine tote Node.
- **Belegt im Spot-Check:** "Subway" (Berlin) war nachweislich IM OSM-Pool vorhanden → reiner `findMatch`-Fehler, in Wahrheit redundant. Mehrere Einträge sind gar keine Venues ("Neptunbrunnen" = Brunnen, "Zernez" / "Spandauer Straße/Marienkirche" = Ort/Haltestelle). Die echten Venues (z. B. "CafèHaus", `amenity=cafe`, `check_date=2025-06-30`) existieren in OSM und würden bei sauberer Abfrage gematcht.
- **Overpass-Rate-Limiting** hat alle OSM-abhängigen Zahlen dieser gesamten Untersuchung mit Rauschen belastet — die %-Werte haben reale Fehlerbalken, die Richtungen sind aber robust.

**Bereinigte Kern-Erkenntnis:** Der EINZIGE belastbare Kandidat für echten Alleinbeitrag ist der **"andere Datensätze"-Bucket = 58 Orte (9 %)** — nicht-wheelmap-A.Cloud-Einträge aus lokalen Erhebungen ohne OSM/Ginto-Pendant, konzentriert im ländlichen AT/CH (Appenzell 10, Scuol 9, Lienz 5, Prenzlau 5). Der große wheelmap-Bucket ist NICHT einzigartig — er ist redundant, tot oder Messrauschen.
