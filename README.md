# Accessible Places

A web app that finds wheelchair-accessible cafés, restaurants, hotels, museums and more across Germany, Austria and Switzerland. The app aggregates accessibility data from multiple sources, deduplicates places across them, attaches a per-criterion confidence score, and surfaces user-verified entries with a dedicated badge.

A particular focus is placed on **data reliability**: each source is weighted by the trustworthiness of its accessibility information. Google Places carries the lowest weight (0.35) — its accessibility data is frequently sparse, heuristic, or absent entirely, making reliable results a recurring challenge when including it.

Built with **Next.js 16 (Turbopack)**, **React 19**, **Tailwind v4**, and **Leaflet**, with a streaming NDJSON search route that updates the UI as each data source returns.

---

## Table of contents

- [Key features](#key-features)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Project structure](#project-structure)
- [How it works](#how-it-works)
  - [Search pipeline](#search-pipeline)
  - [Streaming response](#streaming-response)
  - [Data sources & reliability weights](#data-sources--reliability-weights)
  - [Confidence scoring](#confidence-scoring)
  - [User-verified badge (Wheelmap / OSM check_date)](#user-verified-badge-wheelmap--osm-check_date)
  - [Wheelmap deep-link per place](#wheelmap-deep-link-per-place)
- [Categories](#categories)
- [Filters](#filters)
- [Deployment to Vercel](#deployment-to-vercel)
- [Testing](#testing)
- [Versioning](#versioning)

---

## Key features

- **Multi-source aggregation.** Pulls data in parallel from OpenStreetMap (Overpass), accessibility.cloud and Google Places (New), then deduplicates places by name + address + geo proximity.
- **Per-criterion confidence.** Each place gets entrance / toilet / parking attributes, scored by source reliability and presence of strong signals (e.g. `toilets:wheelchair=designated`, A.Cloud `grabBars` object).
- **Streaming search.** The `/api/search` endpoint emits NDJSON events as each source responds, so the FilterPanel shows per-source loaders → counts → warning icons live.
- **Containment-aware deduplication.** OSM duplicates like `Meierei` (node) and `Meierei - Brauerei Potsdam` (way) at the same coordinates merge into a single canonical place.
- **Verified-recently badge.** OSM `check_date:wheelchair` (written by Wheelmap surveys) within 2 years boosts the source weight ×1.2 and renders a `✓♿` mark left of the score.
- **Wheelmap deep-link.** Every place card links out to its Wheelmap page — using accessibility.cloud's `infoPageUrl` when available, falling back to OSM-id and finally a coordinate-centred map view.
- **Bilingual UI.** German and English, with a runtime language switcher persisted to `localStorage`.
- **Responsive layout.** Full desktop layout (filter sidebar | resizable results column | map) and a dedicated mobile layout with tab bar (results / map / filter). Installable as a PWA on iOS and Android.
- **"In der Nähe" mode.** One tap locates the user via the browser Geolocation API and searches around the current position, with a pulsing blue marker on the map.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.2 (App Router, Turbopack), React 19 |
| Styling | Tailwind v4, shadcn/ui (Radix primitives), lucide-react icons |
| Maps | Leaflet 1.9 + react-leaflet 5 (dynamically imported, no SSR) |
| Analytics | Vercel Analytics |
| Tests | Vitest + Testing Library + jsdom |
| Build & deploy | Vercel-friendly streaming with `Cache-Control: no-store` and `X-Accel-Buffering: no` |

---

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Provide API keys (see below)
cp .env.example .env.local   # if present, otherwise create .env.local manually

# 3. Run the dev server
npm run dev
```

The app is then available at <http://localhost:3000>.

### Available scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Start the built production server |
| `npm run lint` | Run ESLint |
| `npm test` | Run all Vitest tests once |
| `npm run test:watch` | Run tests in watch mode |

---

## Environment variables

Create a `.env.local` in the project root. None of these are exposed to the browser — all are read server-side.

| Variable | Required | What it unlocks |
|---|---|---|
| `ACCESSIBILITY_CLOUD_API_KEY` | optional | accessibility.cloud / Wheelmap data. Without it that source is skipped silently. |
| `GOOGLE_PLACES_API_KEY` | optional | Google Places (New) Nearby + accessibility flags. |

OpenStreetMap (Overpass) requires no key.

---

## Project structure

```
app/
  layout.tsx              Root layout, fonts, LocaleProvider, TooltipProvider, Analytics
  page.tsx                Home — Chat / Filter / Results / Map
  icon.svg                App icon, auto-served as favicon by Next.js
  sitemap.ts              Dynamic sitemap for search engine indexing
  robots.ts               robots.txt — allows all crawlers, points to sitemap
  faq/page.tsx            FAQ page (DE + EN)
  impressum/page.tsx      Legal notice / Impressum (DE + EN, obfuscated email)
  api/
    search/route.ts       NDJSON streaming search pipeline
    geocode/route.ts      Thin Nominatim wrapper
components/
  chat/ChatPanel.tsx              Auto-resizing textarea + example chips + nearby mode
  filters/FilterPanel.tsx         Source toggles, criteria, radius slider
  map/MapView.tsx                 Leaflet (dynamic import), confidence-coloured markers, user location dot
  mobile/MobileLayout.tsx         Mobile-specific layout with tab bar (results / map / filter)
  results/
    ResultsList.tsx
    PlaceCard.tsx                 One card per place — Wheelmap link, debug sheet
    A11yAttribute.tsx             Per-criterion row in a card
    ConfidenceBadge.tsx           Score badge + ✓♿ verified marker, tooltip-driven score breakdown
    PlaceDebugSheet.tsx           Side-sheet exposing raw source records
  ui/                             shadcn primitives
  LanguageSwitcher.tsx            <select> de/en
lib/
  types.ts                        Domain types: Place, AccessibilityAttribute, SearchFilters, …
  config.ts                       Reliability weights, thresholds, OSM tag mappings, APP_VERSION
  utils.ts                        cn, nanoid
  adapters/
    osm.ts                        Overpass query builder + parser; check_date-based boost
    accessibility-cloud.ts        A.Cloud parser; surfaces wheelmapUrl
    google-places.ts              Places API (New) per-category POSTs
    index.ts                      safeRun + startAdapterTasks for streaming
  matching/
    match.ts                      Trigram + Haversine + name-containment match
    merge.ts                      Source-weighted attribute merge, confidence rules
  i18n/
    index.tsx                     LocaleProvider, useTranslations, useLocale
    de.ts / en.ts / types.ts
public/
  llms.txt                        Concise app description for AI crawlers
  llms-full.txt                   Full FAQ content for deep AI indexing
__tests__/                        Vitest suites — components, lib, integration (live)
```

---

## How it works

### Search pipeline

```
user query
   │
   ▼
geocode (Nominatim, DACH-restricted)
   │
   ▼
adapters in parallel  → OSM, A.Cloud, Google Places
   │   each emits a `{type:"source", …}` NDJSON event when it returns
   ▼
match + merge   (haversine 80m + trigram + name containment)
   │
   ▼
computeFilteredConfidence  (only active filter criteria count)
   │
   ▼
passesFilters
   │
   ▼
sort by overallConfidence
   │
   ▼
emit `{type:"result", payload: SearchResult}` and close the stream
```

### Streaming response

`/api/search` returns `Content-Type: application/x-ndjson`. The client reads it incrementally:

```
{"type":"source","sourceId":"osm","status":"ok","count":18,"durationMs":1234}
{"type":"source","sourceId":"google_places","status":"error","error":"TimeoutError","durationMs":15000}
…
{"type":"result","payload":{…SearchResult…}}
```

This is what powers the per-source loader / count / warning icon next to each entry in the filter panel — see `app/page.tsx` for the reader loop.

### Data sources & reliability weights

| Source | Weight | What it brings |
|---|---|---|
| accessibility.cloud (Wheelmap and partners) | 0.75 | A11yJSON-shaped records, often with structured restroom / entrance details |
| OpenStreetMap (Overpass) | 0.70 | Wide coverage, varying quality; single-tag signals |
| Google Places (New) | 0.35 | Broad but accessibility data is sparse and often heuristic |

OSM `wheelchair=*` is treated as a whole-place proxy; an additional ×0.85 factor is applied when it stands in for the entrance attribute specifically.

### Confidence scoring

Each accessibility attribute on a `Place` carries:

- `value` — `yes | limited | no | unknown`
- `confidence` — 0..1
- `conflict` — `true` if a runner-up source value carries more than half the winner's weight
- `sources[]` — the per-source attributions
- `details` — typed sub-attributes (door width, grab bars, ramp slope, etc.)

The merge picks a winner by summed source weight. Toilet attributes are governed by an extra rule:

- `isDesignated === true` *or* `hasGrabBars === true` → confidence is boosted to **1.0** (strong evidence)
- otherwise, when toilet-typed detail keys are present at any source → confidence capped at **0.9** (so two weak sources summing > 1 can't claim 100 %)
- otherwise → the raw weighted base

`computeFilteredConfidence` averages **only the criteria the user has filtered for**, so toggling parking off doesn't deflate scores of places that lack parking data.

### User-verified badge (Wheelmap / OSM check_date)

When an OSM record carries `check_date:wheelchair` (or `check_date:toilets:wheelchair`, or a generic `check_date`) within 2 years, the adapter passes `weightMultiplier = 1.2` to `buildAttribute` and marks the source attribution `verifiedRecently: true`. The `ConfidenceBadge` then renders a small `✓♿` icon left of the score.

### Wheelmap deep-link per place

Each card has a `♿` icon-link to wheelmap.org. Priority:

1. `place.wheelmapUrl` from accessibility.cloud's `infoPageUrl` (validated to be a wheelmap.org host)
2. OSM-id constructed `https://wheelmap.org/nodes/<id>` for nodes
3. Coordinate fallback `https://wheelmap.org/?lat=…&lon=…&zoom=19`

---

## Categories

16 fine-grained categories with separate OSM tag mappings each:

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

The split between `bar` / `pub` / `biergarten` and `theater` / `cinema` and `hotel` / `hostel` / `apartment` exists so a query like "Biergärten in München" doesn't return cocktail bars and "Kino in Berlin" doesn't return playhouses.

---

## Filters

The `FilterPanel` is the left-hand sidebar (desktop) or the third tab (mobile):

- **Sources** — toggle OSM / accessibility.cloud / Google Places. Each row shows live status during a search (spinner → result count → ⚠ on error).
- **Criteria** — wheelchair entrance, toilet, parking, seating. Each toggled criterion contributes to `passesFilters` and to `computeFilteredConfidence`.
- **Radius** — 1–50 km, default 5 km.
- **"Show places with unclear information"** — when off, places with `value === "unknown"` are dropped for any active criterion. When on, unknowns pass.

---

## Deployment to Vercel

The project is Vercel-ready out of the box (Next.js 16). A few things to set up:

1. Push to GitHub and connect the repo in the Vercel dashboard — auto-detects Next.js, no config needed.
2. **Add environment variables** under *Project → Settings → Environment Variables* for Production / Preview / Development. Optional: `ACCESSIBILITY_CLOUD_API_KEY`, `GOOGLE_PLACES_API_KEY`.
3. **Function timeout.** Overpass calls can take 15–25 s — exceeding Vercel's default 10 s on the Hobby plan. Add `export const maxDuration = 60` to `app/api/search/route.ts` if you hit timeouts on production.
4. The streaming response uses `Cache-Control: no-store` and `X-Accel-Buffering: no` headers so Vercel's edge proxy doesn't buffer NDJSON output.

---

## Testing

```bash
npm test                 # one-shot
npm run test:watch       # watch mode
```

Layout:

- `__tests__/components/` — React component tests with Testing Library / jsdom
- `__tests__/lib/adapters/` — adapter unit tests with mocked `fetch`
- `__tests__/lib/matching/` — match score and merge logic
- `__tests__/integration/` — live integration tests that hit OSM, A.Cloud and Google. **They skip themselves when keys are absent.** They are flaky by nature (rate-limited public endpoints) and are excluded from the default expected-pass set in CI.

---

## Versioning

The user-visible app version lives in `lib/config.ts` as `APP_VERSION`. It is shown in the Impressum page under the "Version" section. Bump it on every meaningful release so a quick glance at the Impressum confirms the right build is live. Versions are also tagged in commit messages (`v1.30`, `v1.31`, …).
