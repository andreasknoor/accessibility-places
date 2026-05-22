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

`check:seo` runs automatically via GitHub Actions daily at 03:00 UTC (`.github/workflows/check-seo-validity.yml`); `warm:seo` runs at 03:30 UTC (`.github/workflows/warm-seo-cache.yml`). Both support `workflow_dispatch` for manual runs. `warm:seo` appends failed URLs to `warm-failures.txt` in the repo root — this file is tracked by git and should not be deleted.

A pre-commit hook (`.githooks/pre-commit`, installed via `npm run prepare`) runs `npm test` automatically on every commit — expect commits to take ~10–20 s while tests execute.

**Always run `npm test` before committing or pushing.** No check-ins without a full test run.

## Next.js version note

This project uses **Next.js 16.2.6**, which contains breaking changes from prior versions. APIs, conventions, and file structure may differ from training-data knowledge. Before writing Next.js-specific code, read the relevant guide in `node_modules/next/dist/docs/` and heed any deprecation notices in the build output.

## Tailwind v4 note

This project uses **Tailwind CSS v4**, which differs significantly from v3. There is **no `tailwind.config.ts`** — all theme customisation lives in `app/globals.css` via `@import "tailwindcss"` and `@theme inline { … }` blocks. shadcn/ui CSS variables are defined there too and mapped into Tailwind tokens via `@theme`. Do not create a `tailwind.config.ts`; consult `app/globals.css` first when working with design tokens or adding new utilities.

## Architecture

### Search pipeline (`app/api/search/route.ts`)

The `/api/search` POST endpoint is a **streaming NDJSON** response. It emits newline-delimited JSON events as work progresses, then one final `result` event:

```
{"type":"source", "sourceId":"osm", "status":"ok", "count":18, "durationMs":1234}
{"type":"result", "payload": { places, location, … }}
```

Client reads this as a `ReadableStream` in `app/HomeClient.tsx` and updates state incrementally. `HomeClient.tsx` lives directly under `app/` (not under `components/`) — it is the root client component for the home page, managing search state, layout switching, and streaming event dispatch. The route accepts an optional `coordinates` field to bypass Nominatim geocoding (used for the "Nearby" GPS mode) and an optional `nameHint` string that is applied as a post-filter on the merged results via `filterByNameHint()`.

### Query parsing (`lib/llm.ts`)

No LLM is used at runtime (`@anthropic-ai/sdk` is an unused leftover in `package.json`). `parseQuery()` deterministically extracts `locationQuery` (for Nominatim) and `categories` (from `CATEGORY_HINTS` regex match). `extractQuotedName()` pulls text inside any quote style (straight, curly, guillemets) and is used by `ChatPanel` to populate `nameHint` when the user wraps a name in quotes. The name filter is entirely separate — it is passed as `nameHint` in the API body and applied server-side after all adapter results are merged.

### Adapters (`lib/adapters/`)

Five adapters run in parallel via `startAdapterTasks()`:
- **OSM** (`osm.ts`): Overpass query raced in parallel across 2 mirror endpoints via `Promise.any()` — first successful response wins, loser is aborted. `[timeout:12]` in QL + `AbortSignal.timeout(20_000)` client-side. 429/5xx throws immediately so the race can resolve. `AggregateError` is unwrapped to `err.errors[0]` when both fail.
- **accessibility.cloud** (`accessibility-cloud.ts`): A11yJSON-shaped records. Always uses `accessibilityPreset=at-least-partially-accessible-by-wheelchair`.
- **Reisen für Alle** (`reisen-fuer-alle.ts`): Highest reliability weight (1.0). Hidden from FilterPanel UI (not in `SOURCE_ORDER`) but always active when the key is set.
- **Ginto** (`ginto.ts`): GraphQL API (`POST https://api.ginto.guide/graphql`), Switzerland only (all results have `countryCode: "CH"`). `defaultRatings[].key` prefix convention maps to A11yValue: no prefix → entrance, `toilet_` → toilet, `parking_` → parking. Paginates up to 2 pages (100 results). Base weight 0.90; LEVEL_2 entries use 0.95, LEVEL_3 entries use 0.97 (via `qualityInfo.detailLevels`). `updatedAt` is a system republish timestamp, not a human verification date — stored in `metadata` only, never sets `verifiedRecently`.
- **Google Places** (`google-places.ts`): Lowest reliability weight (0.35); fires one POST per category. **Disabled by default** in `DEFAULT_SOURCES` (defined in `app/HomeClient.tsx`).

### Categories (`lib/config.ts`)

16 search categories, each with dedicated OSM tag mappings:

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

Only 10 of these have SEO landing pages (`SEO_CATEGORY_SLUGS` in `lib/cities.ts`); `hostel`, `apartment`, `biergarten`, `pub`, `bar`, and `ice_cream` are search-only.

### Matching & merging (`lib/matching/`)

`match.ts` – a candidate place is considered the same as an existing canonical place when a weighted score exceeds `MATCH_SCORE_THRESHOLD = 0.72`. The formula is:

```
effectiveName × 0.5 + addrScore × 0.3 + geoScore × 0.2
```

where `addrScore = streetTrigram × 0.6 + cityMatch × 0.25 + zipMatch × 0.15`. A fast reject fires when distance > 3 × `GEO_MATCH_RADIUS_M` (240 m). Name containment (one normalised name substring of the other within 80 m) raises the effective name score to ≥ 0.9.

`merge.ts` – winning `A11yValue` is determined by summed source reliability weight. Toilet confidence is boosted to 1.0 when `isDesignated` or `hasGrabBars` is true; capped at 0.9 for weaker toilet signals. The `computeFilteredConfidence()` function averages criteria that are either active or have a non-unknown value — active-but-unknown criteria are included in the denominator so that enabling `acceptUnknown` doesn't artificially inflate scores to 100%. `passesFiltersForSource(place, sourceId, filters)` answers "would this place pass if only this one source were active?" — used by `FilterPanel` to show a predictive per-source result count. Note: `seating` is an optional criterion — not all adapters populate it, so `Place.accessibility.seating` may be `undefined`.

`passesFilters` treats both `"yes"` and `"limited"` as passing for any active criterion. This is intentional: `"limited"` (eingeschränkt) means potentially usable, not inaccessible. Only `"no"` fails; `"unknown"` fails unless `acceptUnknown` is true.

`nearby-parking.ts` – post-merge enrichment controlled by the `ENABLE_NEARBY_PARKING` flag. `enrichWithNearbyParking()` upgrades `parking.value` from `"unknown"` to `"yes"` with `details.nearbyOnly = true` when a disabled-parking OSM node (capacity:disabled > 0 or parking_space=disabled) is found within `DEFAULT_MAX_NEARBY_PARKING_M = 300 m`. Deliberately does **not** add a `SourceAttribution`, so confidence and per-source filter counts are unaffected. Confidence is set to `NEARBY_PARKING_CONFIDENCE = 0.5` (lower than a direct on-site source — spatial correlation, not a tag on the venue). Map display uses a wider `NEARBY_PARKING_DISPLAY_RADIUS_M = 500 m`: parking markers are shown near any enriched result within this radius, even if slightly too far to trigger enrichment.

**`alwaysShowParking`** (`SearchFilters.alwaysShowParking`) — a **client-side display toggle only**. The server always sends the same `parkingSpots` payload: disabled-parking OSM nodes within `NEARBY_PARKING_DISPLAY_RADIUS_M` of an enriched (`nearbyOnly`) result. `HomeClient` holds these in state; `visibleParkingSpots = filters.alwaysShowParking ? parkingSpots : []` controls what reaches `MapView`. The toggle button is only shown when `hasParkingToggle` is true (enriched places or non-empty `parkingSpots`). `alwaysShowParking` is never persisted to `localStorage` (per-session only).

`buildAttribute(…, weightMultiplier)` — when `weightMultiplier > 1.0` the source gets `verifiedRecently: true`. Currently only the OSM adapter sets this (via `check_date:wheelchair` ≤ 2 years old). The `onlyVerified` filter in `SearchFilters` requires at least one attribution to carry this flag.

### Confidence weights (`lib/config.ts`)

```ts
reisen_fuer_alle:    1.00
ginto:               0.90  // LEVEL_2 entries → 0.95, LEVEL_3 → 0.97
accessibility_cloud: 0.70
osm:                 0.75
google_places:       0.35
osm_parking:         0     // stats-only; never used as a place-attribution source
osm_parking_private: 0     // stats-only; tracks parking requests won by private Overpass server
osm_parking_public:  0     // stats-only; tracks parking requests won by public mirrors
osm_private:         0     // stats-only; tracks requests won by private Overpass server
osm_public:          0     // stats-only; tracks requests won by public mirrors
nominatim:           0     // stats-only
```

`CONFIDENCE_THRESHOLDS`: `high = 0.70`, `medium = 0.40`. These map directly to the `confidenceLabel()` output — `"high"` → "Verlässlich", `"medium"` → "Mittel", below → "Unsicher".

`OSM_ENTRANCE_WEIGHT_FACTOR = 0.90` applies an extra reduction when OSM's whole-place `wheelchair=*` tag stands in for the entrance criterion specifically.

### i18n (`lib/i18n/`)

`LocaleProvider` is nested: root layout uses `"de"` as default; `app/en/layout.tsx` wraps `/en/*` in a second `LocaleProvider initialLocale="en"`. `app/en/layout.tsx` is a **Server Component** — the `document.documentElement.lang = "en"` side effect lives in `app/en/LangSetter.tsx`, a null-rendering client component that is imported by the layout. This separation is required so Next.js can resolve `generateMetadata` from EN SEO pages (client layouts break the metadata chain). All translations are typed via `lib/i18n/types.ts`. `distanceFromHere(m: number) => string` formats metres/km in the locale's style (DE: `"250 m entfernt"`, EN: `"250 m away"`).

### Mobile vs desktop

`useIsMobile()` (`hooks/useIsMobile.ts` — pointer: coarse or max-width 767px) gates layout branching in `HomeClient.tsx`. Mobile uses `MobileLayout` (tab bar: results / map / filter). Desktop has a resizable results column with a drag handle. In tests, `matchMedia` is mocked to always return `false` (desktop), so both inputs in the search bar are always rendered.

**Empty state actions** — `ResultsList` accepts an optional `onAdjustFilters?: () => void` prop. When present (mobile only), a primary "Filter anpassen" button is rendered alongside the expand-radius button; clicking it calls the callback. `MobileLayout` passes `() => setActiveTab("filter")`. When absent (desktop), a text hint is shown instead — the filter panel is already visible.

**PlaceCard interaction** — Clicking the card body opens `PlaceDebugSheet` (the place info sheet) via `createPortal`. The info sheet is a full user-facing panel: structured accessibility details, enriched metadata (hours, cuisine, ratings, dogs, etc.), external links (Wheelmap, OSM, Google Maps, website, Ginto), and a copy-link button. A separate map-pin button on the card (`onClick` prop) selects the place on the map without opening the sheet.

**Distance display** — `PlaceCard` shows inline distance (`t.results.distanceFromHere`) when `distanceM` prop is provided. `HomeClient` passes `searchCenter` to `ResultsList` **only when `chatMode === "nearby"`** — distance is intentionally not shown for text-search results.

`MapView` (`components/map/MapView.tsx`) uses Leaflet and is loaded via `dynamic(..., { ssr: false })` to prevent server-side rendering errors.

**Filter/source/radius persistence** — `HomeClient.tsx` persists the active filter criteria, source toggles, and radius to `localStorage` via lazy `useState` initialisers, so user preferences survive page reloads. `alwaysShowParking` is intentionally excluded (it is a per-session display toggle). `handleReset` restores defaults and writes them back, so the stored value self-heals on reset.

### User settings (`lib/settings.ts`)

`AppSettings` is a user-configurable set of defaults persisted to `localStorage` under key `ap_settings`. `useSettings()` returns `[settings, updateSettings]`; `loadSettings()` is called in lazy `useState` initialisers in `HomeClient` for settings that must be available before React mounts.

Fields: `defaultSearchMode` (`"text"` | `"nearby"`), `defaultMobileView` (`"results"` | `"map"`), `defaultChipIdx` (which chip is pre-selected, `null` = Restaurants), `sortOrder` (`"confidence"` | `"distance"`), `autoZoom` (MapView auto-fits after search), `alwaysShowParking` (default `false`).

**Critical invariant:** `SETTING_CHIPS` in `lib/settings.ts` and `CHIPS` in `ChatPanel.tsx` must stay in the **same order** — `defaultChipIdx` is an index into both simultaneously. Reordering chips in either file requires updating the other.

`SettingsSheet` (`components/settings/SettingsSheet.tsx`) renders via `createPortal` and is triggered from a gear icon in `HomeClient`. It receives `settings` and `onUpdate`; `HomeClient.handleUpdateSettings` applies the patch and syncs derived state (e.g. propagates `sortOrder` → `sortBy`).

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

In production, `raw` adapter response data is stripped from `sourceRecords` before the response is sent (see `stripRaw()`). In development the raw data is preserved for debugging. Adapters must also populate `SourceRecord.metadata` (a plain object mirroring the key fields from `raw`) so the info sheet can display data in production — all five adapters do this. When adding a new adapter, always set both `raw` and `metadata`.

`POST /api/log-error` — client-side error forwarding. `HomeClient` calls this fire-and-forget in its search `catch` block; the route logs via `console.error` (appears as Error in Vercel Function Logs).

`GET /api/stats?token=SECRET` — token-protected adapter usage stats (requires `KV_REST_API_URL`). `lib/stats.ts` tracks per-source call counts, error counts, and response time (min/max/avg) in Upstash Redis using hour-granularity keys (`stats:h:<metric>:<sourceId>:<YYYY-MM-DDTHH>`) with a 90-day TTL. `trackCall`, `trackError`, and `trackDuration` are called fire-and-forget from `app/api/search/route.ts` after all adapters complete — **not** from `safeRun`. This keeps `safeRun` and `fetchAllSources` side-effect-free so they can be called safely from ISR pages (a `no-store` Upstash fetch inside an ISR page would demote it to dynamic at runtime).

`GET /api/nearby-parking?lat=&lon=&radius=` — fetches disabled-parking OSM nodes within `radius` km (0.05–1.0 km, default 0.3). Exists as a standalone endpoint; parking spots for the main UI are delivered via the `result` event of `/api/search`, not this route.

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
`fetchPlacesForSeoPage(lat, lon, category, radiusKm=5)` calls `fetchAllSources` directly (no HTTP round-trip). Fetches with all filters off (`acceptUnknown: true`) and `SEO_SOURCES` (excludes Google Places). When `ENABLE_NEARBY_PARKING=1`, also fetches disabled-parking OSM nodes in parallel and runs `enrichWithNearbyParking()` before filtering. After merging, always applies `FILTERS_STRICT` (entrance=true, toilet=true, acceptUnknown=false). Recomputes `computeFilteredConfidence` using these filters, sorts descending (tiebreaker: `name.localeCompare`), returns top 25.

**Rendering — `components/seo/SeoPageContent.tsx`:**
Server component shared by DE and EN routes. Includes Schema.org `ItemList` + `BreadcrumbList` JSON-LD, hreflang language switcher, related categories (chip-backed only — `SEO_CATEGORY_TO_CHIP_IDX !== undefined` — and filtered by `hasData`), and related cities (filtered by `hasData`). The confidence badge format matches the main app exactly: `"X% · Verlässlich/Mittel/Unsicher"` via `confidenceLabel()` from `merge.ts`. Source attribution names the active adapters (`"OpenStreetMap, accessibility.cloud, Ginto (CH)"`) — exclude adapters that require keys absent in the deployment. Place cards show entrance, toilet, and parking attributes (parking is only shown when its value is not `"unknown"`); the `nearbyOnly` parking case renders as `"Ja, in der Nähe (Xm)"`. External links (Wheelmap, Google Maps, website) are icon-only (`Accessibility`, `Map`, `Globe` from lucide-react).

**Validity data — `lib/generated/seo-validity.json` + `lib/seo-validity.ts`:**
A 320-entry JSON file (`citySlug/categorySlug → boolean`) that records which combinations actually have accessible places. Updated by `npm run check:seo` (or the daily GitHub Actions cron `.github/workflows/check-seo-validity.yml`). Safety rules: failed checks never overwrite an existing `true` (Overpass downtime cannot remove confirmed pages); the file is not written if < 50% of checks succeed. `hasData(citySlug, categorySlug)` defaults to `true` for unknown combos (conservative). `VALID_SEO_PATHS` is a `Set<string>` used by both the sitemap and `SeoPageContent`.

**Sitemap — `app/sitemap.ts`:**
Filters SEO pages through `VALID_SEO_PATHS` — only confirmed combos appear in the sitemap. Adding a city to `CITIES` (and `CitySlug`) automatically includes it once the validity cron runs.

**Deep-link flow — two entry points:**

*SEO page → main app:* Each place card on an SEO page links to:
```
/?q={cityName}&cat={categorySlug}&selectLat={lat}&selectLon={lon}&selectName={name}
```
On mount, `HomeClient` auto-fires the city+category search (geocoded via Nominatim), then after results arrive selects the nearest place within 100 m via Haversine distance — setting `selectedId` and `scrollToId` to trigger highlight+scroll.

*Info sheet copy-link:* The place info sheet (`PlaceDebugSheet`) has a copy-link button that writes to the clipboard:
```
/?selectLat={lat}&selectLon={lon}&selectName={name}&cat={category}
```
No `q=` (no city name). On mount, `HomeClient` detects `selectLat`/`selectLon` without `initialCity` and fires a coordinate-centred search with **all sources enabled** (ignoring the receiver's source toggles) and `nameHint = selectName` to bypass `passesFilters` — so the linked place always appears regardless of the receiver's active filters.

`app/page.tsx` (and `app/en/page.tsx`) reads all five params and passes them as props to `HomeClient`.

### PWA / Service Worker

`app/sw.ts` + `@serwist/next`. The service worker is **disabled in development** (`disable: process.env.NODE_ENV === "development"` in `next.config.ts`).

**CSP**: `next.config.ts` defines the `Content-Security-Policy` header. **Any new external domain** — whether a new API, CDN, or map tile server — requires adding it to the appropriate directive (`connect-src` for fetch/XHR, `img-src` for images). Forgetting this causes silent failures in production.

## Versioning

`APP_VERSION` in `lib/config.ts` — bump on every meaningful release. Shown in the Impressum.

## Environment variables (server-side only)

- `ACCESSIBILITY_CLOUD_API_KEY` — optional; source is silently skipped if absent
- `REISEN_FUER_ALLE_API_KEY` — optional; source is silently skipped if absent. Request access from DSFT/Natko at reisen-fuer-alle.de (non-commercial use available on request).
- `REISEN_FUER_ALLE_API_BASE` — base URL for the RfA API (e.g. `https://api.reisen-fuer-alle.de/v1`); required alongside the key
- `GOOGLE_PLACES_API_KEY` — optional; source is silently skipped if absent
- `ENABLE_NEARBY_PARKING=1` — feature flag; enables the disabled-parking enrichment fetch in both the main `/api/search` route and SEO pages (off by default). When active, a parallel OSM fetch for disabled-parking nodes runs alongside the venue adapters and the results are used for enrichment and `parkingSpots` map markers.
- `GINTO_API_KEY` — optional; Ginto GraphQL API (Swiss accessibility data, CH only). Contact support@ginto.guide. Source silently skipped if absent.
- `HEALTH_CHECK_SECRET` — required to activate `GET /api/health` and `GET /api/stats`; requests without a matching `?token=` get 401. If unset both endpoints return 503.
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — optional; Upstash Redis credentials for adapter call/error stats. If absent, `lib/stats.ts` is a no-op and `GET /api/stats` returns 503.
- `OVERPASS_ENDPOINTS` — optional; comma-separated list of Overpass API URLs to override the two public mirrors. Multiple URLs retain the parallel-race behaviour. Production value includes the private Hetzner server first, then both public mirrors as fallback: `https://overpass.accessible-places.org/api/interpreter,https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter`.
- `NOMINATIM_ENDPOINT` — optional; base URL of a private Nominatim instance, e.g. `https://nominatim.example.com`. Trailing slash is stripped automatically. Applies to all three geocode routes and the search pipeline.

## Tests

- `__tests__/components/` — jsdom + Testing Library (includes `SeoPageContent.test.tsx` for badge format and chip-category filtering)
- `__tests__/lib/` — pure unit tests (node environment via `// @vitest-environment node` header where needed; includes `cities.test.ts` for data-integrity checks)
- `__tests__/api/` — API route unit tests (node environment, mocked `fetch`)
- `__tests__/integration/` — live network tests; skip themselves when API keys or network are absent. Not required for CI.

`vitest.setup.ts` mocks `window.matchMedia` (always returns `matches: false`), `localStorage`, and `ResizeObserver` for jsdom tests.

**Rate-limiter pitfall in `search.test.ts`:** The `/api/search` route holds a module-level in-memory sliding-window counter keyed by `x-forwarded-for` (falls back to `"unknown"`). Tests that call `POST()` without setting this header all share the `"unknown"` bucket; the 11th call in the same file returns 429 before the stream starts. Fix: set a distinct `x-forwarded-for` header on requests in test groups that run after the first ~10 POST calls in that file.

## Private Overpass server (Hetzner)

Self-hosted Overpass API for DACH at `overpass.accessible-places.org` (Caddy → Docker on Hetzner CAX21, Helsinki). Eliminates public-mirror rate limits and reduces latency from 2–15 s to ~50–200 ms.

**Server:** `65.109.1.63` — `ssh root@overpass.accessible-places.org`

**Docker container:** `overpass` — image `wiktorn/overpass-api`, data at `/overpass-data:/db`, port 8080 → Caddy → HTTPS.

**Critical Docker env vars** (wrong defaults cause failures under load):

| Variable | Production value | Why |
|---|---|---|
| `OVERPASS_RATE_LIMIT` | `32` | Default 4–8; "slots occupied" HTML at peak |
| `OVERPASS_SPACE` | `6442450944` | Default 512 MB; CAX21 has 8 GB |
| `OVERPASS_TIME` | `300` | Default 1000 s; queries use `[timeout:12]` anyway |
| `OVERPASS_ALLOW_DUPLICATE_QUERIES` | `yes` | Default `no` rejects identical concurrent queries immediately with HTML 200 — primary cause of load-test failures |

**Restart command** (e.g. after config change):
```bash
docker stop overpass && docker rm overpass
docker run -d --name overpass --restart always -p 8080:80 \
  -v /overpass-data:/db \
  -e OVERPASS_META=yes \
  -e OVERPASS_MODE=clone \
  -e OVERPASS_REPLICATION_URL=https://download.geofabrik.de/europe/dach-updates/ \
  -e OVERPASS_REPLICATION_DELAY=3600 \
  -e OVERPASS_USE_AREAS=true \
  -e OVERPASS_RULES_LOAD=1 \
  -e OVERPASS_ALLOW_DUPLICATE_QUERIES=yes \
  -e OVERPASS_RATE_LIMIT=32 \
  -e OVERPASS_SPACE=6442450944 \
  -e OVERPASS_TIME=300 \
  wiktorn/overpass-api
```

**Overpass HTML 200 responses:** when the daemon is overloaded it returns `Content-Type: text/html` with HTTP 200 (not 5xx). The OSM adapter guard (`res.headers?.get("content-type")`) detects this and rejects the endpoint so the parallel race falls through to the public mirrors.
