# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # dev server (Turbopack)
npm run build        # production build
npm run lint         # ESLint
npm test             # run all tests once (required before every commit/push)
npm run test:watch   # watch mode

# Run a single test file
npx vitest run __tests__/lib/llm.test.ts
```

**Always run `npm test` before committing or pushing.** No check-ins without a full test run.

## Architecture

### Search pipeline (`app/api/search/route.ts`)

The `/api/search` POST endpoint is a **streaming NDJSON** response. It emits newline-delimited JSON events as work progresses, then one final `result` event:

```
{"type":"source-progress", "sourceId":"osm", "attempt":1, "of":3}
{"type":"source", "sourceId":"osm", "status":"ok", "count":18, "durationMs":1234}
{"type":"result", "payload": { places, location, … }}
```

Client reads this as a `ReadableStream` in `HomeClient.tsx` and updates state incrementally. The route accepts an optional `coordinates` field to bypass Nominatim geocoding (used for the "Nearby" GPS mode) and an optional `nameHint` string that is applied as a post-filter on the merged results via `filterByNameHint()`.

### Query parsing (`lib/llm.ts`)

No LLM is used at runtime. `parseQuery()` deterministically extracts `locationQuery` (for Nominatim) and `categories` (from `CATEGORY_HINTS` regex match). The name filter is entirely separate — it is passed as `nameHint` in the API body and applied server-side after all adapter results are merged.

### Adapters (`lib/adapters/`)

Four adapters run in parallel via `startAdapterTasks()`:
- **OSM** (`osm.ts`): Overpass query, retries across 3 mirror endpoints on timeout/5xx. `[timeout:25]` in QL + `AbortSignal.timeout(28_000)` on the fetch.
- **accessibility.cloud** (`accessibility-cloud.ts`): A11yJSON-shaped records. Always uses `accessibilityPreset=at-least-partially-accessible-by-wheelchair`.
- **Reisen für Alle** (`reisen-fuer-alle.ts`): Highest reliability weight (1.0).
- **Google Places** (`google-places.ts`): Lowest reliability weight (0.35); fires one POST per category.

### Matching & merging (`lib/matching/`)

`match.ts` – a candidate place is considered the same as an existing canonical place when a weighted score (Haversine distance + trigram name similarity + name containment) exceeds `MATCH_SCORE_THRESHOLD = 0.72`.

`merge.ts` – winning `A11yValue` is determined by summed source reliability weight. Toilet confidence is boosted to 1.0 when `isDesignated` or `hasGrabBars` is true. The `computeFilteredConfidence()` function averages **only the criteria the user has active**, so deactivating parking doesn't drag down scores.

### Confidence weights (`lib/config.ts`)

```ts
reisen_fuer_alle:    1.00
accessibility_cloud: 0.75
osm:                 0.70
google_places:       0.35
```

`OSM_ENTRANCE_WEIGHT_FACTOR = 0.90` applies an extra reduction when OSM's whole-place `wheelchair=*` tag stands in for the entrance criterion specifically.

### i18n (`lib/i18n/`)

`LocaleProvider` is nested: root layout uses `"de"` as default; `app/en/layout.tsx` wraps `/en/*` in a second `LocaleProvider initialLocale="en"`. The `document.documentElement.lang` attribute is set only by the leaf layout to avoid the parent overwriting the child. All translations are typed via `lib/i18n/types.ts`.

### Mobile vs desktop

`useIsMobile()` (pointer: coarse or max-width 767px) gates layout branching in `HomeClient.tsx`. Mobile uses `MobileLayout` (tab bar: results / map / filter). Desktop has a resizable results column with a drag handle. In tests, `matchMedia` is mocked to always return `false` (desktop), so both inputs in the search bar are always rendered.

### Name filter (ChatPanel → API)

The name field is a separate input, **not** embedded in the query string. `ChatPanel.onSearch` signature: `(query: string, coords?: Coords, nameHint?: string)`. The `nameHint` is passed in the API request body and applied as a JS post-filter (`filterByNameHint` — substring + trigram ≥ 0.6) after the merge step. This means accessibility filters apply independently of name searches.

### Geocoding API routes

Three proxy routes forward to external geocoding services (all restricted to DACH):
- `GET /api/geocode?q=` — Nominatim forward geocoding; returns `{ lat, lon, displayName }`.
- `GET /api/geocode/suggest?q=&lang=` — Photon/Komoot autocomplete (bbox: DE+AT+CH); returns `[{ display, name }]`.
- `GET /api/geocode/reverse?lat=&lon=` — Nominatim reverse geocoding; returns `{ district }` for the "Nearby" label.

The `countrycodes=de,at,ch` constraint in Nominatim calls and the Photon bounding box must both be updated when expanding beyond DACH.

### Rate limiting & production details

`/api/search` applies in-memory sliding-window rate limits per IP: 10 searches/min general, 3/min for Google Places. These reset on serverless cold start — not suitable for multi-instance without a shared store.

In production, `raw` adapter response data is stripped from `sourceRecords` before the response is sent (see `stripRaw()`). In development the raw data is preserved for debugging.

### PWA / Service Worker

`app/sw.ts` + `@serwist/next`. The service worker is **disabled in development** (`disable: process.env.NODE_ENV === "development"` in `next.config.ts`). Adding new external domains also requires updating the `connect-src` allowlist in the CSP headers defined in `next.config.ts`.

## Versioning

`APP_VERSION` in `lib/config.ts` — bump on every meaningful release. Shown in the Impressum.

## Environment variables (server-side only)

- `ACCESSIBILITY_CLOUD_API_KEY` — optional; source is silently skipped if absent
- `GOOGLE_PLACES_API_KEY` — optional; source is silently skipped if absent
- `ENABLE_NEARBY_PARKING=1` — feature flag; enables the optional disabled-parking enrichment fetch (off by default)

## Tests

- `__tests__/components/` — jsdom + Testing Library
- `__tests__/lib/` — pure unit tests (node environment via `// @vitest-environment node` header where needed)
- `__tests__/integration/` — live network tests; skip themselves when API keys or network are absent. Not required for CI.

`vitest.setup.ts` mocks `window.matchMedia` (always returns `matches: false`), `localStorage`, and `ResizeObserver` for jsdom tests.
