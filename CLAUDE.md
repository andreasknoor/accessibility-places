# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # dev server (Turbopack)
npm run build        # production build
npm run start        # serve the built production output
npm run lint         # ESLint
npm test             # run all tests once (required before every commit/push)
npm run test:watch   # watch mode

# Run a single test file
npx vitest run __tests__/lib/llm.test.ts

# Update SEO validity data (which city/category combos have actual data)
npm run check:seo

# Prime the ISR cache for all SEO pages (run after deploying new city/category combos)
npm run warm:seo
```

A pre-commit hook (`.githooks/pre-commit`, installed via `npm run prepare`) runs `npm test` automatically on every commit — expect commits to take ~10–20 s while tests execute.

**Always run `npm test` before committing or pushing.** No check-ins without a full test run.

## Next.js version note

This project uses **Next.js 16.2.4**, which contains breaking changes from prior versions. APIs, conventions, and file structure may differ from training-data knowledge. Before writing Next.js-specific code, read the relevant guide in `node_modules/next/dist/docs/` and heed any deprecation notices in the build output.

## Architecture

### Search pipeline (`app/api/search/route.ts`)

The `/api/search` POST endpoint is a **streaming NDJSON** response. It emits newline-delimited JSON events as work progresses, then one final `result` event:

```
{"type":"source", "sourceId":"osm", "status":"ok", "count":18, "durationMs":1234}
{"type":"result", "payload": { places, location, … }}
```

Client reads this as a `ReadableStream` in `HomeClient.tsx` and updates state incrementally. The route accepts an optional `coordinates` field to bypass Nominatim geocoding (used for the "Nearby" GPS mode) and an optional `nameHint` string that is applied as a post-filter on the merged results via `filterByNameHint()`.

### Query parsing (`lib/llm.ts`)

No LLM is used at runtime (`@anthropic-ai/sdk` is an unused leftover in `package.json`). `parseQuery()` deterministically extracts `locationQuery` (for Nominatim) and `categories` (from `CATEGORY_HINTS` regex match). `extractQuotedName()` pulls text inside any quote style (straight, curly, guillemets) and is used by `ChatPanel` to populate `nameHint` when the user wraps a name in quotes. The name filter is entirely separate — it is passed as `nameHint` in the API body and applied server-side after all adapter results are merged.

### Adapters (`lib/adapters/`)

Five adapters run in parallel via `startAdapterTasks()`:
- **OSM** (`osm.ts`): Overpass query raced in parallel across 2 mirror endpoints via `Promise.any()` — first successful response wins, loser is aborted. `[timeout:12]` in QL + `AbortSignal.timeout(20_000)` client-side. 429/5xx throws immediately so the race can resolve. `AggregateError` is unwrapped to `err.errors[0]` when both fail.
- **accessibility.cloud** (`accessibility-cloud.ts`): A11yJSON-shaped records. Always uses `accessibilityPreset=at-least-partially-accessible-by-wheelchair`.
- **Reisen für Alle** (`reisen-fuer-alle.ts`): Highest reliability weight (1.0). Hidden from FilterPanel UI (not in `SOURCE_ORDER`) but always active when the key is set.
- **Ginto** (`ginto.ts`): GraphQL API (`POST https://api.ginto.guide/graphql`), Switzerland only (all results have `countryCode: "CH"`). `defaultRatings[].key` prefix convention maps to A11yValue: no prefix → entrance, `toilet_` → toilet, `parking_` → parking. Paginates up to 2 pages (100 results). Base weight 0.90; LEVEL_2 entries use 0.95, LEVEL_3 entries use 0.97 (via `qualityInfo.detailLevels`). `updatedAt` is a system republish timestamp, not a human verification date — stored in `metadata` only, never sets `verifiedRecently`.
- **Google Places** (`google-places.ts`): Lowest reliability weight (0.35); fires one POST per category. **Disabled by default** in `DEFAULT_SOURCES`.

### Matching & merging (`lib/matching/`)

`match.ts` – a candidate place is considered the same as an existing canonical place when a weighted score exceeds `MATCH_SCORE_THRESHOLD = 0.72`. The formula is:

```
effectiveName × 0.5 + addrScore × 0.3 + geoScore × 0.2
```

where `addrScore = streetTrigram × 0.6 + cityMatch × 0.25 + zipMatch × 0.15`. A fast reject fires when distance > 3 × `GEO_MATCH_RADIUS_M` (240 m). Name containment (one normalised name substring of the other within 80 m) raises the effective name score to ≥ 0.9.

`merge.ts` – winning `A11yValue` is determined by summed source reliability weight. Toilet confidence is boosted to 1.0 when `isDesignated` or `hasGrabBars` is true; capped at 0.9 for weaker toilet signals. The `computeFilteredConfidence()` function averages **only the criteria the user has active**, so deactivating parking doesn't drag down scores. `passesFiltersForSource(place, sourceId, filters)` answers "would this place pass if only this one source were active?" — used by `FilterPanel` to show a predictive per-source result count. Note: `seating` is an optional criterion — not all adapters populate it, so `Place.accessibility.seating` may be `undefined`.

`passesFilters` treats both `"yes"` and `"limited"` as passing for any active criterion. This is intentional: `"limited"` (eingeschränkt) means potentially usable, not inaccessible. Only `"no"` fails; `"unknown"` fails unless `acceptUnknown` is true.

`nearby-parking.ts` – post-merge enrichment controlled by the `ENABLE_NEARBY_PARKING` flag. `enrichWithNearbyParking()` upgrades `parking.value` from `"unknown"` to `"yes"` with `details.nearbyOnly = true` when a disabled-parking OSM node (capacity:disabled > 0 or parking_space=disabled) is found within 150 m (`DEFAULT_MAX_NEARBY_PARKING_M`). Deliberately does **not** add a `SourceAttribution`, so confidence and per-source filter counts are unaffected.

`buildAttribute(…, weightMultiplier)` — when `weightMultiplier > 1.0` the source gets `verifiedRecently: true`. Currently only the OSM adapter sets this (via `check_date:wheelchair` ≤ 2 years old). The `onlyVerified` filter in `SearchFilters` requires at least one attribution to carry this flag.

### Confidence weights (`lib/config.ts`)

```ts
reisen_fuer_alle:    1.00
ginto:               0.90  // LEVEL_2 entries → 0.95, LEVEL_3 → 0.97
accessibility_cloud: 0.70
osm:                 0.75
google_places:       0.35
```

`OSM_ENTRANCE_WEIGHT_FACTOR = 0.90` applies an extra reduction when OSM's whole-place `wheelchair=*` tag stands in for the entrance criterion specifically.

### i18n (`lib/i18n/`)

`LocaleProvider` is nested: root layout uses `"de"` as default; `app/en/layout.tsx` wraps `/en/*` in a second `LocaleProvider initialLocale="en"`. `app/en/layout.tsx` is a **Server Component** — the `document.documentElement.lang = "en"` side effect lives in `app/en/LangSetter.tsx`, a null-rendering client component that is imported by the layout. This separation is required so Next.js can resolve `generateMetadata` from EN SEO pages (client layouts break the metadata chain). All translations are typed via `lib/i18n/types.ts`. `distanceFromHere(m: number) => string` formats metres/km in the locale's style (DE: `"250 m entfernt"`, EN: `"250 m away"`).

### Mobile vs desktop

`useIsMobile()` (`hooks/useIsMobile.ts` — pointer: coarse or max-width 767px) gates layout branching in `HomeClient.tsx`. Mobile uses `MobileLayout` (tab bar: results / map / filter). Desktop has a resizable results column with a drag handle. In tests, `matchMedia` is mocked to always return `false` (desktop), so both inputs in the search bar are always rendered.

**Empty state actions** — `ResultsList` accepts an optional `onAdjustFilters?: () => void` prop. When present (mobile only), a primary "Filter anpassen" button is rendered alongside the expand-radius button; clicking it calls the callback. `MobileLayout` passes `() => setActiveTab("filter")`. When absent (desktop), a text hint is shown instead — the filter panel is already visible.

**Distance display** — `PlaceCard` shows inline distance (`t.results.distanceFromHere`) when `distanceM` prop is provided. `HomeClient` passes `searchCenter` to `ResultsList` **only when `chatMode === "nearby"`** — distance is intentionally not shown for text-search results.

`MapView` (`components/map/MapView.tsx`) uses Leaflet and is loaded via `dynamic(..., { ssr: false })` to prevent server-side rendering errors.

### Name filter (ChatPanel → API)

The name field is a separate input, **not** embedded in the query string. `ChatPanel.onSearch` signature: `(query: string, coords?: Coords, nameHint?: string)`. The `nameHint` is passed in the API request body and applied as a JS post-filter (`filterByNameHint` — substring + trigram ≥ 0.6) after the merge step. This means accessibility filters apply independently of name searches.

### Supplementary Place fields

`Place` carries optional fields that adapters populate beyond wheelchair data:

- `allowsDogs` / `dogPolicyOnly` — sourced from supplementary A.Cloud datasets (e.g. Pfotenpiloten). Records that arrive as `dogPolicyOnly: true` are dropped by the search route **unless** they merge with a place that has real wheelchair data. Once merged the flag is cleared (`undefined`).
- `isVegetarianFriendly` / `isVeganFriendly` — from OSM `diet:vegetarian|vegan=yes/only` or Google Places types `vegetarian_restaurant` / `vegan_restaurant`. `vegan=true` implies `vegetarian=true` (set automatically during merge).
- `wheelmapUrl` — authoritative Wheelmap.org URL from `accessibility.cloud`'s `infoPageUrl`; preferred over a constructed link.
- `gintoUrl` — Ginto detail page URL from `publication.linkUrl`; shown as ShieldCheck icon in PlaceCard when present.

### Geocoding API routes

Three proxy routes forward to external geocoding services (all restricted to DACH):
- `GET /api/geocode?q=` — Nominatim forward geocoding; returns `{ lat, lon, displayName }`.
- `GET /api/geocode/suggest?q=&lang=` — Photon/Komoot autocomplete (bbox: DE+AT+CH); returns `[{ display, name }]`.
- `GET /api/geocode/reverse?lat=&lon=` — Nominatim reverse geocoding; returns `{ district }` for the "Nearby" label.

The `countrycodes=de,at,ch` constraint in Nominatim calls and the Photon bounding box must both be updated when expanding beyond DACH.

### Rate limiting & production details

`/api/search` applies in-memory sliding-window rate limits per IP: 10 searches/min general, 3/min for Google Places. These reset on serverless cold start — not suitable for multi-instance without a shared store.

In production, `raw` adapter response data is stripped from `sourceRecords` before the response is sent (see `stripRaw()`). In development the raw data is preserved for debugging. Adapters can populate `SourceRecord.metadata` (a plain object) for key fields that should survive `stripRaw()` and remain visible in the debug sheet in production — currently only the Ginto adapter does this.

`POST /api/log-error` — client-side error forwarding. `HomeClient` calls this fire-and-forget in its search `catch` block; the route logs via `console.error` (appears as Error in Vercel Function Logs).

`GET /api/health?token=SECRET` — token-protected E2E health check. Live mode runs a real OSM search (Cafés, Berlin Mitte, entrance + toilet filter). Mock mode (`?mock=1`) runs fixture data through the real pipeline without external calls — suitable for load testing. Google Places is hardcoded off. Ginto is hardcoded off (CH-only, separate concern). Returns 200/503 with structured JSON.

### Local SEO pages (`app/[city]/[category]/` and `app/en/[city]/[category]/`)

ISR landing pages for 32 DACH cities × 10 categories × 2 locales = **640 pages** total. `generateStaticParams` pre-renders all combinations at build time; `dynamicParams = false` returns 404 for unknown slugs. The DE route uses `export const revalidate = 432000` (5 days); the EN route uses `Math.round(5.5 * 24 * 3600)` (5.5 days) to stagger revalidation across locales. Data is fetched live at render time via `fetchPlacesForSeoPage(...).catch(() => [])` — if the fetch fails the page renders with an empty list rather than erroring, and the ISR stale copy is served until the next successful revalidation.

**City/category configuration — `lib/cities.ts`:**
- `CITIES` — 32 cities with slug, nameDe, nameEn, country, lat, lon. `CitySlug` union type must be kept in sync with this array.
- `SEO_CATEGORY_SLUGS` — URL slug → `Category` type (e.g. `"fast-food"` → `"fast_food"`). `SEO_CATEGORY_TO_SLUG` is the reverse.
- `SEO_CATEGORY_TO_CHIP_IDX` — slug → CHIPS array index in ChatPanel (all 10 SEO categories have a chip equivalent). The "Related categories" section on SEO pages **only shows chip-backed categories** — both for UX consistency and because those categories have a pre-select chip when the user lands on the main app.
- `SEO_CATEGORY_QUERY_TERM` — slug → `{ de, en }` query string recognisable by `parseQuery()`. Used for the auto-search trigger on the home page.
- `SEO_CATEGORY_LABEL` — plural display labels used in page headings and navigation chips.
- `CITY_MAP` — `Map<CitySlug, City>` for O(1) lookup in page routes.

**Data fetching — `lib/seo-search.ts`:**
`fetchPlacesForSeoPage(lat, lon, category, radiusKm=5)` calls `fetchAllSources` directly (no HTTP round-trip). Fetches with all filters off (`acceptUnknown: true`) and `SEO_SOURCES` (excludes Google Places). After merging, always applies `FILTERS_STRICT` (entrance=true, toilet=true, acceptUnknown=false). Recomputes `computeFilteredConfidence` using these filters, sorts descending, returns top 25.

**Rendering — `components/seo/SeoPageContent.tsx`:**
Server component shared by DE and EN routes. Includes Schema.org `ItemList` + `BreadcrumbList` JSON-LD, hreflang language switcher, related categories (chip-backed only — `SEO_CATEGORY_TO_CHIP_IDX !== undefined` — and filtered by `hasData`), and related cities (filtered by `hasData`). The confidence badge format matches the main app exactly: `"X% · Verlässlich/Mittel/Unsicher"` via `confidenceLabel()` from `merge.ts`. Source attribution names the active adapters (`"OpenStreetMap, accessibility.cloud, Ginto (CH)"`) — exclude adapters that require keys absent in the deployment.

**Validity data — `lib/generated/seo-validity.json` + `lib/seo-validity.ts`:**
A 320-entry JSON file (`citySlug/categorySlug → boolean`) that records which combinations actually have accessible places. Updated by `npm run check:seo` (or the daily GitHub Actions cron `.github/workflows/check-seo-validity.yml`). Safety rules: failed checks never overwrite an existing `true` (Overpass downtime cannot remove confirmed pages); the file is not written if < 50% of checks succeed. `hasData(citySlug, categorySlug)` defaults to `true` for unknown combos (conservative). `VALID_SEO_PATHS` is a `Set<string>` used by both the sitemap and `SeoPageContent`.

**Sitemap — `app/sitemap.ts`:**
Filters SEO pages through `VALID_SEO_PATHS` — only confirmed combos appear in the sitemap. Adding a city to `CITIES` (and `CitySlug`) automatically includes it once the validity cron runs.

**Deep-link flow (SEO page → main app):**
Each place card on an SEO page links to:
```
/?q={cityName}&cat={categorySlug}&selectLat={lat}&selectLon={lon}&selectName={name}
```
`app/page.tsx` (and `app/en/page.tsx`) reads these params and passes them as props to `HomeClient`. On mount, `HomeClient` auto-fires the city+category search, then after results arrive it selects the nearest place within 100 m via Haversine distance (`haversineMetres` from `lib/matching/match.ts`) — setting `selectedId` and `scrollToId` to trigger the same highlight+scroll behaviour as clicking a map marker.

### PWA / Service Worker

`app/sw.ts` + `@serwist/next`. The service worker is **disabled in development** (`disable: process.env.NODE_ENV === "development"` in `next.config.ts`). Adding new external domains also requires updating the `connect-src` allowlist in the CSP headers defined in `next.config.ts`.

## Versioning

`APP_VERSION` in `lib/config.ts` — bump on every meaningful release. Shown in the Impressum.

## Environment variables (server-side only)

- `ACCESSIBILITY_CLOUD_API_KEY` — optional; source is silently skipped if absent
- `REISEN_FUER_ALLE_API_KEY` — optional; source is silently skipped if absent. Request access from DSFT/Natko at reisen-fuer-alle.de (non-commercial use available on request).
- `REISEN_FUER_ALLE_API_BASE` — base URL for the RfA API (e.g. `https://api.reisen-fuer-alle.de/v1`); required alongside the key
- `GOOGLE_PLACES_API_KEY` — optional; source is silently skipped if absent
- `ENABLE_NEARBY_PARKING=1` — feature flag; enables the optional disabled-parking enrichment fetch (off by default)
- `GINTO_API_KEY` — optional; Ginto GraphQL API (Swiss accessibility data, CH only). Contact support@ginto.guide. Source silently skipped if absent.
- `HEALTH_CHECK_SECRET` — required to activate `GET /api/health`; requests without a matching `?token=` get 401. If unset the endpoint returns 503.

## Tests

- `__tests__/components/` — jsdom + Testing Library (includes `SeoPageContent.test.tsx` for badge format and chip-category filtering)
- `__tests__/lib/` — pure unit tests (node environment via `// @vitest-environment node` header where needed; includes `cities.test.ts` for data-integrity checks)
- `__tests__/api/` — API route unit tests (node environment, mocked `fetch`)
- `__tests__/integration/` — live network tests; skip themselves when API keys or network are absent. Not required for CI.

`vitest.setup.ts` mocks `window.matchMedia` (always returns `matches: false`), `localStorage`, and `ResizeObserver` for jsdom tests.
