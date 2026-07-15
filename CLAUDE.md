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
npm run test:a11y    # axe structural accessibility tests (__tests__/a11y/)
npm run check:contrast  # WCAG contrast of globals.css design tokens (CI-gated)

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

**Also run `npx tsc --noEmit` before pushing** when adding fields to `ActiveSources`, `SearchFilters`, or any other interface that appears in test fixtures. `vitest` strips types at runtime so missing required fields only surface in `next build` (which runs `tsc`) — catching them locally avoids a failed Vercel deploy. The `__tests__/` directory is excluded from the production `tsc` config but included when running `npx tsc --noEmit` directly.

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

No LLM is used at runtime (despite the name, `lib/llm.ts` does no model inference). `parseQuery()` deterministically extracts `locationQuery` (for Nominatim) and `categories` (from `CATEGORY_HINTS` regex match). **Categories are inferred only from the part before the first `"in"`** — city names must not trigger category hints (the city "Essen" matches the restaurant hint "essen"); a query without `"in"` is scanned as a whole. No hint match → all 27 categories (the all-categories default; the UI sends `"in <location>"` for known-pure locations). `extractQuotedName()` pulls text inside any quote style (straight, curly, guillemets) and is used by `ChatPanel` to populate `nameHint` when the user wraps a name in quotes (`"Vapiano" in Berlin`). The name filter is entirely separate — it is passed as `nameHint` in the API body and applied server-side after all adapter results are merged.

`extractLocationFallback()` (the no-`"in"` path) collects capitalised words **plus 4–5-digit tokens** (AT/CH and DE postal codes — `"67433 Neustadt"` must keep the PLZ so Nominatim can disambiguate namesake towns) and **strips recognised category words** (`"Arzt Frankenthal"` geocodes `"Frankenthal"`; when ALL capitalised words are category terms — the city `"Essen"` — they are kept). With a category chip active, `ChatPanel.buildQuery` prefixes the chip label **only for bare location inputs**; text carrying its own `"in"`-structure is sent raw (typed query wins — a prefixed `"Arztpraxen in Arzt in Frankenthal"` would geocode the wrong tail). Geocode failures are split into fatal codes `location_not_found` (Nominatim answered: no such place) vs `geocoding_unavailable` (429/timeout — transient, distinct retry message); a fatally failed search clears the persisted session-restore run so reloads can't loop on it. The live permutation suite for all of this is `__tests__/integration/freetext-matrix.test.ts` (run with `FREETEXT_MATRIX=1`, real Nominatim/Overpass calls, ~2 min — not part of `npm test`).

`inferAmenityType()` (v10.4) detects a free-text parking/WC request ("Parkplatz in Köln", "WC in Berlin") and routes it into the same amenity search the 🅿/🚻 chips use, instead of `parseQuery()`'s category path (which would silently fall back to all-categories, since parking/toilet are deliberately excluded from `CATEGORY_HINTS` — they're an `AmenityType`, not a `Category`). Deliberately **exact-match only** — the part of the query before `"in"` (or the whole query, if there's no `"in"`) must consist of *nothing but* one `AMENITY_HINTS` word, never a substring match, so `"Hotel mit Parkplatz in Köln"` (parking as a venue attribute) is never hijacked. Wired in `ChatPanel.submit()`: with `"in"` present, the location is extracted via `extractLocationFallback()` and geocoded directly (`locationPart()` can't be reused here — it only strips a *leading* `"in "`, not a preceding word like `"Parkplatz"`); a bare amenity word with no location calls `selectAmenity(type, skipTypedLocation=true)`, reusing the same viewport/GPS-fix/auto-locate fallback chain a direct chip tap already has — the `skipTypedLocation` flag exists because `selectAmenity` normally reads its "did the user type a location" signal straight from `location` state, which still holds the stale trigger word at this point (`setState` doesn't apply within the same synchronous call).

### Adapters (`lib/adapters/`)

Five adapters run in parallel via `startAdapterTasks()`:
- **OSM** (`osm.ts`): Overpass query raced in parallel across 2 mirror endpoints via `Promise.any()` — first successful response wins, loser is aborted. `[timeout:12]` in QL + `AbortSignal.timeout(20_000)` client-side. 429/5xx throws immediately so the race can resolve. `AggregateError` is unwrapped to `err.errors[0]` when both fail.
- **accessibility.cloud** (`accessibility-cloud.ts`): A11yJSON-shaped records. Always uses `accessibilityPreset=at-least-partially-accessible-by-wheelchair`.
- **Reisen für Alle** (`reisen-fuer-alle.ts`): Highest reliability weight (1.0). Hidden from FilterPanel UI (not in `SOURCE_ORDER`) but always active when the key is set.
- **Ginto** (`ginto.ts`): GraphQL API (`POST https://api.ginto.guide/graphql`). Data is Switzerland-focused but with scattered entries across DACH; queried for every search by default. `GINTO_GEOFENCE=1` re-enables the CH bounding-box fence (skips calls whose search circle cannot reach CH) as an emergency brake against rate limits. `position.countryCode` is normalised ISO-3→ISO-2 (`AUT`→`AT` etc.; empty→`CH`). `defaultRatings[].key` prefix convention maps to A11yValue: no prefix → entrance, `toilet_` → toilet, `parking_` → parking. Paginates up to 2 pages (100 results). Base weight 0.90; SELF_DECLARED entries use 0.94, AUDITED entries use 1.0 (via `qualityInfo.approvalLevels` — who vouches for the data: operator vs. external authority). `qualityInfo.detailLevels` measures data completeness, not trustworthiness — stored in `metadata` only, never affects the weight. `updatedAt` is a system republish timestamp, not a human verification date — stored in `metadata` only, never sets `verifiedRecently`. AUDITED also does not set `verifiedRecently` (no audit date in the API).
- **AccèsLibre** (`acceslibre.ts`): French government accessibility database (`https://acceslibre.beta.gouv.fr/api/erps/`). REST API, `Authorization: Api-Key` header. **Only runs in international mode when the search centre is inside the FR bounding box** — always skipped for DACH searches. Weight 0.90. Category fan-out via `?activite=<slug>`: `TO_ACCESLIBRE` maps each `Category` to one or more AccèsLibre slugs; `FROM_ACCESLIBRE` maps slugs back. For specific categories the adapter fetches one request per slug sequentially with a 250 ms pacing gap to stay under the ~5 req/s burst limit; for all-categories it does a single unfiltered fetch instead. 429 responses are retried up to `MAX_429_RETRIES=2` times honouring `Retry-After`. `entree_marches_rampe="aucune"` means no ramp (not falsy); coordinate order in `geom.coordinates` is `[lon, lat]` — always swap. The `commentaire.commentaire` field (free-text FR note from the venue) is stored in source-record `metadata.commentaire` and rendered in `PlaceDebugSheet`.
- **Google Places** (`google-places.ts`): Lowest reliability weight (0.35); fires one POST per category, capped at `GOOGLE_MAX_CATEGORIES = 3` so an all-categories search cannot fan out one upstream call per category. Uses **Text Search** (not Nearby Search) with a localized query term per category (`CATEGORY_QUERY`, picked via `SearchParams.locale`): Nearby's POPULARITY ranking buries small venues in dense categories even hyper-locally (verified live). Two consequences handled in the adapter: `locationBias` is soft → results are distance-clipped to the radius; Text Search takes no type list → results are post-filtered against `CATEGORY_TYPES` (lenient when a result carries no types). **Adaptive pagination** up to `GOOGLE_MAX_PAGES = 3` pages (60 results) per category — follow-up pages fetch only while `nextPageToken` is present (must be in the field mask), so sparse categories stay at one request. Google often carries duplicate entries of one venue with different data completeness; `mergeAttribute` guards against the sparse duplicate overwriting a known value with `unknown`. **Disabled by default** in `DEFAULT_SOURCES` (defined in `app/HomeClient.tsx`). Auto-enabled when the user turns on international mode.

### Categories (`lib/config.ts`, `lib/types.ts`)

27 search categories (the `Category` union in `lib/types.ts`). Each maps to OSM tags in `CATEGORY_OSM_TAGS` — a `{ amenity?, tourism?, shop? }` record. **`cafe` is a merged category** covering both `amenity=cafe` and `amenity=ice_cream` (ice cream parlours are frequently only tagged as cafés); all adapters classify ice-cream venues as `cafe`, and the chip/label reads "Cafés & Eis" / "Cafés & Ice Cream". The `shop` dimension was added for the everyday categories (`chemist`/`supermarket`/`bakery`/`hairdresser`); the OSM query builder in `osm.ts` collects all three dimensions into separate clauses. The 12 everyday categories (pharmacy, doctors, dentist, veterinary, hospital, chemist, supermarket, bakery, hairdresser, bank, post_office, zoo) were added in v4.29.

**Adding a source touches many files in lockstep:** `SourceId` union and `ActiveSources` interface (`lib/types.ts`), `RELIABILITY_WEIGHTS` + `SOURCE_LABELS` (`lib/config.ts`), `SOURCE_ORDER` in `FilterPanel.tsx`, `DEFAULT_SOURCES` in `HomeClient.tsx`, every `ActiveSources` literal in `app/api/health/route.ts`, `lib/seo-search.ts`, and all test fixtures. Missing `ActiveSources` keys are not caught by `vitest` (types are stripped) but will fail `next build` — run `npx tsc --noEmit` before pushing.

**Adding a category touches many files in lockstep:** the `Category` union (`lib/types.ts`), `CATEGORY_OSM_TAGS` (`lib/config.ts`), every adapter's category mapper (`lib/adapters/*`), `ALL_CATEGORIES` + `CATEGORY_HINTS` (`lib/llm.ts`), the `categories` i18n block (`lib/i18n/*`), and `CATEGORY_ICONS` (`lib/category-icons.ts`). A missing adapter entry is a TypeScript error (the maps are `Record<Category, …>`), so the build catches most omissions.

`lib/category-icons.ts` exports the shared `CATEGORY_ICONS` emoji map (one entry per category), used in the `PlaceCard` header, the map popup, the `PlaceDebugSheet` header, **and** the map pin-marker glyph. Each of those three views also shows the localised category label (`t.categories[place.category]`) near the top.

Only 10 categories have SEO landing pages (`SEO_CATEGORY_SLUGS` in `lib/cities.ts`): cafe, restaurant, bar, pub, biergarten, hotel, museum, theater, cinema, attraction. The other 18 are search-only — the `[city]/[category]` route 404s any non-SEO slug.

### International mode (`lib/config.ts`)

`AppSettings.internationalMode` (default `false`) unlocks search beyond DACH. The single source of truth for all geo gates is `lib/config.ts`:

- `DACH_BBOX` / `DACH_CODES` — always available.
- `INTL_COUNTRIES` — the opt-in allowlist (FR, GB, NL, ES, IT, US). Each entry has a `code` and a `bbox`. Adding a new country = one entry here + one unit test in `regionForCoordinates`.
- `regionForCoordinates(lat, lon)` → `"dach" | "intl" | "outside"` — DACH checked first so border overlaps stay on the fast path.
- `endpointsForCoordinates(lat, lon, international)` — drops the private Hetzner server outside DACH so it cannot win the Overpass race with a geographically empty response.
- `countryCodesParam(international)` — Nominatim `countrycodes=` value.
- `GINTO_GEOFENCE=1` env var restricts Ginto to its CH bbox (emergency brake).

When `internationalMode` is toggled on in `HomeClient.handleUpdateSettings`, Google Places and AccèsLibre are also auto-enabled. Ginto and RfA emit a synthetic skipped source event outside their regions to prevent the search spinner from hanging. The `/api/nearby-parking` route requires `?intl=1` to pass the flag through to `fetchOsmAccessibleAmenities`; `HomeClient` appends it from `settings.internationalMode`.

### Matching & merging (`lib/matching/`)

`match.ts` dedupes candidates against canonical places via a weighted score (`MATCH_SCORE_THRESHOLD = 0.72`); `merge.ts` resolves the winning `A11yValue` by summed source weight and computes filtered confidence; `nearby-parking.ts` does post-merge disabled-parking enrichment. **`passesFilters` treats both `"yes"` and `"limited"` as passing; only `"no"` fails (`"unknown"` fails unless `acceptUnknown`).** Full formulas, the `parkingNearby` sub-toggle, and `passesFiltersForSource` → **[docs/architecture/matching.md](docs/architecture/matching.md)**.

### Amenities: parking + WC (`lib/amenities/`, `osm.ts`, `nearby-parking.ts`)

Disabled parking and wheelchair WCs are modelled as **typed point features** (`AmenityFeature`), not place attributes. Parking enriches a venue's `parking.value`; **WCs never enrich** `toilet.value`. Two display surfaces: (1) a passive map layer overlaying venue results (from `/api/search`, gated by the `alwaysShowParking`/`alwaysShowToilets` settings), and (2) a first-class **amenity search** — the `🅿 Parken` / `🚻 WC` chips at the front of the chip strip (single-select with the venue chips). Selecting one runs an amenity search (via `/api/nearby-parking`) that *replaces* the venue results: the spots become the primary results, shown as distance-sorted list cards **and** map markers. The old hidden "focus mode" was removed in v8.62 (issue #30) in favour of these chips. Internally `MapView` still receives a `focusMode` prop — now driven by `amenitySearch !== null` — that switches it to fit-to-spots + the "search this area" button; that flag is an implementation detail, not the user-facing mode. **Popup XSS rule: any OSM-sourced string in a map popup must be wrapped in `esc()`** (OSM is publicly editable; i18n strings and numbers are trusted). Tiers, host colours, dedup/payload-cap → **[docs/architecture/amenities.md](docs/architecture/amenities.md)**.

**Amenity-search wiring** — `amenitySearch: AmenityType | null` in `HomeClient` is the single source of truth (null = normal venue search). `handleAmenitySearch(type, coords?, radius?, panned?)` fetches `/api/nearby-parking` and sets `amenitySpots`; `parkingSource`/`toiletSource` feed those into the existing `visibleParkingSpots`/`visibleToiletSpots` (so `showWeakParking`/`publicToiletsOnly` still apply). `ChatPanel` owns the chip dispatch: an amenity chip uses the active nearby fix → the area's coords → else auto-locates (the GPS fix is routed to the amenity search via `pendingAmenityRef`). A venue search clears `amenitySearch`. The native quick-action path (`pendingFocusAction`) routes to `handleAmenitySearch`. During an amenity search the `FilterPanel` swaps the venue criteria/sources for amenity options (radius + weak-parking / public-toilets).

### Confidence weights (`lib/config.ts`)

Reliability weights live in `SOURCE_RELIABILITY` (`reisen_fuer_alle 1.0` > `ginto 0.90` = `acceslibre 0.90` > `osm 0.75` > `accessibility_cloud 0.70` > `google_places 0.35`). Ginto refines per-entry: SELF_DECLARED → 0.94, AUDITED → 1.0. The `osm_*`/`nominatim` entries are weight `0` (stats-only, never place attributions). `CONFIDENCE_THRESHOLDS`: `high = 0.70`, `medium = 0.40` → `confidenceLabel()` "Verlässlich" / "Mittel" / "Unsicher".

`OSM_ENTRANCE_WEIGHT_FACTOR = 0.90` applies an extra reduction when OSM's whole-place `wheelchair=*` tag stands in for the entrance criterion specifically.

### i18n (`lib/i18n/`)

`LocaleProvider` is nested: root layout uses `"de"` as default; `app/en/layout.tsx` wraps `/en/*` in a second `LocaleProvider initialLocale="en"`. `app/en/layout.tsx` is a **Server Component** — the `document.documentElement.lang = "en"` side effect lives in `app/en/LangSetter.tsx`, a null-rendering client component that is imported by the layout. This separation is required so Next.js can resolve `generateMetadata` from EN SEO pages (client layouts break the metadata chain). All translations are typed via `lib/i18n/types.ts`. `distanceFromHere(m: number) => string` formats metres/km in the locale's style (DE: `"250 m entfernt"`, EN: `"250 m away"`).

### Mobile vs desktop

`useIsMobile()` (`hooks/useIsMobile.ts` — pointer: coarse or max-width 767px) gates layout branching in `HomeClient.tsx`. Mobile uses `MobileLayout` (tab bar: results / map / filter). Desktop has a resizable results column with a drag handle. In tests, `matchMedia` is mocked to always return `false` (desktop).

**Header radius pill (mobile)** — `MobileLayout`'s header renders a `RadiusPresetPopover` (`components/filters/RadiusPresetPopover.tsx`) next to the settings icon, using `radiusKm` (already resolved by `HomeClient` to the venue-vs-amenity domain) — so it's outside the tab-switched content (`ChatPanel` sits there too, "always visible" per its own comment) and stays in sync across all three tabs without new state. Unlike `ResultsList`'s header picker (venue-only, gated `undefined` during an amenity search via `canShowResultsRadiusPicker` in `lib/search-ui.ts`), the header pill **stays interactive during an amenity search**: `headerRadiusControl()` (`lib/search-ui.ts`) picks `AMENITY_RADIUS_PRESETS_KM`/`onAmenityRadius` instead of `RADIUS_PRESETS_KM`/`onRadiusChange` — both ultimately call the same commit handler (`handleAmenityRadiusCommit` in `HomeClient`) that `FilterPanel`'s own amenity slider already uses, so there's still exactly one source of truth per domain, just two entry points to it (same pattern the venue radius already had). `formatRadiusKm()` (`lib/search-ui.ts`) renders sub-km presets as `"250 m"` rather than `"0.25 km"`.

**Empty state actions** — `ResultsList` accepts an optional `onAdjustFilters?: () => void` prop. When present (mobile only), a primary "Filter anpassen" button is rendered alongside the expand-radius button; clicking it calls the callback. `MobileLayout` passes `() => setActiveTab("filter")`. When absent (desktop), a text hint is shown instead — the filter panel is already visible.

**PlaceCard interaction** — Since v9.67, only the framed header box (icon + name + category + address + confidence badge + trailing chevron) opens `PlaceDebugSheet` (the place info sheet) via `createPortal` — not the whole card body, which read as an unlabelled "click anywhere" surface with no visible affordance. The box is `role="button"` on a `<div>` (not a real `<button>`, whose content model forbids the nested `<h3>`), with manual Enter/Space handling and `aria-label={t.results.openDetails(name)}`; it's visually inset from the card's own edges/corners (a smaller-radius bordered/tinted box) so it doesn't read as a second stacked card. The confidence badge sits inside this box as a plain child with no `stopPropagation` — tapping it opens the same detail sheet (decision D2c) instead of its own quick-view popup; the score-calculation breakdown it used to show now lives inside `PlaceDebugSheet`'s "Barrierefreiheit" section chip, which is itself a click-to-expand toggle (`ScoreContent`, exported from `ConfidenceBadge.tsx`). Everything else on the card — source badges, accessibility rows, footer links/expand/map-pin — sits outside the box and keeps its own `stopPropagation`'d actions. A separate map-pin button on the card (`onClick` prop) selects the place on the map without opening the sheet.

**PlaceDebugSheet detail rows** — For each accessibility criterion (entrance, toilet, seating) the sheet renders a header row then wraps sub-detail rows in `ml-6 pl-3 border-l border-border` so the parent is unambiguous. The structured detail types are `EntranceDetails`, `ToiletDetails`, `ParkingDetails`, `SeatingDetails` (all in `lib/types.ts`); they are carried in `AccessibilityAttribute.details` (merged) and `SourceAttribution.details` (per-source). AccèsLibre's free-text `commentaire` is read from `getMeta(place, "acceslibre")?.commentaire` and rendered at the bottom of the accessibility section.

**Distance display** — `PlaceCard` shows inline distance (`t.results.distanceFromHere`) when `distanceM` prop is provided. `searchCenter` reaches `ResultsList` **only when `chatMode === "nearby"` or an amenity search is active** — distance is intentionally not shown for text-search or panned-area results. This gate is applied independently on desktop (`HomeClient.tsx`) and mobile (`MobileLayout.tsx`, which receives its own `searchCenter` prop and must re-gate it locally — a v9.72 fix, mobile previously passed it through ungated).

`MapView` (`components/map/MapView.tsx`) uses Leaflet, loaded via `dynamic(..., { ssr: false })`. Teardrop pins coloured by confidence with the category emoji, `leaflet.markercluster` grouping, the "Hier suchen" pan-detection time-window invariant, the two-effect ordering + first-mount `invalidateSize` invariants, and the `isolation: isolate` stacking-context rule → **[docs/architecture/mapview.md](docs/architecture/mapview.md)**.

**Filter/source/radius persistence** — `HomeClient.tsx` persists the active filter criteria, source toggles, and radius to `localStorage` via a `useEffect` (guarded by `prefsLoadedRef` so the initial load effect fires first and the persist effect never overwrites saved prefs with defaults). `alwaysShowParking` and `alwaysShowToilets` are intentionally excluded from the filter-prefs key — they are persisted separately via `AppSettings`. `handleReset` restores defaults and writes them back, so the stored value self-heals on reset.

**Welcome / onboarding screen** — first-time visitors see a welcome screen instead of the normal UI. Controlled by `isFirstVisit` in `HomeClient`, initialised lazily: `true` when neither `ap_visited` nor `ap_welcome_dismissed` is set in `localStorage`. Dismissing via "Nicht mehr anzeigen" sets `ap_welcome_dismissed` and optionally triggers a nearby GPS search. The normal `ap_visited` key is set on any regular search. Both keys can be cleared via `onResetOnboarding` in `SettingsSheet` (gear icon → Reset → reset onboarding). The welcome UI lives inside `MobileLayout` and `ChatPanel`, not in a dedicated component.

### User settings (`lib/settings.ts`)

`AppSettings` is a user-configurable set of defaults persisted to `localStorage` under key `ap_settings`. `useSettings()` returns `[settings, updateSettings]`; `loadSettings()` is called in lazy `useState` initialisers in `HomeClient` for settings that must be available before React mounts.

Fields: `defaultSearchMode` (`"text"` | `"nearby"` | `null` = no preference; legacy `"place"` is migrated to `"text"` on load), `defaultMobileView` (`"results"` | `"map"`), `defaultChipCat` (the `Category` key of the pre-selected chip, `null` = "Alle"/all categories — the app default; replaced the positional `defaultChipIdx`, migrated on load), `sortOrder` (`"confidence"` | `"distance"`), `autoZoom` (MapView auto-fits after search), `alwaysShowParking` / `alwaysShowToilets` (passive map-layer display toggles, default `false`; persisted here, **not** in the filter-prefs key, and excluded from it in `HomeClient`; the only UI entry point is `MapView`'s bottom-left "Ebenen" layer-pill control — `SettingsSheet` had a redundant second toggle for `alwaysShowParking` until it was removed in v9.64, since both wrote to the same persisted value), `showWeakParking` (show the weak parking tier as amber markers, incl. during a parking search; default `false`), `publicToiletsOnly` (restrict the WC layer to standalone public toilets, hiding venue WCs; default `false`), `parkingRadiusKm` (the amenity/🅿🚻 search starting radius, 0.05–5.0, default 4.0 — genuinely drives every plain-chip amenity search via `amenityRadiusKm`'s lazy-`useState` seed in `HomeClient`, kept in sync by `persistParkingStartRadius` on every amenity radius change; **no dedicated Settings UI** since v9.65 — the header radius pill and `FilterPanel`'s amenity slider are its only, already-existing entry points, so a separate Settings row was redundant with what happens automatically).

**Chip identity is by category key, not index (since the cafe+ice_cream merge).** Each entry in `SETTING_CHIPS` (`lib/settings.ts`) and `CHIPS` (`ChatPanel.tsx`) carries a `cat: Category`. Persistence and deep-links key off `cat`, never array position: `AppSettings.defaultChipCat` stores the category; `ChatPanel`'s `ap_last_search` stores `{ cat }`; SEO deep-links pass a `Category` via `initialChipCat` (from `SEO_CATEGORY_SLUGS`, so the old hard-coded `SEO_CATEGORY_TO_CHIP_IDX` table is gone). `ChatPanel` converts `cat → selectedIdx` internally via `chipIdxForCat`. **Consequence:** the two arrays only need the same *visible* order for consistency — reordering or removing a chip can no longer silently re-map a saved preference. Legacy installs that stored the old positional `defaultChipIdx` (and `ap_last_search.idx`) are translated once via `legacyChipIdxToCat` (exported from `lib/settings.ts`); the name-keyed migration is idempotent. The "Alle" chip (`selectedIdx === null`) and the two amenity chips (`🅿`/`🚻`) are pseudo-chips outside `CHIPS`/`SETTING_CHIPS`. The chip strip renders in **both** text and nearby modes (always, since v8.62).

`SettingsSheet` (`components/settings/SettingsSheet.tsx`) renders via `createPortal` and is triggered from a gear icon in `HomeClient`. It receives `settings` and `onUpdate`; `HomeClient.handleUpdateSettings` applies the patch and syncs derived state (e.g. propagates `sortOrder` → `sortBy`).

### Unified search field & place search (ChatPanel → API)

Explore mode has **one search input** backed by `/api/geocode/unified-suggest`; the dropdown groups results into **areas** (→ `onSearch`, category search) and **venues** (→ `onPlaceSearch(name, coords)`, place search). The selection commits the intent — Enter on raw free text always runs an area search. A name *filter* is expressed via quote syntax (`"Vapiano" in Berlin` → `nameHint`, applied as a post-merge JS filter `filterByNameHint`, so accessibility filters apply independently). **Place-search mode** (`placeSearch: true` on `SearchParams`) looks up a specific venue, with the OSM adapter switching to a name-regex Overpass query (capped 0.5 km). The `handlePlaceSearch` resolution chain, `place_not_found` vs `place_no_data` states, and the `programmaticLocRef` suppression pattern → **[docs/architecture/place-search.md](docs/architecture/place-search.md)**. There is no submit button (Google Maps model): a search starts from Enter, the always-present "search for `<text>`" dropdown row, a suggestion pick, a category chip, or — with an empty field and an active GPS fix — tapping the green location token itself.

**Nearby search entry points (v9.72, revised v10.1)** — there are now two distinct ways to start a nearby search, deliberately styled to different roles per a colour convention: **blue = "this searches now"** (the active category chip is blue, and it is exactly what a nearby search runs against), **neutral/white = "this only navigates the map"**.

- **Search row (v10.1):** a freestanding circular blue button to the right of the search field (`ChatPanel`, `t.chat.nearbySearchButton`), separated from the field by a visible gap so it cannot be misread as the field's submit button (the field itself has none — see the no-submit-button paragraph above). One tap calls `ChatPanel`'s own `handleLocate()` — the same function the welcome-screen CTA and `locateTrigger` prop already used — which locates, reverse-geocodes, and **immediately runs a nearby search** using whichever chip is currently active. This is the primary, one-tap "search near me" entry point.
- **Map locate button (v9.72):** `MapView`'s own locate button, deliberately neutral (white/grey, never blue) since it does **not** search — a tap (`HomeClient.handleLocate` → `MapView`'s `locatePanTrigger`) only pans the map and **arms** the existing "Hier suchen" pill (`onSearchHere`); a locate tap while browsing unrelated results never destroys them. `handleLocate` also reverse-geocodes the district in the background and feeds it to `ChatPanel` via `mapLocateFix`/`mapLocateFixKey`, which populates `nearbyPhase` (and therefore the location token) without running a search. Only a second tap, on the pill, actually searches — `MapView` tags each armed pill with `origin: "drag" | "locate"` (`searchHereOriginRef`) depending on whether a real drag or the locate button set it, and `HomeClient.handleSearchHere` branches on it: `origin === "locate"` sets `chatMode("nearby")` (GPS-origin — distance shows, token stays) without exiting nearby state; a genuine drag-pan keeps the pre-existing behaviour (`chatMode("text")`, `exitNearbyTriggerKey` bump).

The welcome screen's "In der Nähe suchen" CTA, `defaultSearchMode = "nearby"` auto-locate on launch, and the amenity chips' own auto-locate are unrelated code paths (`ChatPanel`'s own `handleLocate`, `pendingAmenityTypeRef`) and are unaffected by either of the above. History: `docs/plans/remove-nearby-button-from-search-row.md` (v9.72 removed the row button entirely in favour of the map-only flow; v10.1 reintroduced it in a visually distinct, freestanding form after user feedback that the map-only flow was a two-tap detour with no dedicated search-context entry point).

### Supplementary Place fields

`Place` carries optional fields that adapters populate beyond wheelchair data:

- `allowsDogs` / `dogPolicyOnly` — sourced from supplementary A.Cloud datasets (e.g. Pfotenpiloten). Records that arrive as `dogPolicyOnly: true` are dropped by the search route **unless** they merge with a place that has real wheelchair data. Once merged the flag is cleared (`undefined`).
- `isVegetarianFriendly` / `isVeganFriendly` — from OSM `diet:vegetarian|vegan=yes/only` or Google Places types `vegetarian_restaurant` / `vegan_restaurant`. `vegan=true` implies `vegetarian=true` (set automatically during merge).
- `wheelmapUrl` — authoritative Wheelmap.org URL from `accessibility.cloud`'s `infoPageUrl`; preferred over a constructed link.
- `gintoUrl` — Ginto detail page URL from `publication.linkUrl`; shown as ShieldCheck icon in PlaceCard when present.

### "Navigate here" (`lib/native/navigation.ts`)

One-tap turn-by-turn navigation from a place or amenity spot to the phone's
own maps app. Concept + full rationale: `docs/plans/native-navigate-here.md`.
Deliberately **not** built on `openExternalUrl()`/`NativeLink`
(`lib/native/browser.ts`) — that mechanism opens a Custom Tab /
SFSafariViewController, a browser context that can't reliably hand off a
non-`http(s)` deep-link scheme (`maps://`, `google.navigation:`, `geo:`) to
an installed app. `lib/native/navigation.ts` instead does a plain WebView
navigation (`window.location.href = uri`) — the same path any other link tap
uses to escape the WebView, relying on the OS's default "unrecognised
scheme → hand to an installed app" behaviour (no native plugin, no Capacitor
API call).

- `startDefaultNavigation(coords)` — platform default, one tap, no chooser:
  `google.navigation:` (Android, launches Google Maps already in driving
  mode) / `maps://` (iOS, Apple Maps) / the universal
  `google.com/maps/dir/?api=1&destination=…` URL opened in a new tab
  everywhere else (desktop browser, mobile browser, PWA — `getPlatform()`
  only distinguishes native iOS/Android from "web", so this path also covers
  mobile-web visitors, not just desktop).
- `startNavigationWithApp(app, coords)` — a specific app's deep link, for the
  Android-only in-app chooser (below).

**Reduced-scope Variant C — the in-app chooser is Android-only.** iOS ships
with no chooser: `startDefaultNavigation` goes straight to Apple Maps.
Offering a "Google Maps" option on iOS would need a `canOpenURL` installed-
app check, which requires declaring `comgooglemaps` under
`ios/App/App/Info.plist`'s `LSApplicationQueriesSchemes` (a native Xcode
project change) — without it, a tap on an uninstalled app's scheme fails
**silently** (no error, dead tap), worse than not offering the option.
Android needs no such entitlement (`PackageManager` queries aren't gated the
way iOS 9+ gates `canOpenURL`), so it gets a real two-option popover: Google
Maps directly, or Android's own OS-level "Open with" chooser via the
generic `geo:` URI (`NavApp = "geo"`) — letting a non-Google app (Waze etc.)
stay reachable without enumerating installed apps ourselves.

**UI:** `components/ui/navigate-button.tsx` (`NavigateButton`) is the single
shared trigger + popover, in three variants:
- `"sticky"` — full-width primary button in `PlaceDebugSheet`'s footer,
  above the existing close button. The main placement: reachable regardless
  of scroll position, given more visual weight than the Website/Phone icons
  since "can I get there" is central to this app's purpose.
- `"icon"` — small icon in `PlaceCard`'s existing footer link row.
  Deliberately the lucide `Navigation` compass glyph, **never** `Map`/pin —
  that shape is already used one icon over by the Google-Maps-*search* link
  (`googleMapsHref`, opens a search, not directions); a second pin-like icon
  there would be indistinguishable from it.
- `"labeled"` — pill button with icon + text, `AmenityCard`'s footer (the
  🅿/🚻 quick-search results). `AmenityCard` has no detail sheet at all, so
  there's no sticky-footer surface to push this into instead — the footer
  row is the only placement candidate, hence the heavier labelled treatment
  there instead of a bare icon.

The map's parking/toilet marker popups (`MapView.tsx`, hand-built HTML +
`L.DomEvent.on` bindings — **not** React, `NavigateButton` cannot be reused
there) get their own, simpler treatment: "Navigate here" is now the
popup's permanent primary CTA slot (`POPUP_CTA`), demoting the Google-Maps-
search / Wheelmap links that used to occupy it into the secondary
`POPUP_LINKS` row underneath. No in-popup chooser here even on Android —
the popup is short-lived (closes on pan/zoom) and too narrow for a picker,
so it always calls `startDefaultNavigation` directly.

Every surface targets the coordinate of the specific thing being navigated
to — a `Place`'s own `coordinates`, or an `AmenityFeature`'s own `lat`/`lon`
(for a venue-hosted WC, the toilet's own point, not the venue's).

### Geocoding API routes

Proxy routes forward to external geocoding services (all restricted to DACH):
- `GET /api/geocode?q=` — Nominatim forward geocoding; returns `{ lat, lon, displayName }`. Accepts optional `?lat=&lon=` to bias results via a ±0.2° viewbox (`bounded=0` so it falls back globally).
- `GET /api/geocode/unified-suggest?q=&lang=` — **the active autocomplete route**: one Photon call without layer restriction, classified into `kind: "area" | "venue"` via `osm_key`/`type` (streets excluded); returns max 3 areas + 5 venues, areas first. Accepts optional `?lat=&lon=` bias (validated, forwarded to Photon). Photon often omits `countrycode` for POIs — the filter is `if (cc && !DACH_CODES.has(cc))` (only hard-exclude explicit non-DACH), trusting the bbox for geographic containment.
- `GET /api/geocode/suggest?q=&lang=` and `GET /api/geocode/place-suggest?q=&lang=` — the legacy area-only / POI-only autocomplete routes, superseded by `unified-suggest` (kept live for one release, no longer called by the UI).
- `GET /api/geocode/reverse?lat=&lon=` — Nominatim reverse geocoding; returns `{ district }` for the "Nearby" label.

The `countrycodes=de,at,ch` constraint in Nominatim calls and the Photon bounding box must both be updated when expanding beyond DACH.

### Rate limiting & production details

Endpoint contracts (`/api/raw`, `/api/image/google`, `/api/stats`, `/api/nearby-parking`, `/api/report-parking`, `/api/health`), the place-photo fallback chain, Vercel Analytics events, and the GlitchTip wiring → **[docs/architecture/api-routes.md](docs/architecture/api-routes.md)**. The non-obvious invariants that bite if violated:

- **Rate limits** — `/api/search`: 10 searches/min per IP, 3/min for Google Places; reset on cold start (single-instance only).
- **`raw` stripping** — production strips `raw` from `sourceRecords` (`stripRaw()`) and allowlists `metadata` (`METADATA_WHITELIST`); a new adapter must set **both** `raw` and `metadata` or the info sheet shows nothing in prod.
- **GlitchTip flush** — the streaming search route **must** `await Sentry.flush(2000)` before `controller.close()` (`flushAndClose`); on Vercel Fluid the instance freezes when the response ends and drops queued events. `withSentryConfig` is deliberately **not** used (webpack-only, breaks Turbopack).
- **Stats are fire-and-forget per source** — `trackCall`/`trackError`/`trackDuration` run inside each adapter's `.then`, never after `Promise.all` or from `safeRun`, keeping `fetchAllSources` side-effect-free for ISR.

### Local SEO pages (`app/[city]/[category]/` and `app/en/[city]/[category]/`)

ISR landing pages for 32 DACH cities × 10 categories × 2 locales = **640 potential routes**, rendered **lazily on first request** (`generateStaticParams` returns `[]`; DE revalidate 5 days, EN 5.5 days to stagger). Data comes from `fetchPlacesForSeoPage` in `lib/seo-search.ts` (calls `fetchAllSources` directly, applies `FILTERS_STRICT`, top 25); config in `lib/cities.ts`; rendering in `components/seo/SeoPageContent.tsx`; validity gating via `lib/seo-validity.ts` + `seo-validity.json` (feeds the sitemap). Full route config, the `lib/cities.ts` lookup tables, the two deep-link flows (SEO→app, info-sheet copy-link), and validity safety rules → **[docs/architecture/seo-pages.md](docs/architecture/seo-pages.md)**.

### Static pages

`app/faq/page.tsx` — FAQ page, rendered statically. Contains bilingual content (DE/EN inline, not via the i18n system). `app/impressum/page.tsx` — Legal notice; includes obfuscated contact email to avoid scraping. `app/datenschutz/page.tsx` — Privacy policy (Datenschutzerklärung). `app/ueber-uns/page.tsx` and `app/en/about/page.tsx` — "Über die App" / "About" marketing page; bilingual pair using the same inline-content pattern as FAQ (no `LocaleProvider` i18n).

The EN routes use **localised slugs** distinct from the DE paths (set up in v3.85): `app/en/legal-notice` (↔ `/impressum`), `app/en/about` (↔ `/ueber-uns`), `app/en/privacy` (↔ `/datenschutz`), plus `app/en/faq`. When adding or renaming a static page, update both the DE and EN slug and the hreflang/canonical metadata on each.

### Accessibility (WCAG)

The app targets **WCAG 2.2 AA** and is itself an accessibility product, so keep it exemplary. Full phased plan + honest limits in **[docs/wcag-accessibility-plan.md](docs/wcag-accessibility-plan.md)**.

- **Automated gates (CI: `.github/workflows/accessibility.yml`, on every push/PR):** `npm run test:a11y` runs `vitest-axe` against rendered components in `__tests__/a11y/` (jsdom → **structural** subset only: names/roles/labels/ARIA; **not** contrast/reflow/focus-visibility). `npm run check:contrast` (`scripts/check-contrast.mjs`) computes WCAG contrast for the `:root` design tokens in `globals.css` and **fails the build** on a sub-threshold pair. The `border` token is report-only (decorative). When adding new component a11y coverage, append to the `__tests__/a11y/` suite.
- **Modals** use the shared `hooks/useFocusTrap` (focus in on open, Tab-trap, Escape closes, focus restored to trigger): `PlaceDebugSheet`, `SettingsSheet`, `bottom-sheet`. All are `role="dialog" aria-modal aria-labelledby`. New modal/sheet → use this hook.
- **Landmarks:** desktop + mobile shells and all static pages wrap content in `<main id="main-content">`; the search bar is `role="search"`; footers are `<footer>`; a skip link (`common.skipToContent`) is the first focusable element (uses `focus-visible:` so it only shows on keyboard nav, not programmatic focus after navigation).
- **Live regions:** `ResultsList` has an sr-only `role="status" aria-live="polite"` announcing search progress/outcome; error banners are `role="alert"`.
- **Design tokens** (`globals.css`): `--card-border` (slightly darker card edge), `--primary-strong` (darker on-brand blue for primary-coloured **text** on light/tinted backgrounds, where `--primary` only hits 4.50:1). Composited contrast over map tiles/photos and reflow/zoom are **not** statically checkable — human/AT testing only.
- **Map:** Leaflet markers aren't individually keyboard-focusable; the conformant path is the **equivalent alternative** — the fully keyboard/AT-operable `ResultsList`. The map container is a labelled `role="region"` pointing at it. Don't over-invest in marker keyboard nav.
- **i18n invariant (reinforced):** every visible **and** assistive string (`alt`, `aria-label`, announcements) goes through `lib/i18n` (DE+EN) — no hardcoded UI text.
- **Accessibility statement** lives as a FAQ section ("Barrierefreiheit dieser App" / "Accessibility of this app"), not a separate page. A PR a11y checklist is in `.github/pull_request_template.md`.

### PWA / Service Worker

`app/sw.ts` + `@serwist/next`. The service worker is **disabled in development** (`disable: process.env.NODE_ENV === "development"` in `next.config.ts`).

**`NetworkOnly` for API routes** — `/api/search`, `/api/nearby-parking` and `/api/raw` are explicitly excluded from runtime caching via a `NetworkOnly` handler. Serwist's default `NetworkFirst` has a 10 s timeout; Overpass queries regularly exceed this, causing the SW to fall back to a stale or empty cache entry (manifests as "no parking spots" in the installed PWA). Do not add these routes back to `defaultCache`.

**CSP**: `next.config.ts` defines the `Content-Security-Policy` header. **Any new external domain** — whether a new API, CDN, or map tile server — requires adding it to the appropriate directive (`connect-src` for fetch/XHR, `img-src` for images). Forgetting this causes silent failures in production.

## Versioning

`APP_VERSION` in `lib/config.ts` — bump on **every commit** (established convention; the commit message carries the version as a `(vX.Y)` suffix). Shown in the Impressum alongside `BUILD_DATE`, which is auto-injected by `next.config.ts` at build time (`new Date().toISOString().split("T")[0]` → `"YYYY-MM-DD"`). `BUILD_DATE` is a build-time env var — it is set automatically, never manually configured.

## Environment variables (server-side only)

All optional unless noted; a source with a missing key is silently skipped.

- `ACCESSIBILITY_CLOUD_API_KEY` — accessibility.cloud source.
- `REISEN_FUER_ALLE_API_KEY` / `REISEN_FUER_ALLE_API_BASE` — RfA source (both required together; e.g. base `https://api.reisen-fuer-alle.de/v1`). Access: DSFT/Natko at reisen-fuer-alle.de (non-commercial on request).
- `GOOGLE_PLACES_API_KEY` — Google Places source.
- `GINTO_API_KEY` — Ginto GraphQL source (Swiss-focused). Contact support@ginto.guide.
- `GINTO_GEOFENCE=1` — restrict Ginto to searches that can reach the CH bbox (off by default; emergency brake against rate limits).
- `ACCESLIBRE_API_KEY` — AccèsLibre (FR); only active in international mode with the search centre in France.
- `SKIP_NEARBY_ENRICHMENT=1` — internal flag used by `scripts/check-seo-validity.ts` to skip the parallel disabled-parking fetch during bulk validity checks (avoids doubling Overpass load). Not a user-facing toggle; parking/toilet fetches are always-on in production.
- `HEALTH_CHECK_SECRET` — required to activate `GET /api/health` and `GET /api/stats` (no/`?token=` mismatch → 401; unset → both 503).
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — Upstash Redis for adapter stats; absent → `lib/stats.ts` is a no-op, `/api/stats` returns 503.
- `OVERPASS_ENDPOINTS` — comma-separated Overpass URL override (retains the parallel race). Mirror-selection forensics (which public mirrors are dead/blocked, the DACH/intl split) → `docs/overpass-server.md`.
- `OVERPASS_PRIVATE_KEY` — shared secret sent as `X-AP-Key` **only** to the private endpoint (`overpassHeaders()` in `lib/adapters/osm.ts`); inert when unset. Lockout-free rollout order → `docs/overpass-server.md`.
- `NOMINATIM_ENDPOINT` — private Nominatim base URL (trailing slash stripped); applies to all three geocode routes + the search pipeline.
- `GITHUB_REPORT_TOKEN` — GitHub token for `POST /api/report-parking`; absent → endpoint returns 503.
- `NEXT_PUBLIC_SENTRY_DSN` — GlitchTip DSN; absent or in dev → error reporting silently disabled (`instrumentation.ts` + `instrumentation-client.ts`).
- `NEXT_PUBLIC_UMAMI_WEBSITE_ID` — Umami Cloud site ID; when set, `lib/analytics.ts` dual-emits `track()` events (with `platform`) to Umami alongside Vercel. CSP needs `cloud.umami.is` in `script-src` and `gateway.umami.is` in `connect-src` (data endpoint). Context: `docs/analytics-alternatives.md`.
- `NEXT_PUBLIC_UMAMI_SRC` — override the Umami script URL (default `https://cloud.umami.is/script.js`); update the CSP if pointing at a new host.

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

## Capacitor Android & iOS apps

The app ships as an Android APK and an iOS app (Capacitor shells wrapping the deployed web URL) in addition to the PWA. The native shells live in `android/` and `ios/` (both checked in). Runbooks: `docs/capacitor-android-setup.md` and `docs/capacitor-ios-setup.md`. Both use the same remote-URL approach, the same `appId` (`org.accessibleplaces.app`), and the same `lib/native/*` code; they diverge only in the native projects and their store pipelines. **iOS is live on the App Store** (`https://apps.apple.com/de/app/accessible-places-app/id6781726948`, App ID `6781726948` — also used for the `apple-itunes-app` Smart App Banner meta tag in `app/layout.tsx`). Android is in Play Store Closed Testing (see the Android runbook for rollout status).

**`lib/native/geolocation.ts`** — platform-aware wrapper around `@capacitor/geolocation`. Call `getCurrentPosition()` from this module instead of `navigator.geolocation` directly. On `Capacitor.isNativePlatform() === true` it checks/requests OS permissions and uses the native plugin; in the browser it falls back to `navigator.geolocation`. The plugin is dynamically imported to keep it out of the web bundle's critical path.

**`lib/native/browser.ts`** — `openExternalUrl(url)` opens external links via `@capacitor/browser` (Chrome Custom Tabs / SFSafariViewController) on native, `window.open` in the browser. Falls back to `window.open` gracefully if the plugin is missing (old APK). Use this instead of `window.open` for external links.

**Critical invariant (`isFirstVisit`):** the welcome-screen / auto-locate gate must be initialised from `localStorage` in a layout effect (not from React state derived after mount). A `useState` init that reads `localStorage` races with Capacitor's WebView cache on cold start — the welcome screen flashes or auto-locate fires incorrectly. See commit `2294867` for the fix pattern and `#418` for the original race.
