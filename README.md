# Accessible Places

A web app that finds wheelchair-accessible cafés, restaurants, hotels, museums and more across Germany, Austria and Switzerland. The app aggregates accessibility data from multiple sources, deduplicates places across them, attaches a per-criterion confidence score, and surfaces user-verified entries with a dedicated badge.

Built with **Next.js 16 (Turbopack)**, **React 19**, **Tailwind v4**, **Leaflet**, the **Anthropic SDK** for natural-language query parsing, and a streaming NDJSON search route that updates the UI as each data source returns.

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
  - [Name search vs. category search](#name-search-vs-category-search)
  - [Quoted names override the LLM](#quoted-names-override-the-llm)
  - [User-verified badge (Wheelmap / OSM check_date)](#user-verified-badge-wheelmap--osm-check_date)
  - [Wheelmap deep-link per place](#wheelmap-deep-link-per-place)
  - [Dog-policy enrichment](#dog-policy-enrichment)
- [Categories](#categories)
- [Filters](#filters)
- [Deployment to Vercel](#deployment-to-vercel)
- [Testing](#testing)
- [Versioning](#versioning)

---

## Key features

- **Multi-source aggregation.** Pulls data in parallel from OpenStreetMap (Overpass), accessibility.cloud, Google Places (New) and Reisen für Alle, then deduplicates places by name + address + geo proximity.
- **Per-criterion confidence.** Each place gets entrance / toilet / parking attributes, scored by source reliability and presence of strong signals (e.g. `toilets:wheelchair=designated`, A.Cloud `grabBars` object).
- **Streaming search.** The `/api/search` endpoint emits NDJSON events as each source responds, so the FilterPanel shows per-source loaders → counts → warning icons live.
- **Natural-language query parsing.** A user types "Rollstuhlgerechte Cafés in Berlin Mitte" or `"Meierei" in Potsdam` — the Anthropic Claude Haiku model extracts location, categories and an optional name hint. Quoted strings always win as deterministic name hints.
- **Name-first search path.** When the user names a specific place, adapter queries widen (no wheelchair pre-filter) and the OSM Overpass query switches to a name-targeted regex so the 100-result cap can't hide the target.
- **Containment-aware deduplication.** OSM duplicates like `Meierei` (node, fast-food kiosk) and `Meierei - Brauerei Potsdam` (way, brewery) at the same coordinates merge into a single canonical place.
- **Verified-recently badge.** OSM `check_date:wheelchair` (written by Wheelmap surveys) within 2 years boosts the source weight ×1.2 and renders a `✓♿` mark left of the score.
- **Wheelmap deep-link.** Every place card links out to its Wheelmap page — using accessibility.cloud's `infoPageUrl` when available, falling back to OSM-id and finally a coordinate-centred map view.
- **Dog-policy hint.** OSM `dog=*` and accessibility.cloud `animalPolicy.allowsDogs` (Pfotenpiloten) are extracted and shown as a 🐾 badge on cards. (Top-level filter intentionally not exposed — data is too sparse.)
- **Bilingual UI.** German and English, with a runtime language switcher persisted to `localStorage`.
- **Resizable result column** with a draggable divider, full-screen map mode, dual SSR-safe Leaflet rendering.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.2 (App Router, Turbopack), React 19 |
| Styling | Tailwind v4, shadcn/ui (Radix primitives), lucide-react icons |
| Maps | Leaflet 1.9 + react-leaflet 5 (dynamically imported, no SSR) |
| LLM | Anthropic SDK, Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) |
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
| `ANTHROPIC_API_KEY` | recommended | Claude Haiku for query parsing & result summary. Without it the app falls back to a regex-based parser that cannot extract `nameHint`. |
| `ACCESSIBILITY_CLOUD_API_KEY` | optional | accessibility.cloud / Wheelmap data. Without it that source is skipped silently. |
| `GOOGLE_PLACES_API_KEY` | optional | Google Places (New) Nearby + accessibility flags. |
| `REISEN_FUER_ALLE_API_KEY` + `REISEN_FUER_ALLE_API_BASE` | optional | Certified-business data; the adapter skips silently when either is missing or still a `your_…` placeholder. |

OpenStreetMap (Overpass) requires no key.

---

## Project structure

```
app/
  layout.tsx           Root layout, fonts, LocaleProvider, TooltipProvider
  page.tsx             Home — Chat / Filter / Results / Map
  api/
    search/route.ts    NDJSON streaming search pipeline
    geocode/route.ts   Thin Nominatim wrapper
components/
  chat/ChatPanel.tsx           Auto-resizing textarea + example chips
  filters/FilterPanel.tsx      Source toggles, criteria, radius slider
  map/MapView.tsx              Leaflet (dynamic import), confidence-coloured markers
  results/
    ResultsList.tsx
    PlaceCard.tsx              One card per place — with Wheelmap link, dog badge, debug sheet
    A11yAttribute.tsx          Per-criterion row in a card
    ConfidenceBadge.tsx        Score badge + ✓♿ verified marker, tooltip-driven score breakdown
    PlaceDebugSheet.tsx        Side-sheet exposing raw source records
  ui/                          shadcn primitives
  LanguageSwitcher.tsx         <select> de/en
lib/
  types.ts                     Domain types: Place, AccessibilityAttribute, SearchFilters, …
  config.ts                    Reliability weights, thresholds, OSM tag mappings, APP_VERSION
  llm.ts                       parseQuery, summariseResults, regex fallbacks, quote extractor
  utils.ts                     cn, nanoid
  adapters/
    osm.ts                     Overpass query builder + parser; check_date-based boost
    accessibility-cloud.ts     A.Cloud parser; surfaces wheelmapUrl + animalPolicy
    google-places.ts           Places API (New) per-category POSTs
    reisen-fuer-alle.ts        Certified-business adapter (gated on real key)
    index.ts                   safeRun + startAdapterTasks for streaming
  matching/
    match.ts                   Trigram + Haversine + name-containment match
    merge.ts                   Source-weighted attribute merge, confidence rules
  i18n/
    index.tsx                  LocaleProvider, useTranslations, useLocale
    de.ts / en.ts / types.ts
__tests__/                     Vitest suites — components, lib, integration (live)
```

---

## How it works

### Search pipeline

```
user query
   │
   ▼
parseQuery (Claude Haiku → JSON)        ← regex fallback if no key
   │   { locationQuery, nameHint, categories, freeTextHint }
   ▼
geocode (Nominatim, DACH-restricted)
   │
   ▼
adapters in parallel  → OSM, A.Cloud, Google Places, Reisen für Alle
   │   each emits a `{type:"source", …}` NDJSON event when it returns
   ▼
match + merge   (haversine 80m + trigram + name containment)
   │
   ▼
filterByNameHint  (only when nameHint set)
   │
   ▼
computeFilteredConfidence  (only active filter criteria count)
   │
   ▼
passesFilters (skipped when nameHint set — show by name regardless of filters)
   │
   ▼
sort by overallConfidence  →  summariseResults (Claude Haiku, optional)
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
| Reisen für Alle | 1.00 | Certified, on-site inspected |
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

### Name search vs. category search

- **Category search** ("Cafés in Berlin Mitte"): adapters are queried by category and radius; OSM uses `[amenity~"^(...)$"]`; A.Cloud applies the `at-least-partially-accessible-by-wheelchair` preset; the standard accessibility filters are honoured.
- **Name search** ("`Meierei`" in Potsdam): adapter queries widen — OSM switches to `[name~"<case-class>"][amenity]` (and other POI keys), A.Cloud uses its `q` parameter and skips the wheelchair preset, forced ALL_CATEGORIES at the route boundary, accessibility filters neutralised. The accessibility post-filter is also skipped so the named place always shows up regardless of its accessibility data.

### Quoted names override the LLM

Wrap a name in any of `"…"`, `'…'`, `„…"`, `"…"`, `«…»` — `extractQuotedName` extracts it and the route uses it as the deterministic `nameHint`, regardless of what the LLM returned. Useful when the LLM is misclassifying short or ambiguous names.

### User-verified badge (Wheelmap / OSM check_date)

When an OSM record carries `check_date:wheelchair` (or `check_date:toilets:wheelchair`, or a generic `check_date`) within 2 years, the adapter passes `weightMultiplier = 1.2` to `buildAttribute` and marks the source attribution `verifiedRecently: true`. The `ConfidenceBadge` then renders a small `✓♿` icon left of the score.

### Wheelmap deep-link per place

Each card has a `♿` icon-link to wheelmap.org. Priority:

1. `place.wheelmapUrl` from accessibility.cloud's `infoPageUrl` (validated to be a wheelmap.org host)
2. OSM-id constructed `https://wheelmap.org/nodes/<id>` for nodes
3. Coordinate fallback `https://wheelmap.org/?lat=…&lon=…&zoom=19`

### Dog-policy enrichment

OSM `dog=yes/leashed` → `place.allowsDogs = true`; `dog=no/outside` → `false` (outside-only doesn't help inside seating). accessibility.cloud's Pfotenpiloten dataset feeds `properties.accessibility.animalPolicy.allowsDogs`. When a Pfotenpiloten record arrives without any wheelchair data it gets a `dogPolicyOnly` flag — those records are dropped from the final result unless they merged into a place that does carry wheelchair data, ensuring the dog hint is supplementary, never the primary signal.

A small 🐾 badge on the card communicates the result. There is no top-level "Dogs allowed" filter (it was tried and removed — the underlying data is too sparse to be useful as a hard filter).

---

## Categories

15 fine-grained categories with separate OSM tag mappings each:

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
```

The split between `bar` / `pub` / `biergarten` and `theater` / `cinema` and `hotel` / `hostel` / `apartment` exists so a query like "Biergärten in München" doesn't return cocktail bars and "Kino in Berlin" doesn't return playhouses.

---

## Filters

The `FilterPanel` is the left-hand sidebar:

- **Sources** — toggle OSM / accessibility.cloud / Google Places / Reisen für Alle. Each row shows live status during a search (spinner → result count → ⚠ on error).
- **Criteria** — wheelchair entrance, toilet, parking, seating. Each toggled criterion contributes to `passesFilters` and to `computeFilteredConfidence`.
- **Radius** — 1–50 km, default 5 km.
- **"Show places with unclear information"** — when off, places with `value === "unknown"` are dropped for any active criterion. When on, unknowns pass.

---

## Deployment to Vercel

The project is Vercel-ready out of the box (Next.js 16). A few things to set up:

1. Push to GitHub and connect the repo in the Vercel dashboard — auto-detects Next.js, no config needed.
2. **Add environment variables** under *Project → Settings → Environment Variables* for Production / Preview / Development: at minimum `ANTHROPIC_API_KEY`. Optional: `ACCESSIBILITY_CLOUD_API_KEY`, `GOOGLE_PLACES_API_KEY`, `REISEN_FUER_ALLE_API_KEY` + `_API_BASE`.
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
- `__tests__/lib/llm.test.ts` — regex fallback paths
- `__tests__/integration/` — live integration tests that hit OSM, A.Cloud, Google, Anthropic. **They skip themselves when keys are absent.** They are flaky by nature (rate-limited public endpoints) and are excluded from the default expected-pass set in CI.

---

## Versioning

The user-visible app version lives in `lib/config.ts` as `APP_VERSION` and is rendered in the header next to the subtitle, e.g. `Find wheelchair-accessible places (v1.7)`. Bump it on every meaningful release so a quick glance at production confirms the right build is live. Recent versions are tagged in commit messages (`v1.5`, `v1.6`, `v1.7`, …).
