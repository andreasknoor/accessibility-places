# A.Cloud vs. Ginto-AUDITED Datenqualitäts-Analyse — Schweiz (2026-07-26)

Follow-up zu `docs/analysis/acloud-data-quality-2026-07.md` — nutzt Ginto-Einträge mit `qualityInfo.approvalLevels: AUDITED` (extern geprüft, höchste Vertrauensstufe im Projekt) als Ground Truth statt der mehrdeutigen Google-Werteabweichungen der letzten Runde. 11 Orte in der Schweiz (7 Großstädte + 4 ländliche Orte). Skript: `scripts/analyze-acloud-vs-ginto-ch.ts`. Rohdaten: `docs/analysis/acloud-vs-ginto-ch-raw.json`. Kosten: 0 $ (A.Cloud, Ginto, OSM sind alle kostenlos).

**Wichtige Einschränkung:** `RELIABILITY_WEIGHTS.accessibility_cloud` ist nicht länderspezifisch — dieser CH-only-Befund lässt sich nur mit der Annahme "A.Cloud's CH-Datenqualität ist repräsentativ für seine Datenqualität insgesamt" auf die globale Gewichtung übertragen, nicht direkt beweisen für DE/AT.

## Pro Ort

| Ort | Typ | A.Cloud | Ginto AUDITED | Ginto SELF_DECL. | AUDITED-Match-Rate | AUDITED-Übereinstimmung | SELF_DECL.-Übereinstimmung | OSM-Übereinstimmung |
|---|---|---|---|---|---|---|---|---|
| Zürich | city | 62 | 13 | 30 | 2% | 0% | – | 87% |
| Basel | city | 60 | 58 | 10 | 13% | 50% | – | 72% |
| Bern | city | 58 | 9 | 19 | 0% | – | 0% | 75% |
| Genf | city | 36 | 85 | 7 | 8% | 33% | 100% | 100% |
| Lausanne | city | 58 | 87 | 3 | 34% | 40% | – | 93% |
| Luzern | city | 59 | 19 | 37 | 2% | 0% | 50% | 90% |
| Winterthur | city | 73 | 6 | 11 | 0% | – | – | 85% |
| Appenzell | rural | 37 | 53 | 20 | 5% | 50% | 0% | 100% |
| Scuol | rural | 56 | 14 | 1 | 18% | 20% | – | 60% |
| Poschiavo | rural | 62 | 0 | 15 | 0% | – | – | 100% |
| Sarnen | rural | 43 | 13 | 16 | 0% | – | – | 100% |

## Aggregiert

- **A.Cloud-Treffer gesamt:** 604
- **Match-Rate mit Ginto AUDITED:** 7%
- **Übereinstimmung mit AUDITED (Ground Truth):** 36% (16/45)
- **Übereinstimmung mit SELF_DECLARED (nur zum Vergleich, keine Ground Truth):** 29% (2/7)

## Triangulation (A.Cloud + Ginto-AUDITED + OSM gleichzeitig vorhanden)

Fälle mit allen drei Quellen: 12

| Ergebnis | Anzahl | Anteil |
|---|---|---|
| Alle drei stimmen überein | 4 | 33% |
| A.Cloud ist Ausreißer (Ginto+OSM einig) | 1 | 8% |
| OSM ist Ausreißer (A.Cloud+Ginto einig) | 0 | 0% |
| Ginto ist Ausreißer (A.Cloud+OSM einig) | 7 | 58% |
| Alle drei unterschiedlich | 0 | 0% |

## OSM check_date-Altersverteilung (bei gematchten Orten)

| Alter | Anzahl |
|---|---|
| none | 141 |
| <1y | 49 |
| 1-2y | 19 |
| 2-5y | 17 |
| 5y+ | 0 |

## Beispiele: A.Cloud vs. Ginto-AUDITED-Abweichungen (max. 5 pro Ort)

### Zürich
- Central Plaza: A.Cloud=yes, Ginto(AUDITED)=limited (Ginto updatedAt: 2025-09-09T06:18:13+02:00 — System-Republish, kein Prüfdatum)

### Basel
- Basler Münster: A.Cloud=limited, Ginto(AUDITED)=yes (Ginto updatedAt: 2025-09-08T22:04:29+02:00 — System-Republish, kein Prüfdatum)
- Rathaus: A.Cloud=yes, Ginto(AUDITED)=limited (Ginto updatedAt: 2025-09-09T16:44:31+02:00 — System-Republish, kein Prüfdatum)
- Motel One Basel: A.Cloud=limited, Ginto(AUDITED)=yes (Ginto updatedAt: 2025-09-09T16:11:19+02:00 — System-Republish, kein Prüfdatum)
- Historisches Museum Basel – Barfüsserkirche: A.Cloud=limited, Ginto(AUDITED)=yes (Ginto updatedAt: 2025-09-10T14:18:22+02:00 — System-Republish, kein Prüfdatum)

### Genf
- Grand Théâtre de Genève: A.Cloud=limited, Ginto(AUDITED)=yes (Ginto updatedAt: 2025-09-09T09:34:24+02:00 — System-Republish, kein Prüfdatum)
- ibis Styles Genève Mont Blanc: A.Cloud=limited, Ginto(AUDITED)=yes (Ginto updatedAt: 2025-09-09T08:47:28+02:00 — System-Republish, kein Prüfdatum)

### Lausanne
- La Table d'Edgard, Lausanne Palace: A.Cloud=limited, Ginto(AUDITED)=yes (Ginto updatedAt: 2025-09-09T08:21:44+02:00 — System-Republish, kein Prüfdatum)
- Loxton: A.Cloud=no, Ginto(AUDITED)=limited (Ginto updatedAt: 2025-09-09T01:52:49+02:00 — System-Republish, kein Prüfdatum)
- Pz pizza: A.Cloud=no, Ginto(AUDITED)=limited (Ginto updatedAt: 2026-01-28T09:19:13+01:00 — System-Republish, kein Prüfdatum)
- Alpha-Palmiers by Fassbind: A.Cloud=limited, Ginto(AUDITED)=yes (Ginto updatedAt: 2025-09-09T10:31:51+02:00 — System-Republish, kein Prüfdatum)
- Café du Grütli: A.Cloud=no, Ginto(AUDITED)=limited (Ginto updatedAt: 2025-09-10T12:27:54+02:00 — System-Republish, kein Prüfdatum)

### Luzern
- Waldstätterhof Swiss Quality Hotel: A.Cloud=limited, Ginto(AUDITED)=yes (Ginto updatedAt: 2025-09-09T13:06:00+02:00 — System-Republish, kein Prüfdatum)

### Appenzell
- Romantik Hotel Säntis: A.Cloud=limited, Ginto(AUDITED)=yes (Ginto updatedAt: 2025-09-09T15:42:39+02:00 — System-Republish, kein Prüfdatum)

### Scuol
- Restaurant Trü: A.Cloud=limited, Ginto(AUDITED)=yes (Ginto updatedAt: 2025-09-09T12:50:40+02:00 — System-Republish, kein Prüfdatum)
- Hotel Arnica: A.Cloud=no, Ginto(AUDITED)=limited (Ginto updatedAt: 2025-09-10T11:58:49+02:00 — System-Republish, kein Prüfdatum)
- Pastizaria Cantieni: A.Cloud=limited, Ginto(AUDITED)=yes (Ginto updatedAt: 2025-09-09T06:30:28+02:00 — System-Republish, kein Prüfdatum)
- Chasa Miramunt 2: A.Cloud=no, Ginto(AUDITED)=limited (Ginto updatedAt: 2025-09-26T08:36:18+02:00 — System-Republish, kein Prüfdatum)
- Hotel Belvédère: A.Cloud=limited, Ginto(AUDITED)=yes (Ginto updatedAt: 2025-09-09T12:25:40+02:00 — System-Republish, kein Prüfdatum)

## Methodische Hinweise

- Ginto AUDITED = extern geprüft (`qualityInfo.approvalLevels`), die einzige hier verwendete echte Ground-Truth-Stufe. SELF_DECLARED wird separat ausgewiesen, aber nie als Beweis gegen A.Cloud gewertet — epistemisch gleichrangig mit A.Cloud selbst.
- `updatedAt` bei Ginto ist ein System-Republish-Zeitstempel, kein menschliches Prüfdatum (siehe Kommentar in `lib/adapters/ginto.ts`) — nur als Kontext angegeben, nicht als Aktualitätsbeweis.
- Übereinstimmung bezieht sich nur auf das Kriterium Eingang, wie in der Vorgänger-Analyse.
- Ein Match-Fehlschlag bedeutet nicht zwingend "falsch" — kann auch heißen, der Ort ist nur einer Quelle bekannt.
- Die Triangulationstabelle hat naturgemäß eine kleinere Stichprobe (alle drei Quellen müssen gleichzeitig vorliegen) — Einzelwerte vorsichtig interpretieren.
