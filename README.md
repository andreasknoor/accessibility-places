# Accessible Places

A web app that finds wheelchair-accessible cafés, restaurants, hotels, museums and more across Germany, Austria and Switzerland (DACH). The app aggregates accessibility data from up to five sources, deduplicates places across them, attaches a per-criterion confidence score, surfaces recently user-verified entries with a dedicated badge, and can enrich venues with nearby disabled-parking information.

A particular focus is placed on **data reliability**: each source is weighted by the trustworthiness of its accessibility information. Reisen für Alle (a certified-survey programme) carries the highest weight (1.00); Google Places carries the lowest (0.35) — its accessibility data is frequently sparse, heuristic, or absent entirely.

Built with **Next.js 16 (Turbopack)**, **React 19**, **Tailwind v4**, and **Leaflet**, with a streaming NDJSON search route that updates the UI as each data source returns. The app is installable as a PWA and ships SEO landing pages for 32 DACH cities.

---

## Table of contents

- [Key features](#key-features)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Available scripts](#available-scripts)
- [Environment variables](#environment-variables)
- [Project structure](#project-structure)
- [How it works](#how-it-works)
  - [Search pipeline](#search-pipeline)
  - [Streaming response](#streaming-response)
  - [Data sources & reliability weights](#data-sources--reliability-weights)
  - [Matching & merging](#matching--merging)
  - [Confidence scoring](#confidence-scoring)
  - [Verified-recently badge](#verified-recently-badge)
  - [Nearby disabled-parking enrichment](#nearby-disabled-parking-enrichment)
- [Search modes](#search-modes)
- [Categories](#categories)
- [Filters & user settings](#filters--user-settings)
- [SEO landing pages](#seo-landing-pages)
- [PWA / service worker](#pwa--service-worker)
- [Infrastructure](#infrastructure)
- [API routes](#api-routes)
- [Deployment to Vercel](#deployment-to-vercel)
- [Testing](#testing)
- [Versioning](#versioning)

---

## Key features

- **Multi-source aggregation.** Pulls data in parallel from OpenStreetMap (Overpass), accessibility.cloud, Reisen für Alle, Ginto (Switzerland) and Google Places, then deduplicates places by name + address + geo proximity.
- **Per-criterion confidence.** Each place gets entrance / toilet / parking attributes (seating where available), scored by source reliability and the presence of strong signals (e.g. `toilets:wheelchair=designated`, A.Cloud `grabBars`).
- **Streaming search.** The `/api/search` endpoint emits NDJSON events as each source responds, so the UI shows per-source loaders → counts → warning icons live.
- **Containment-aware deduplication.** OSM duplicates like `Meierei` (node) and `Meierei – Brauerei Potsdam` (way) at the same coordinates merge into a single canonical place.
- **Verified-recently badge.** OSM `check_date:wheelchair` (written by Wheelmap surveys) within 2 years boosts the source weight ×1.2 and renders a verified mark next to the score.
- **Nearby disabled-parking.** Optionally upgrades a venue's parking value when a dedicated disabled-parking node sits within 300 m, and renders parking markers on the map with a dedicated "Parkplatz-Modus".
- **Three search modes.** Text search ("Cafés in Berlin"), "In der Nähe" GPS search, and place-search by name.
- **Bilingual UI.** German and English, with a runtime language switcher and dedicated `/en/*` routes.
- **Responsive layout.** Full desktop layout (filter sidebar | resizable results column | map) and a mobile layout with a tab bar (results / map / filter). Installable as a PWA.
- **SEO landing pages.** ISR pages for 32 DACH cities × 10 categories × 2 locales, rendered lazily on first request.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.2 (App Router, Turbopack), React 19 |
| Styling | Tailwind v4, shadcn/ui (Radix primitives), lucide-react icons |
| Maps | Leaflet 1.9 + react-leaflet 5 + leaflet.markercluster (dynamically imported, no SSR) |
| PWA | `@serwist/next` service worker (disabled in development) |
| Analytics | Vercel Analytics + Vercel Speed Insights |
| Stats store | Upstash Redis (optional; adapter usage metrics) |
| Tests | Vitest + Testing Library + jsdom |
| Build & deploy | Vercel streaming with `Cache-Control: no-store` and `X-Accel-Buffering: no` |

---

## Getting started

```bash
# 1. Install dependencies (also installs the .githooks pre-commit hook via `prepare`)
npm install

# 2. Provide API keys (all optional — sources are skipped silently when absent)
cp .env.example .env.local   # if present, otherwise create .env.local manually

# 3. Run the dev server
npm run dev
```

The app is then available at <http://localhost:3000>.

> **Note:** A pre-commit hook runs `npm test` automatically on every commit (expect ~10–20 s). Always run `npm test` before committing or pushing.

---

## Available scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Serve the built production output |
| `npm run lint` | Run ESLint |
| `npm test` | Run all Vitest tests once (required before every commit/push) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run check:seo` | Update which city/category combos actually have accessible data |
| `npm run warm:seo` | Prime the ISR cache for all SEO pages |
| `npx vitest run <file>` | Run a single test file |

`check:seo` runs daily at 03:00 UTC and `warm:seo` at 03:30 UTC via GitHub Actions (both support manual `workflow_dispatch`).

---

## Environment variables

Create a `.env.local` in the project root. None of these are exposed to the browser — all are read server-side. Every external data source is optional and skipped silently when its key is absent (OpenStreetMap requires no key).

| Variable | Required | What it unlocks |
|---|---|---|
| `ACCESSIBILITY_CLOUD_API_KEY` | optional | accessibility.cloud / Wheelmap data |
| `REISEN_FUER_ALLE_API_KEY` | optional | Reisen für Alle certified-survey data (request access from DSFT/Natko) |
| `REISEN_FUER_ALLE_API_BASE` | with key | Base URL for the RfA API (required alongside the key) |
| `GINTO_API_KEY` | optional | Ginto GraphQL API (Swiss accessibility data, CH only) |
| `GOOGLE_PLACES_API_KEY` | optional | Google Places (New) data; also enables the photo proxy |
| `ENABLE_NEARBY_PARKING` | optional | Set to `1` to enable disabled-parking enrichment and parking markers |
| `OVERPASS_ENDPOINTS` | optional | Comma-separated Overpass URLs (defaults to two public mirrors; production prepends a private server) |
| `NOMINATIM_ENDPOINT` | optional | Base URL of a private Nominatim instance |
| `HEALTH_CHECK_SECRET` | optional | Activates `GET /api/health` and `GET /api/stats` (401 without a matching `?token=`) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | optional | Upstash Redis credentials for adapter usage stats |

The DACH restriction is enforced by `countrycodes=de,at,ch` in Nominatim calls and a bounding box in the Photon proxies — both must be updated when expanding beyond DACH.

---

## Project structure

```
app/
  layout.tsx                Root layout, fonts, LocaleProvider, Analytics, SpeedInsights
  HomeClient.tsx            Root client component: search state, layout switching, stream dispatch
  page.tsx                  Home page (DE) — reads deep-link params, renders HomeClient
  en/                       English locale: nested LocaleProvider, layout, pages
  [city]/[category]/        ISR SEO landing pages (DE)
  en/[city]/[category]/     ISR SEO landing pages (EN)
  faq/ impressum/ ueber-uns/   Static bilingual pages
  manifest.ts sitemap.ts robots.ts icon.svg sw.ts
  api/
    search/route.ts             NDJSON streaming search pipeline
    nearby-parking/route.ts     Standalone disabled-parking fetch
    geocode/                    route + suggest + place-suggest + reverse (Nominatim / Photon proxies)
    image/google/route.ts       Google Places photo proxy (SSRF-guarded)
    health/route.ts             Token-protected E2E health check (live + mock modes)
    stats/route.ts              Token-protected adapter usage stats
    log-error/route.ts          Client-side error forwarding
components/
  chat/ChatPanel.tsx              Search input, mode tabs, example chips, nearby + parking info row
  filters/FilterPanel.tsx         Source toggles, criteria, radius, predictive per-source counts
  map/MapView.tsx                 Leaflet (dynamic), clustered confidence-coloured markers, parking legend
  mobile/MobileLayout.tsx         Mobile tab-bar layout (results / map / filter)
  results/                        ResultsList, PlaceCard, A11yAttribute, ConfidenceBadge, PlaceDebugSheet
  settings/SettingsSheet.tsx      User-configurable defaults (gear icon)
  seo/SeoPageContent.tsx          Shared DE/EN SEO page body (JSON-LD, hreflang, related links)
  ui/                             shadcn primitives
lib/
  types.ts config.ts utils.ts llm.ts settings.ts stats.ts
  cities.ts seo-search.ts seo-validity.ts generated/seo-validity.json
  adapters/                       osm, accessibility-cloud, reisen-fuer-alle, ginto, google-places, index
  matching/                       match.ts, merge.ts, nearby-parking.ts
  i18n/                           index.tsx, de.ts, en.ts, types.ts
public/                           llms.txt, llms-full.txt, icons
__tests__/                        components / lib / api / integration
scripts/                          check-seo-validity, warm-seo, compare-overpass-parking
```

---

## How it works

### Search pipeline

```
user query (or GPS coordinates / place name)
   │
   ▼
geocode (Nominatim, DACH-restricted)        ← skipped when coordinates are supplied
   │
   ▼
adapters in parallel  → OSM, A.Cloud, Reisen für Alle, Ginto, Google Places
   │   each emits a {type:"source", …} NDJSON event when it returns
   ▼
match + merge   (haversine + trigram + name containment)
   │
   ▼
nearby-parking enrichment   (optional, ENABLE_NEARBY_PARKING)
   │
   ▼
computeFilteredConfidence   (only active filter criteria count)
   │
   ▼
passesFilters  +  optional nameHint post-filter
   │
   ▼
sort  →  emit {type:"result", payload: SearchResult}  →  close the stream
```

### Streaming response

`/api/search` is a `POST` endpoint returning newline-delimited JSON (NDJSON). The client (`app/HomeClient.tsx`) reads it as a `ReadableStream` and updates state incrementally:

```
{"type":"source","sourceId":"osm","status":"ok","count":18,"durationMs":1234}
{"type":"source","sourceId":"google_places","status":"error","error":"TimeoutError","durationMs":15000}
…
{"type":"result","payload":{…SearchResult…}}
```

This powers the per-source loader / count / warning icon in the filter panel. The route accepts an optional `coordinates` field (bypasses Nominatim for GPS mode) and an optional `nameHint` applied as a post-filter on the merged results.

### Data sources & reliability weights

| Source | Weight | What it brings |
|---|---|---|
| Reisen für Alle | 1.00 | Certified on-site surveys; highest trust. Always active when the key is set (hidden from the source toggles) |
| Ginto | 0.90 | GraphQL API, Switzerland only. LEVEL_2 entries → 0.95, LEVEL_3 → 0.97 |
| OpenStreetMap (Overpass) | 0.75 | Primary source; broadest coverage, live data, direct wheelchair tags |
| accessibility.cloud | 0.70 | A11yJSON records; largely a Wheelmap mirror of OSM for DACH, plus supplementary datasets (dog policies etc.) |
| Google Places (New) | 0.35 | Broad but sparse/heuristic accessibility data. **Disabled by default** |

OSM `wheelchair=*` is treated as a whole-place proxy; an extra `OSM_ENTRANCE_WEIGHT_FACTOR = 0.90` reduction applies when it stands in for the entrance attribute specifically. A handful of additional source IDs (`osm_parking`, `osm_private`, `osm_public`, `nominatim`, …) carry weight `0` and exist purely for usage statistics.

### Matching & merging

`lib/matching/match.ts` — two places are considered the same when a weighted score exceeds `MATCH_SCORE_THRESHOLD = 0.72`:

```
effectiveName × 0.5 + addrScore × 0.3 + geoScore × 0.2
```

A fast reject fires when distance > 3 × `GEO_MATCH_RADIUS_M` (240 m). Name containment (one normalised name a substring of the other within 80 m) raises the effective name score to ≥ 0.9.

`lib/matching/merge.ts` — the winning `A11yValue` per criterion is decided by summed source reliability weight. `passesFilters` treats both `"yes"` and `"limited"` as passing for an active criterion (only `"no"` fails; `"unknown"` fails unless `acceptUnknown` is on).

### Confidence scoring

Each accessibility attribute carries `value` (`yes | limited | no | unknown`), `confidence` (0..1), `conflict`, `sources[]`, and typed `details`. Toilet attributes get an extra rule: `isDesignated` or `hasGrabBars` boosts confidence to **1.0**; otherwise weaker toilet signals are capped at **0.9**.

`computeFilteredConfidence` averages only the criteria the user has filtered for (active-but-unknown criteria stay in the denominator so enabling `acceptUnknown` can't inflate scores to 100 %). The thresholds `high = 0.70` / `medium = 0.40` map to the labels **Verlässlich / Mittel / Unsicher**.

### Verified-recently badge

When an OSM record carries `check_date:wheelchair` (or `check_date:toilets:wheelchair`, or a generic `check_date`) within 2 years, the adapter applies `RECENT_VERIFICATION_BOOST = 1.2` and marks the attribution `verifiedRecently: true`. The `onlyVerified` filter requires at least one such attribution, and the `ConfidenceBadge` renders a verified mark next to the score.

### Nearby disabled-parking enrichment

Gated behind `ENABLE_NEARBY_PARKING`. `enrichWithNearbyParking()` upgrades a venue's `parking.value` from `"unknown"` to `"yes"` (with `details.nearbyOnly = true`, confidence `0.5`) when a dedicated disabled-parking OSM node sits within 300 m. It deliberately adds no source attribution, so per-source filter counts and confidence are unaffected. Parking markers use a wider 500 m display radius. Two tiers exist: a strong **`"disabled"`** tier (reserved spaces — the only one that may enrich) and a weak, display-only **`"accessible"`** tier (`amenity=parking` merely tagged `wheelchair=yes`), gated client-side by the `showWeakParking` setting.

---

## Search modes

`chatMode` is a three-way union:

- **Text** — "Cafés in Berlin"; geocoded via Nominatim.
- **In der Nähe (nearby)** — one tap locates the user via the browser Geolocation API and searches around the current position, with a pulsing marker on the map and inline distances on result cards. A per-session **Parkplatz-Modus** can switch the map to show only disabled-parking spots within the configured radius.
- **Ort suchen (place)** — look up a specific venue by name without a city/category. The OSM adapter switches to a name-regex Overpass query within 500 m; other adapters use the `nameHint` post-filter.

A name field (separate from the query string) lets users restrict any search to a quoted name; it is passed as `nameHint` and applied after the merge, so accessibility filters apply independently of name searches.

---

## Categories

16 fine-grained categories, each with dedicated OSM tag mappings:

```
cafe          amenity=cafe
restaurant    amenity=restaurant
bar           amenity=bar
pub           amenity=pub
biergarten    amenity=biergarten
fast_food     amenity=fast_food | food_court
hotel         tourism=hotel | motel | guest_house
hostel        tourism=hostel
apartment     tourism=apartment
museum        tourism=museum
theater       amenity=theatre
cinema        amenity=cinema
library       amenity=library
gallery       tourism=gallery | amenity=arts_centre
attraction    tourism=attraction | theme_park
ice_cream     amenity=ice_cream
```

The split (e.g. `bar` / `pub` / `biergarten`, `theater` / `cinema`) keeps queries precise. Only 10 of these have SEO landing pages; `hostel`, `apartment`, `biergarten`, `pub`, `bar` and `ice_cream` are search-only.

---

## Filters & user settings

The `FilterPanel` is the left-hand sidebar (desktop) or the third tab (mobile):

- **Sources** — toggle OSM / accessibility.cloud / Google Places, each with a live status indicator and a predictive per-source result count. (Reisen für Alle and Ginto are hidden but active when keyed.)
- **Criteria** — wheelchair entrance, toilet, parking (with a `parkingNearby` sub-toggle), seating. Each active criterion contributes to `passesFilters` and `computeFilteredConfidence`.
- **Radius** — default 5 km.
- **"Show places with unclear information"** (`acceptUnknown`) — when off, places with `value === "unknown"` are dropped for any active criterion.
- **"Only recently verified"** (`onlyVerified`) — requires a `verifiedRecently` attribution.

Active filters, source toggles and radius are persisted to `localStorage`. Separately, **user settings** (`lib/settings.ts`, key `ap_settings`) configure defaults via the `SettingsSheet` (gear icon): default search mode, default mobile view, pre-selected chip, sort order, auto-zoom, always-show-parking, show-weak-parking, and the Parkplatz-Modus radius. First-time visitors see a welcome/onboarding screen.

> **Invariant:** `SETTING_CHIPS` (in `lib/settings.ts`) and `CHIPS` (in `ChatPanel.tsx`) must stay in the same order — `defaultChipIdx` indexes both.

---

## SEO landing pages

ISR landing pages for **32 DACH cities × 10 categories × 2 locales** under `app/[city]/[category]/` and `app/en/[city]/[category]/`. `generateStaticParams` returns `[]` (pages render lazily on first request); unknown slugs fall through to `notFound()`. Data is fetched live at render time via `fetchPlacesForSeoPage(...)` (`lib/seo-search.ts`), which calls `fetchAllSources` directly — no HTTP round-trip — applies the strict entrance+toilet filter, and returns the top 25 results.

City/category configuration lives in `lib/cities.ts`. `lib/generated/seo-validity.json` (updated by `npm run check:seo`) records which combinations actually have data; only confirmed combos appear in the sitemap and the related-links sections. The shared body (`components/seo/SeoPageContent.tsx`) includes Schema.org `ItemList` + `BreadcrumbList` JSON-LD and an hreflang language switcher. Place cards deep-link back into the main app and auto-select the matching place on arrival.

---

## PWA / service worker

The service worker (`app/sw.ts` via `@serwist/next`) is **disabled in development**. `/api/search` and `/api/nearby-parking` use a `NetworkOnly` handler — Serwist's default `NetworkFirst` has a 10 s timeout that Overpass queries regularly exceed, which would otherwise serve stale/empty cache entries. The Content-Security-Policy lives in `next.config.ts`; **any new external domain** must be added to the appropriate directive (`connect-src` / `img-src`), or it fails silently in production.

---

## Infrastructure

In production the search pipeline races a **self-hosted Overpass server** (DACH-only, Hetzner) ahead of two public mirrors via `OVERPASS_ENDPOINTS` — first successful response wins, the rest are aborted. This eliminates public-mirror rate limits and cuts latency from 2–15 s to ~50–200 ms. The OSM adapter detects an overloaded daemon's HTML-200 responses and rejects that endpoint so the race falls through to the mirrors. See `CLAUDE.md` for the full server configuration and operational notes.

`/api/search` applies in-memory per-IP sliding-window rate limits (10 searches/min general, 3/min for Google Places); these reset on serverless cold start.

---

## API routes

| Route | Purpose |
|---|---|
| `POST /api/search` | NDJSON streaming search pipeline |
| `GET /api/nearby-parking` | Disabled-parking OSM nodes within a radius |
| `GET /api/geocode` | Nominatim forward geocode (DACH) |
| `GET /api/geocode/suggest` | Photon city/district autocomplete |
| `GET /api/geocode/place-suggest` | Photon POI autocomplete (name field) |
| `GET /api/geocode/reverse` | Nominatim reverse geocode (coords → district) |
| `GET /api/image/google` | Google Places photo proxy (SSRF-guarded) |
| `GET /api/health` | Token-protected E2E health check (live + `?mock=1`) |
| `GET /api/stats` | Token-protected adapter usage stats |
| `POST /api/log-error` | Client-side error forwarding |

---

## Deployment to Vercel

The project is Vercel-ready out of the box (Next.js 16):

1. Push to GitHub and connect the repo in the Vercel dashboard — auto-detects Next.js.
2. Add the optional environment variables (see [above](#environment-variables)) for Production / Preview / Development.
3. **Function timeout.** Overpass calls can take 15–25 s. The default function timeout is generous on current plans, but raise `maxDuration` if you hit timeouts.
4. The streaming response sets `Cache-Control: no-store` and `X-Accel-Buffering: no` so the edge proxy doesn't buffer NDJSON output.

---

## Testing

```bash
npm test                 # one-shot (required before every commit/push)
npm run test:watch       # watch mode
```

- `__tests__/components/` — React component tests (Testing Library / jsdom)
- `__tests__/lib/` — pure unit tests (matching, merge, config, cities, adapters)
- `__tests__/api/` — API route unit tests (node environment, mocked `fetch`)
- `__tests__/integration/` — live tests against OSM, A.Cloud, Google etc. They **skip themselves when keys or network are absent** and are not required for CI.

`vitest.setup.ts` mocks `window.matchMedia` (always desktop), `localStorage` and `ResizeObserver`.

---

## Versioning

The user-visible app version lives in `lib/config.ts` as `APP_VERSION` and is shown in the Impressum alongside `BUILD_DATE` (auto-injected at build time). Bump `APP_VERSION` on every meaningful release; versions are also tagged in commit messages (`v3.76`, `v3.77`, …).
