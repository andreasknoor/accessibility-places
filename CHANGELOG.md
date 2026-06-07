# Changelog

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
