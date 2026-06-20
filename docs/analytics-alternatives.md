# Analytics-Alternativen (hosted) — Kandidatenvergleich

**Stand:** 2026-06-20. Recherche im Web (Preise können sich ändern — vor einer
Entscheidung am Anbieter verifizieren).

## Anforderungen (harte Kriterien)

1. **Kein Self-Hosting** — gehosteter Cloud-Dienst (Hetzner-Server bleibt frei für
   Overpass/GlitchTip).
2. **Filter nach Zugriffs-Plattform** (`web` / native `ios` / native `android`).
   Technisch = eine Custom-Property `platform` an Events/Pageviews + Filterung
   danach. Wird bereits in `lib/analytics.ts` gesetzt (`Capacitor.getPlatform()`).
3. **Custom Events** + **Filterung** danach (und nach deren Properties).

→ Entscheidend ist **Custom-Event-Properties mit Filterung**. Tools, die zwar
Events, aber kein Filtern nach Property/Dimension können, erfüllen #2 nicht.

## Vergleich

| Tool | Preis (Einstieg, niedriges Volumen) | Custom Events | Property-Filter (→ Plattform-Filter) | Schwerpunkt / Besonderheit | Eignung |
|---|---|---|---|---|---|
| **Umami Cloud** | Free (Hobby: 3 Sites, 100k Ev./Mt., 6 Mt. Retention); Pro **$20/Mt.** für 1M Ev. ($9-Tier mit 100k Ev. bei jährlich) | ✅ JSON event-data | ✅ Event-Data-Breakdown je Property-Name/Wert, filterbar | Schlank, open source, sehr günstig, EU-Hosting wählbar | **Top-Kandidat** (Preis/Einfachheit) |
| **Rybbit Cloud** | **$13/Mt.** (Standard, 100k Pageviews, 5 Sites, 3 User) | ✅ unbegrenzt, JSON-Payloads | ✅ Filter nach JSON-Properties | Modern, cookie-free, gutes UI, optional Session-Replay | **Top-Kandidat** (Developer-freundlich) |
| **Plausible** | Starter **$9** / Growth **$14** / Business **$19** (je ~10k Pageviews; skaliert mit Traffic) | ✅ Goals/Events | ⚠️ **Custom Properties + Filter erst ab Business ($19)** | Bekannt, EU (DE-Server-Option), sehr saubere UI | Gut, aber Property-Filter kostet Business-Tier |
| **Pirsch** (frühere Empfehlung) | ab **€6/Mt.** | ✅ Events + Metadata | ✅ Properties/Metadata filterbar | DE-Anbieter, Daten in DE, cookieless, Pageview-Level-Properties | Gut, günstig, DSGVO-stark |
| **Swetrix Cloud** | **$19/Mt.** (100k Ev.); 1M = $79; 14 Tage Test | ✅ Events + Metadata | ✅ Metadata-Key aggregierbar, -Wert filterbar | Open source, indie, kein Free-Tier mehr | Solide, aber teurer Einstieg |
| **PostHog Cloud (EU)** | **Free bis 1M Events/Mt.**, danach $0,00005/Event | ✅ voll | ✅ sehr mächtig (beliebige Properties, Cohorts) | Product-Analytics (Funnels, Replay, Flags); EU-Cloud | Stärkster Free-Tier, aber **schwergewichtig** (mehr Tool als nötig) |
| Simple Analytics | Self-serve **€20/Mt.** | ✅ Events + Metadata | ⚠️ Metadata anhängbar, aber **keine echte Dimensions-Filterung** wie GA4 | Maximal simpel, EU (NL) | **Erfüllt #2/#3 nur teilweise** |
| Fathom | ab **$14/Mt.** | ✅ Events/Conversions | ❌ **keine Property/Dimensions-Filterung** | Sehr simpel, cookieless | **Fällt raus** (kein Plattform-Filter möglich) |
| *Vercel (aktuell, Referenz)* | im Vercel-Plan enthalten | ✅ `track()` mit Custom-Daten | ⚠️ `platform`-Dimension nur auf `track()`-Events, nicht auf Pageviews | Nahtlos integriert, kein Setup | Baseline; Grenzen siehe Memory |

## Einordnung für dieses Projekt (niedriges Traffic-Volumen)

- **Günstigste vollwertige Optionen:** **Umami Cloud** und **Rybbit** — beide
  erfüllen alle drei Kriterien, sind simpel und kosten ~$9–13/Mt.
- **Wenn DSGVO/DE-Hosting im Vordergrund:** **Pirsch** (€6) oder Plausible
  Business (DE-Server-Option, $19).
- **Wenn Budget 0 wichtig ist und etwas mehr Tool ok ist:** **PostHog Cloud EU**
  (Free bis 1M Events) — aber Overkill für reine Web-Analytics.
- **Raus:** Fathom (kein Property-Filter), Simple Analytics (nur eingeschränkt).

Der Plattform-Filter (`web`/`ios`/`android`) funktioniert bei allen ✅-Tools über
dieselbe `platform`-Custom-Property, die schon zentral in `lib/analytics.ts`
gesetzt wird — ein Wechsel berührt nur diese Datei (tool-agnostisch).

## Quellen

- Plausible Pricing — https://plausible.io/#pricing
- Plausible Custom Properties (Business) — https://comparetiers.com/tools/plausible-analytics
- Umami Pricing — https://umami.is/pricing , Event Data — https://docs.umami.is/docs/event-data
- Rybbit Pricing — https://rybbit.com/pricing , Events — https://rybbit.com/docs/track-events
- Swetrix — https://swetrix.com/ , Events-API — https://docs.swetrix.com/events-api
- PostHog Pricing — https://posthog.com (checkthat.ai/brands/posthog/pricing)
- Simple Analytics Metadata — https://docs.simpleanalytics.com/metadata
- Fathom Events — https://usefathom.com/docs/events/overview
