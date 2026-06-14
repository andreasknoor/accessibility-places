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

# Compare result counts / latency between Overpass endpoints (useful when diagnosing private vs public mirror divergence)
node scripts/compare-overpass-parking.mjs
```

`check:seo` runs automatically via GitHub Actions daily at 03:00 UTC (`.github/workflows/check-seo-validity.yml`); `warm:seo` runs at 03:30 UTC (`.github/workflows/warm-seo-cache.yml`). Both support `workflow_dispatch` for manual runs. `warm:seo` appends failed URLs to `warm-failures.txt` in the repo root — this file is in `.gitignore` (local only, not tracked).

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

No LLM is used at runtime (despite the name, `lib/llm.ts` does no model inference). `parseQuery()` deterministically extracts `locationQuery` (for Nominatim) and `categories` (from `CATEGORY_HINTS` regex match). **Categories are inferred only from the part before the first `"in"`** — city names must not trigger category hints (the city "Essen" matches the restaurant hint "essen"); a query without `"in"` is scanned as a whole. No hint match → all 28 categories (the all-categories default; the UI sends `"in <location>"` for known-pure locations). `extractQuotedName()` pulls text inside any quote style (straight, curly, guillemets) and is used by `ChatPanel` to populate `nameHint` when the user wraps a name in quotes (`"Vapiano" in Berlin`). The name filter is entirely separate — it is passed as `nameHint` in the API body and applied server-side after all adapter results are merged.

### Adapters (`lib/adapters/`)

Five adapters run in parallel via `startAdapterTasks()`:
- **OSM** (`osm.ts`): Overpass query raced in parallel across 2 mirror endpoints via `Promise.any()` — first successful response wins, loser is aborted. `[timeout:12]` in QL + `AbortSignal.timeout(20_000)` client-side. 429/5xx throws immediately so the race can resolve. `AggregateError` is unwrapped to `err.errors[0]` when both fail.
- **accessibility.cloud** (`accessibility-cloud.ts`): A11yJSON-shaped records. Always uses `accessibilityPreset=at-least-partially-accessible-by-wheelchair`.
- **Reisen für Alle** (`reisen-fuer-alle.ts`): Highest reliability weight (1.0). Hidden from FilterPanel UI (not in `SOURCE_ORDER`) but always active when the key is set.
- **Ginto** (`ginto.ts`): GraphQL API (`POST https://api.ginto.guide/graphql`). Data is Switzerland-focused but with scattered entries across DACH; queried for every search by default. `GINTO_GEOFENCE=1` re-enables the CH bounding-box fence (skips calls whose search circle cannot reach CH) as an emergency brake against rate limits. `position.countryCode` is normalised ISO-3→ISO-2 (`AUT`→`AT` etc.; empty→`CH`). `defaultRatings[].key` prefix convention maps to A11yValue: no prefix → entrance, `toilet_` → toilet, `parking_` → parking. Paginates up to 2 pages (100 results). Base weight 0.90; SELF_DECLARED entries use 0.94, AUDITED entries use 1.0 (via `qualityInfo.approvalLevels` — who vouches for the data: operator vs. external authority). `qualityInfo.detailLevels` measures data completeness, not trustworthiness — stored in `metadata` only, never affects the weight. `updatedAt` is a system republish timestamp, not a human verification date — stored in `metadata` only, never sets `verifiedRecently`. AUDITED also does not set `verifiedRecently` (no audit date in the API).
- **Google Places** (`google-places.ts`): Lowest reliability weight (0.35); fires one POST per category, capped at `GOOGLE_MAX_CATEGORIES = 3` so an all-categories search cannot fan out one upstream call per category. **Disabled by default** in `DEFAULT_SOURCES` (defined in `app/HomeClient.tsx`).

### Categories (`lib/config.ts`, `lib/types.ts`)

28 search categories (the `Category` union in `lib/types.ts`). Each maps to OSM tags in `CATEGORY_OSM_TAGS` — a `{ amenity?, tourism?, shop? }` record. The `shop` dimension was added for the everyday categories (`chemist`/`supermarket`/`bakery`/`hairdresser`); the OSM query builder in `osm.ts` collects all three dimensions into separate clauses. The 12 everyday categories (pharmacy, doctors, dentist, veterinary, hospital, chemist, supermarket, bakery, hairdresser, bank, post_office, zoo) were added in v4.29.

**Adding a category touches many files in lockstep:** the `Category` union (`lib/types.ts`), `CATEGORY_OSM_TAGS` (`lib/config.ts`), every adapter's category mapper (`lib/adapters/*`), `ALL_CATEGORIES` + `CATEGORY_HINTS` (`lib/llm.ts`), the `categories` i18n block (`lib/i18n/*`), and `CATEGORY_ICONS` (`lib/category-icons.ts`). A missing adapter entry is a TypeScript error (the maps are `Record<Category, …>`), so the build catches most omissions.

`lib/category-icons.ts` exports the shared `CATEGORY_ICONS` emoji map (one entry per category), used in the `PlaceCard` header, the map popup, the `PlaceDebugSheet` header, **and** the map pin-marker glyph. Each of those three views also shows the localised category label (`t.categories[place.category]`) near the top.

Only 10 categories have SEO landing pages (`SEO_CATEGORY_SLUGS` in `lib/cities.ts`): cafe, restaurant, bar, pub, biergarten, hotel, museum, theater, cinema, attraction. The other 18 are search-only — the `[city]/[category]` route 404s any non-SEO slug.

### Matching & merging (`lib/matching/`)

`match.ts` dedupes candidates against canonical places via a weighted score (`MATCH_SCORE_THRESHOLD = 0.72`); `merge.ts` resolves the winning `A11yValue` by summed source weight and computes filtered confidence; `nearby-parking.ts` does post-merge disabled-parking enrichment. **`passesFilters` treats both `"yes"` and `"limited"` as passing; only `"no"` fails (`"unknown"` fails unless `acceptUnknown`).** Full formulas, the `parkingNearby` sub-toggle, and `passesFiltersForSource` → **[docs/architecture/matching.md](docs/architecture/matching.md)**.

### Amenities: parking + WC (`lib/amenities/`, `osm.ts`, `nearby-parking.ts`)

Disabled parking and wheelchair WCs are modelled as **typed point features** (`AmenityFeature`), not place attributes. Parking enriches a venue's `parking.value`; **WCs never enrich** `toilet.value`. Two display systems: a passive map layer (from `/api/search`) and single-select **focus mode** (from `/api/nearby-parking`). **Popup XSS rule: any OSM-sourced string in a map popup must be wrapped in `esc()`** (OSM is publicly editable; i18n strings and numbers are trusted). Tiers, host colours, dedup/payload-cap, and focus-mode state → **[docs/architecture/amenities.md](docs/architecture/amenities.md)**.

### Confidence weights (`lib/config.ts`)

Reliability weights live in `SOURCE_RELIABILITY` (`reisen_fuer_alle 1.0` > `ginto 0.90` > `osm 0.75` > `accessibility_cloud 0.70` > `google_places 0.35`). Ginto refines per-entry: SELF_DECLARED → 0.94, AUDITED → 1.0. The `osm_*`/`nominatim` entries are weight `0` (stats-only, never place attributions). `CONFIDENCE_THRESHOLDS`: `high = 0.70`, `medium = 0.40` → `confidenceLabel()` "Verlässlich" / "Mittel" / "Unsicher".

`OSM_ENTRANCE_WEIGHT_FACTOR = 0.90` applies an extra reduction when OSM's whole-place `wheelchair=*` tag stands in for the entrance criterion specifically.

### i18n (`lib/i18n/`)

`LocaleProvider` is nested: root layout uses `"de"` as default; `app/en/layout.tsx` wraps `/en/*` in a second `LocaleProvider initialLocale="en"`. `app/en/layout.tsx` is a **Server Component** — the `document.documentElement.lang = "en"` side effect lives in `app/en/LangSetter.tsx`, a null-rendering client component that is imported by the layout. This separation is required so Next.js can resolve `generateMetadata` from EN SEO pages (client layouts break the metadata chain). All translations are typed via `lib/i18n/types.ts`. `distanceFromHere(m: number) => string` formats metres/km in the locale's style (DE: `"250 m entfernt"`, EN: `"250 m away"`).

### Mobile vs desktop

`useIsMobile()` (`hooks/useIsMobile.ts` — pointer: coarse or max-width 767px) gates layout branching in `HomeClient.tsx`. Mobile uses `MobileLayout` (tab bar: results / map / filter). Desktop has a resizable results column with a drag handle. In tests, `matchMedia` is mocked to always return `false` (desktop).

**Empty state actions** — `ResultsList` accepts an optional `onAdjustFilters?: () => void` prop. When present (mobile only), a primary "Filter anpassen" button is rendered alongside the expand-radius button; clicking it calls the callback. `MobileLayout` passes `() => setActiveTab("filter")`. When absent (desktop), a text hint is shown instead — the filter panel is already visible.

**PlaceCard interaction** — Clicking the card body opens `PlaceDebugSheet` (the place info sheet) via `createPortal`. The info sheet is a full user-facing panel: structured accessibility details, enriched metadata (hours, cuisine, ratings, dogs, etc.), external links (Wheelmap, OSM, Google Maps, website, Ginto), and a copy-link button. A separate map-pin button on the card (`onClick` prop) selects the place on the map without opening the sheet.

**Distance display** — `PlaceCard` shows inline distance (`t.results.distanceFromHere`) when `distanceM` prop is provided. `HomeClient` passes `searchCenter` to `ResultsList` **only when `chatMode === "nearby"`** — distance is intentionally not shown for text-search results.

`MapView` (`components/map/MapView.tsx`) uses Leaflet and is loaded via `dynamic(..., { ssr: false })` to prevent server-side rendering errors.

**Place pin markers** — each result renders as a teardrop pin (`svgMarker`) whose circular head is filled with the confidence colour (green/amber/red) and shows the category emoji from `CATEGORY_ICONS`; the tip is anchored exactly on the coordinate. Selected markers scale up. This replaced the uniform ♿ circle once the app grew to 28 categories — a single wheelchair glyph no longer disambiguated venue type.

**Marker clustering** — place markers are grouped via `leaflet.markercluster`. `PLACE_CLUSTER_MAX_RADIUS = 50 px` controls grouping radius; clustering is disabled at zoom ≥ `PLACE_CLUSTER_DISABLE_AT_ZOOM = 17` (street level, every pin always visible). Cluster icons use the same confidence-colour scheme as individual pins and are styled with custom CSS classes (`ap-cluster`, `ap-cluster-sm/md/lg`). The default Leaflet.markercluster theme is replaced entirely — do not import its default CSS.

**"Search here" detection invariant** — the floating "Hier suchen" button (`onSearchHere`) re-runs the last venue search at the panned map centre. MapView tells a user pan from an app-driven move purely by **time window**: every programmatic `setView`/`fitBounds`/`zoomToShowLayer` must set `lastProgrammaticMoveRef.current = Date.now()` immediately before the call, and the `moveend` handler ignores any move within `PROGRAMMATIC_MOVE_WINDOW_MS` (700 ms) of that stamp (`zoomToShowLayer` re-stamps inside its `openPopup` callback to cover autoPan). A programmatic move that forgets to stamp surfaces a spurious button; the earlier counter-based approach desynced and suppressed the button entirely (v4.35 → v4.36). The button is hidden in amenity focus mode (`focusModeRef` guard in `moveend` + `!focusMode` JSX gate), where re-running the venue search would silently drop the parking/WC layers. `onSearchHere` must be wired in **both** `HomeClient` (desktop) **and** `MobileLayout` — a missing prop makes the feature work locally but vanish when deployed.

**MapView effect ordering invariant** — two `useEffect`s in `MapView.tsx` must not race when a "show on map" button switches the mobile tab and sets `selectedId` in the same render: the *selection effect* (`deps: [selectedId, panTrigger, mapReady]`) runs `zoomToShowLayer` + `openPopup`, while the *visibility effect* (`deps: [visible, isFullscreen]`) runs a `setTimeout(50 ms)` that calls `fitBounds` on all results. The visibility effect checks `selectedId` first and returns early (showing the selected marker instead) so it never overwrites the selection zoom. Do not remove or reorder that guard — the symptom is the popup flashing briefly then vanishing as the map zooms back out to show all results.

**CSS stacking context invariant**: the desktop map container div has `isolation: isolate` (`<div className="flex-1 min-h-0 relative isolate">`). Leaflet injects pane z-indexes of 200–700 directly; without isolation these leak into the page stacking context and paint over ChatPanel (`z-20`), hiding autocomplete dropdowns. `isolate` traps all Leaflet z-indexes inside the map container. Do not remove it.

**Filter/source/radius persistence** — `HomeClient.tsx` persists the active filter criteria, source toggles, and radius to `localStorage` via a `useEffect` (guarded by `prefsLoadedRef` so the initial load effect fires first and the persist effect never overwrites saved prefs with defaults). `alwaysShowParking` and `alwaysShowToilets` are intentionally excluded from the filter-prefs key — they are persisted separately via `AppSettings`. `handleReset` restores defaults and writes them back, so the stored value self-heals on reset.

**Welcome / onboarding screen** — first-time visitors see a welcome screen instead of the normal UI. Controlled by `isFirstVisit` in `HomeClient`, initialised lazily: `true` when neither `ap_visited` nor `ap_welcome_dismissed` is set in `localStorage`. Dismissing via "Nicht mehr anzeigen" sets `ap_welcome_dismissed` and optionally triggers a nearby GPS search. The normal `ap_visited` key is set on any regular search. Both keys can be cleared via `onResetOnboarding` in `SettingsSheet` (gear icon → Reset → reset onboarding). The welcome UI lives inside `MobileLayout` and `ChatPanel`, not in a dedicated component.

### User settings (`lib/settings.ts`)

`AppSettings` is a user-configurable set of defaults persisted to `localStorage` under key `ap_settings`. `useSettings()` returns `[settings, updateSettings]`; `loadSettings()` is called in lazy `useState` initialisers in `HomeClient` for settings that must be available before React mounts.

Fields: `defaultSearchMode` (`"text"` | `"nearby"` | `null` = no preference; legacy `"place"` is migrated to `"text"` on load), `defaultMobileView` (`"results"` | `"map"`), `defaultChipIdx` (which chip is pre-selected, `null` = "Alle"/all categories — the app default), `sortOrder` (`"confidence"` | `"distance"`), `autoZoom` (MapView auto-fits after search), `alwaysShowParking` / `alwaysShowToilets` (passive map-layer display toggles, default `false`; persisted here, **not** in the filter-prefs key, and excluded from it in `HomeClient`), `showWeakParking` (show the weak parking tier as amber markers, incl. in focus mode; default `false`), `publicToiletsOnly` (restrict the WC layer to standalone public toilets, hiding venue WCs; default `false`), `parkingRadiusKm` (radius for the amenity focus fetch — parking **and** WC — 0.05–5.0, default 4.0).

**Critical invariant:** `SETTING_CHIPS` in `lib/settings.ts` and `CHIPS` in `ChatPanel.tsx` must stay in the **same order** — `defaultChipIdx` is an index into both simultaneously. Reordering chips in either file requires updating the other (the SEO deep-link table `SEO_CATEGORY_TO_CHIP_IDX` in `lib/cities.ts` also hard-codes these indices). The "Alle" chip in the UI is a pseudo-chip rendered before `CHIPS` (state `selectedIdx === null`), **not** part of either array. The chip strip renders in **both** text and nearby modes and is hidden only during amenity focus.

`SettingsSheet` (`components/settings/SettingsSheet.tsx`) renders via `createPortal` and is triggered from a gear icon in `HomeClient`. It receives `settings` and `onUpdate`; `HomeClient.handleUpdateSettings` applies the patch and syncs derived state (e.g. propagates `sortOrder` → `sortBy`).

### Unified search field & place search (ChatPanel → API)

Explore mode has **one search input** backed by `/api/geocode/unified-suggest`; the dropdown groups results into **areas** (→ `onSearch`, category search) and **venues** (→ `onPlaceSearch(name, coords)`, place search). The selection commits the intent — Enter on raw free text always runs an area search. A name *filter* is expressed via quote syntax (`"Vapiano" in Berlin` → `nameHint`, applied as a post-merge JS filter `filterByNameHint`, so accessibility filters apply independently). **Place-search mode** (`placeSearch: true` on `SearchParams`) looks up a specific venue, with the OSM adapter switching to a name-regex Overpass query (capped 0.5 km). The `handlePlaceSearch` resolution chain, `place_not_found` vs `place_no_data` states, and the `programmaticLocRef` suppression pattern → **[docs/architecture/place-search.md](docs/architecture/place-search.md)**.

### Supplementary Place fields

`Place` carries optional fields that adapters populate beyond wheelchair data:

- `allowsDogs` / `dogPolicyOnly` — sourced from supplementary A.Cloud datasets (e.g. Pfotenpiloten). Records that arrive as `dogPolicyOnly: true` are dropped by the search route **unless** they merge with a place that has real wheelchair data. Once merged the flag is cleared (`undefined`).
- `isVegetarianFriendly` / `isVeganFriendly` — from OSM `diet:vegetarian|vegan=yes/only` or Google Places types `vegetarian_restaurant` / `vegan_restaurant`. `vegan=true` implies `vegetarian=true` (set automatically during merge).
- `wheelmapUrl` — authoritative Wheelmap.org URL from `accessibility.cloud`'s `infoPageUrl`; preferred over a constructed link.
- `gintoUrl` — Ginto detail page URL from `publication.linkUrl`; shown as ShieldCheck icon in PlaceCard when present.

### Geocoding API routes

Proxy routes forward to external geocoding services (all restricted to DACH):
- `GET /api/geocode?q=` — Nominatim forward geocoding; returns `{ lat, lon, displayName }`. Accepts optional `?lat=&lon=` to bias results via a ±0.2° viewbox (`bounded=0` so it falls back globally).
- `GET /api/geocode/unified-suggest?q=&lang=` — **the active autocomplete route**: one Photon call without layer restriction, classified into `kind: "area" | "venue"` via `osm_key`/`type` (streets excluded); returns max 3 areas + 5 venues, areas first. Accepts optional `?lat=&lon=` bias (validated, forwarded to Photon). Photon often omits `countrycode` for POIs — the filter is `if (cc && !DACH_CODES.has(cc))` (only hard-exclude explicit non-DACH), trusting the bbox for geographic containment.
- `GET /api/geocode/suggest?q=&lang=` and `GET /api/geocode/place-suggest?q=&lang=` — the legacy area-only / POI-only autocomplete routes, superseded by `unified-suggest` (kept live for one release, no longer called by the UI).
- `GET /api/geocode/reverse?lat=&lon=` — Nominatim reverse geocoding; returns `{ district }` for the "Nearby" label.

The `countrycodes=de,at,ch` constraint in Nominatim calls and the Photon bounding box must both be updated when expanding beyond DACH.

### Rate limiting & production details

`/api/search` applies in-memory sliding-window rate limits per IP: 10 searches/min general, 3/min for Google Places. These reset on serverless cold start — not suitable for multi-instance without a shared store.

In production, `raw` adapter response data is stripped from `sourceRecords` before the response is sent (see `stripRaw()`). In development the raw data is preserved for debugging. Adapters must also populate `SourceRecord.metadata` (a plain object mirroring the key fields from `raw`) so the info sheet can display data in production — all five adapters do this. When adding a new adapter, always set both `raw` and `metadata`.

**Error reporting (GlitchTip)** — `instrumentation.ts` (server) and `instrumentation-client.ts` (client) initialize `@sentry/nextjs` pointed at the self-hosted GlitchTip instance at `logs.accessible-places.org`. GlitchTip speaks the Sentry ingest protocol. Enabled only in production when `NEXT_PUBLIC_SENTRY_DSN` is set. Performance tracing is off (`tracesSampleRate: 0`). **Critical invariant:** `withSentryConfig` wrapper is deliberately not used — it is webpack-only and breaks the required Turbopack build. Do not add it.

`GET /api/image/google?photoName=` — proxy for Google Places photo URLs. Validates `photoName` against `places/*/photos/*` pattern (SSRF guard), then calls the Places API with `skipHttpRedirect=true` and returns `{ url }` JSON with a 24 h / 7-day SWR cache header. Requires `GOOGLE_PLACES_API_KEY`.

**Place photo** (`PlaceDebugSheet`) — loaded client-side with priority: (1) Google Places via `/api/image/google` (only if Google source is active); (2) OSM `image` tag — `File:…` → Wikimedia Commons `Special:FilePath`, `http…` → direct; (3) OSM `wikimedia_commons` tag; (4) Wikidata P18 claim (fetched from the Wikidata API using the OSM `wikidata` tag). All are best-effort; no photo shown if all fail.

**Vercel Analytics** (`@vercel/analytics`) — `track()` fires custom events from `HomeClient`: `search` (mode, result_count), `search_no_results` (mode, radius_km), `place_not_found` (reason: `no_data` | `not_found`), `filter_apply` (criteria), `parking_shown`. No PII is sent. **Vercel Speed Insights** (`@vercel/speed-insights`) — the `<SpeedInsights />` component is mounted once in `app/layout.tsx` (root) for Core Web Vitals reporting.

`GET /api/stats?token=SECRET` — token-protected adapter usage stats (requires `KV_REST_API_URL`). `lib/stats.ts` tracks per-source call counts, error counts, and response time (min/max/avg) in Upstash Redis using hour-granularity keys (`stats:h:<metric>:<sourceId>:<YYYY-MM-DDTHH>`) with a 90-day TTL. `trackCall`, `trackError`, and `trackDuration` are called fire-and-forget from `app/api/search/route.ts` **per source, inside each adapter's `.then`** (the `wrapped` array) as it settles — **not** after `Promise.all` and **not** from `safeRun`. Running them per-source (rather than gated behind the slowest adapter) means a slow/hanging source can't also suppress the other sources' stats and the GlitchTip alerts (#3 unexpected-adapter-error fires there too). This also keeps `safeRun` and `fetchAllSources` side-effect-free so they can be called safely from ISR pages (a `no-store` Upstash fetch inside an ISR page would demote it to dynamic at runtime).

**GlitchTip flush invariant:** the search route captures Sentry events (#1 unhandled crash, #2 all-sources-failed, #3 unexpected-adapter-error) from inside the streaming `ReadableStream`. It **must** `await Sentry.flush(2000)` before `controller.close()` (via the `flushAndClose` helper) — on Vercel Fluid/serverless the instance can be frozen the moment the response ends, dropping queued-but-untransmitted events. `flush()` is a cheap no-op when nothing was captured. The client (`HomeClient`) has its own 45 s overall search deadline (`SEARCH_TIMEOUT_MS`): a stalled stream aborts and surfaces `t.chat.errorTimeout` (tagged `reason: "timeout"` in the client-side Sentry capture) instead of spinning forever.

`GET /api/nearby-parking?lat=&lon=&radius=&types=` — despite the legacy path, serves **both** amenity types via `?types=parking,toilet` (default `parking`). Radius 0.05–5.0 km (default 0.3). Toilets are dropped unless `ENABLE_NEARBY_TOILETS=1`. Validates coordinates, rate-limits (20/min), dedups WCs, and sets `Cache-Control: no-store` on Overpass failure (a blip must not poison the 5-min CDN window). Used by the amenity **focus mode**; the passive map layer's spots arrive via the `result` event of `/api/search`, not this route.

`POST /api/report-parking` — user reports a weak-tier (amber) parking marker as a likely dedicated disabled spot (button in the MapView popup). Creates a GitHub issue in this repo via `GITHUB_REPORT_TOKEN` with OSM/iD-editor links for manual tag review. Rate-limited 5/min per IP; returns 503 when the token is not configured.

`GET /api/health?token=SECRET` — token-protected E2E health check. Live mode runs a real OSM search (Cafés, Berlin Mitte, entrance + toilet filter). Mock mode (`?mock=1`) runs fixture data through the real pipeline without external calls — suitable for load testing. Google Places is hardcoded off. Ginto is hardcoded off (separate concern). Returns 200/503 with structured JSON.

### Local SEO pages (`app/[city]/[category]/` and `app/en/[city]/[category]/`)

ISR landing pages for 32 DACH cities × 10 categories × 2 locales = **640 potential routes**, rendered **lazily on first request** (`generateStaticParams` returns `[]`; DE revalidate 5 days, EN 5.5 days to stagger). Data comes from `fetchPlacesForSeoPage` in `lib/seo-search.ts` (calls `fetchAllSources` directly, applies `FILTERS_STRICT`, top 25); config in `lib/cities.ts`; rendering in `components/seo/SeoPageContent.tsx`; validity gating via `lib/seo-validity.ts` + `seo-validity.json` (feeds the sitemap). Full route config, the `lib/cities.ts` lookup tables, the two deep-link flows (SEO→app, info-sheet copy-link), and validity safety rules → **[docs/architecture/seo-pages.md](docs/architecture/seo-pages.md)**.

### Static pages

`app/faq/page.tsx` — FAQ page, rendered statically. Contains bilingual content (DE/EN inline, not via the i18n system). `app/impressum/page.tsx` — Legal notice; includes obfuscated contact email to avoid scraping. `app/datenschutz/page.tsx` — Privacy policy (Datenschutzerklärung). `app/ueber-uns/page.tsx` and `app/en/about/page.tsx` — "Über die App" / "About" marketing page; bilingual pair using the same inline-content pattern as FAQ (no `LocaleProvider` i18n).

The EN routes use **localised slugs** distinct from the DE paths (set up in v3.85): `app/en/legal-notice` (↔ `/impressum`), `app/en/about` (↔ `/ueber-uns`), `app/en/privacy` (↔ `/datenschutz`), plus `app/en/faq`. When adding or renaming a static page, update both the DE and EN slug and the hreflang/canonical metadata on each.

### PWA / Service Worker

`app/sw.ts` + `@serwist/next`. The service worker is **disabled in development** (`disable: process.env.NODE_ENV === "development"` in `next.config.ts`).

**`NetworkOnly` for API routes** — `/api/search` and `/api/nearby-parking` are explicitly excluded from runtime caching via a `NetworkOnly` handler. Serwist's default `NetworkFirst` has a 10 s timeout; Overpass queries regularly exceed this, causing the SW to fall back to a stale or empty cache entry (manifests as "no parking spots" in the installed PWA). Do not add these routes back to `defaultCache`.

**CSP**: `next.config.ts` defines the `Content-Security-Policy` header. **Any new external domain** — whether a new API, CDN, or map tile server — requires adding it to the appropriate directive (`connect-src` for fetch/XHR, `img-src` for images). Forgetting this causes silent failures in production.

## Versioning

`APP_VERSION` in `lib/config.ts` — bump on **every commit** (established convention; the commit message carries the version as a `(vX.Y)` suffix). Shown in the Impressum alongside `BUILD_DATE`, which is auto-injected by `next.config.ts` at build time (`new Date().toISOString().split("T")[0]` → `"YYYY-MM-DD"`). `BUILD_DATE` is a build-time env var — it is set automatically, never manually configured.

## Environment variables (server-side only)

- `ACCESSIBILITY_CLOUD_API_KEY` — optional; source is silently skipped if absent
- `REISEN_FUER_ALLE_API_KEY` — optional; source is silently skipped if absent. Request access from DSFT/Natko at reisen-fuer-alle.de (non-commercial use available on request).
- `REISEN_FUER_ALLE_API_BASE` — base URL for the RfA API (e.g. `https://api.reisen-fuer-alle.de/v1`); required alongside the key
- `GOOGLE_PLACES_API_KEY` — optional; source is silently skipped if absent
- `ENABLE_NEARBY_PARKING=1` — feature flag; enables the disabled-parking enrichment fetch in both the main `/api/search` route and SEO pages (off by default). When active, a parallel OSM fetch for disabled-parking nodes runs alongside the venue adapters and the results are used for enrichment and `parkingSpots` map markers.
- `ENABLE_NEARBY_TOILETS=1` — feature flag; enables the wheelchair-WC fetch in `/api/search` (passive map layer) and `/api/nearby-parking` (focus mode). Independent of `ENABLE_NEARBY_PARKING`. Off by default. WCs are display-only (never enrich a place's `toilet.value`). **Both flags must be set in the Vercel production env** to be live there — they are not inferred from anything; a missing flag silently disables that layer for all users.
- `GINTO_API_KEY` — optional; Ginto GraphQL API (Swiss-focused accessibility data). Contact support@ginto.guide. Source silently skipped if absent.
- `GINTO_GEOFENCE=1` — optional; restricts Ginto calls to searches whose circle can reach the CH bounding box. Off by default (per Ginto 2026-06: API volume uncritical). Emergency brake if Ginto rate limits are hit.
- `HEALTH_CHECK_SECRET` — required to activate `GET /api/health` and `GET /api/stats`; requests without a matching `?token=` get 401. If unset both endpoints return 503.
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — optional; Upstash Redis credentials for adapter call/error stats. If absent, `lib/stats.ts` is a no-op and `GET /api/stats` returns 503.
- `OVERPASS_ENDPOINTS` — optional; comma-separated list of Overpass API URLs to override the two public mirrors. Multiple URLs retain the parallel-race behaviour. Production value includes the private Hetzner server first, then both public mirrors as fallback: `https://overpass.accessible-places.org/api/interpreter,https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter`.
- `NOMINATIM_ENDPOINT` — optional; base URL of a private Nominatim instance, e.g. `https://nominatim.example.com`. Trailing slash is stripped automatically. Applies to all three geocode routes and the search pipeline.
- `GITHUB_REPORT_TOKEN` — optional; GitHub token used by `POST /api/report-parking` to file parking-report issues. If absent the endpoint returns 503.
- `NEXT_PUBLIC_SENTRY_DSN` — optional; GlitchTip DSN for error reporting. If absent (or in dev), reporting is silently disabled in both `instrumentation.ts` and `instrumentation-client.ts`.

## Tests

- `__tests__/components/` — jsdom + Testing Library (includes `SeoPageContent.test.tsx` for badge format and chip-category filtering)
- `__tests__/lib/` — pure unit tests (node environment via `// @vitest-environment node` header where needed; includes `cities.test.ts` for data-integrity checks)
- `__tests__/api/` — API route unit tests (node environment, mocked `fetch`)
- `__tests__/integration/` — live network tests; skip themselves when API keys or network are absent. Not required for CI.

`vitest.setup.ts` mocks `window.matchMedia` (always returns `matches: false`), `localStorage`, and `ResizeObserver` for jsdom tests.

**Rate-limiter pitfall in `search.test.ts`:** The `/api/search` route holds a module-level in-memory sliding-window counter keyed by `x-forwarded-for` (falls back to `"unknown"`). Tests that call `POST()` without setting this header all share the `"unknown"` bucket; the 11th call in the same file returns 429 before the stream starts. Fix: set a distinct `x-forwarded-for` header on requests in test groups that run after the first ~10 POST calls in that file.

## Private Overpass server (Hetzner)

Self-hosted Overpass API for DACH at `overpass.accessible-places.org` (Hetzner CX33, `ssh root@overpass.accessible-places.org`). Full ops runbook — Docker env vars, restart command, replication troubleshooting — in `docs/overpass-server.md`. **Read it before any server-side change**; several defaults of the `wiktorn/overpass-api` image cause production failures.

One detail that matters app-side: an overloaded Overpass daemon returns HTML with HTTP **200** (not 5xx). The OSM adapter's content-type guard detects this and rejects the endpoint so the parallel race falls through to the public mirrors.

## Capacitor Android app

The app ships as an Android APK (Capacitor shell wrapping the deployed web URL) in addition to the PWA. The native shell lives in `android/` (checked in to this repo); runbook at `docs/capacitor-android-setup.md`.

**`lib/native/geolocation.ts`** — platform-aware wrapper around `@capacitor/geolocation`. Call `getCurrentPosition()` from this module instead of `navigator.geolocation` directly. On `Capacitor.isNativePlatform() === true` it checks/requests OS permissions and uses the native plugin; in the browser it falls back to `navigator.geolocation`. The plugin is dynamically imported to keep it out of the web bundle's critical path.

**`lib/native/browser.ts`** — `openExternalUrl(url)` opens external links via `@capacitor/browser` (Chrome Custom Tabs / SFSafariViewController) on native, `window.open` in the browser. Falls back to `window.open` gracefully if the plugin is missing (old APK). Use this instead of `window.open` for external links.

**Critical invariant (`isFirstVisit`):** the welcome-screen / auto-locate gate must be initialised from `localStorage` in a layout effect (not from React state derived after mount). A `useState` init that reads `localStorage` races with Capacitor's WebView cache on cold start — the welcome screen flashes or auto-locate fires incorrectly. See commit `2294867` for the fix pattern and `#418` for the original race.
