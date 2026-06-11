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

No LLM is used at runtime (despite the name, `lib/llm.ts` does no model inference). `parseQuery()` deterministically extracts `locationQuery` (for Nominatim) and `categories` (from `CATEGORY_HINTS` regex match). `extractQuotedName()` pulls text inside any quote style (straight, curly, guillemets) and is used by `ChatPanel` to populate `nameHint` when the user wraps a name in quotes. The name filter is entirely separate — it is passed as `nameHint` in the API body and applied server-side after all adapter results are merged.

### Adapters (`lib/adapters/`)

Five adapters run in parallel via `startAdapterTasks()`:
- **OSM** (`osm.ts`): Overpass query raced in parallel across 2 mirror endpoints via `Promise.any()` — first successful response wins, loser is aborted. `[timeout:12]` in QL + `AbortSignal.timeout(20_000)` client-side. 429/5xx throws immediately so the race can resolve. `AggregateError` is unwrapped to `err.errors[0]` when both fail.
- **accessibility.cloud** (`accessibility-cloud.ts`): A11yJSON-shaped records. Always uses `accessibilityPreset=at-least-partially-accessible-by-wheelchair`.
- **Reisen für Alle** (`reisen-fuer-alle.ts`): Highest reliability weight (1.0). Hidden from FilterPanel UI (not in `SOURCE_ORDER`) but always active when the key is set.
- **Ginto** (`ginto.ts`): GraphQL API (`POST https://api.ginto.guide/graphql`), Switzerland only (all results have `countryCode: "CH"`). `defaultRatings[].key` prefix convention maps to A11yValue: no prefix → entrance, `toilet_` → toilet, `parking_` → parking. Paginates up to 2 pages (100 results). Base weight 0.90; SELF_DECLARED entries use 0.94, AUDITED entries use 1.0 (via `qualityInfo.approvalLevels` — who vouches for the data: operator vs. external authority). `qualityInfo.detailLevels` measures data completeness, not trustworthiness — stored in `metadata` only, never affects the weight. `updatedAt` is a system republish timestamp, not a human verification date — stored in `metadata` only, never sets `verifiedRecently`. AUDITED also does not set `verifiedRecently` (no audit date in the API).
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

Only 10 of these have SEO landing pages (`SEO_CATEGORY_SLUGS` in `lib/cities.ts`): cafe, restaurant, bar, pub, biergarten, hotel, museum, theater, cinema, attraction. The other six — `fast_food`, `hostel`, `apartment`, `library`, `gallery`, and `ice_cream` — are search-only (the first five had SEO pages until they were removed as chip-less categories in `67a2622`; old URLs now 404).

### Matching & merging (`lib/matching/`)

`match.ts` – a candidate place is considered the same as an existing canonical place when a weighted score exceeds `MATCH_SCORE_THRESHOLD = 0.72`. The formula is:

```
effectiveName × 0.5 + addrScore × 0.3 + geoScore × 0.2
```

where `addrScore = streetTrigram × 0.6 + cityMatch × 0.25 + zipMatch × 0.15`. A fast reject fires when distance > 3 × `GEO_MATCH_RADIUS_M` (240 m). Name containment (one normalised name substring of the other within 80 m) raises the effective name score to ≥ 0.9.

`merge.ts` – winning `A11yValue` is determined by summed source reliability weight. Toilet confidence is boosted to 1.0 when `isDesignated` or `hasGrabBars` is true; capped at 0.9 for weaker toilet signals. The `computeFilteredConfidence()` function averages criteria that are either active or have a non-unknown value — active-but-unknown criteria are included in the denominator so that enabling `acceptUnknown` doesn't artificially inflate scores to 100%. `passesFiltersForSource(place, sourceId, filters)` answers "would this place pass if only this one source were active?" — used by `FilterPanel` to show a predictive per-source result count. Note: `seating` is an optional criterion — not all adapters populate it, so `Place.accessibility.seating` may be `undefined`.

`passesFilters` treats both `"yes"` and `"limited"` as passing for any active criterion. This is intentional: `"limited"` (eingeschränkt) means potentially usable, not inaccessible. Only `"no"` fails; `"unknown"` fails unless `acceptUnknown` is true.

`nearby-parking.ts` – post-merge enrichment controlled by the `ENABLE_NEARBY_PARKING` flag. `enrichWithNearbyParking()` upgrades `parking.value` from `"unknown"` to `"yes"` with `details.nearbyOnly = true` when a disabled-parking OSM node (capacity:disabled > 0 or parking_space=disabled) is found within `DEFAULT_MAX_NEARBY_PARKING_M = 250 m`. Deliberately does **not** add a `SourceAttribution`, so confidence and per-source filter counts are unaffected. Confidence is set to `NEARBY_PARKING_CONFIDENCE = 0.75` (matches the OSM reliability weight). Map display uses a wider `NEARBY_PARKING_DISPLAY_RADIUS_M = 500 m`: parking markers are shown near any enriched result within this radius, even if slightly too far to trigger enrichment. This file also exports `dedupeToiletFeatures()` (collapses WC duplicates within `TOILET_DEDUP_RADIUS_M = 25 m`, preferring strong tier then standalone host) and `TOILET_DISPLAY_CAP = 300` — see the Amenities section below.

**`parkingNearby`** (`SearchFilters.parkingNearby`) — sub-toggle that only matters when `parking: true`. When `false`, the parking filter accepts only places with on-site parking attribution and rejects `nearbyOnly` enriched places. Default `true` preserves legacy behaviour (nearby enrichment counts as passing). Controlled by an explicit checkbox in `FilterPanel`.

**`parkingNearby`** is the parking-specific filter sub-toggle; the broader display/focus machinery is now generalised across amenity types — see the **Amenities** section below.

### Amenities: parking + WC (`lib/amenities/`, `osm.ts`, `nearby-parking.ts`)

Both disabled parking and wheelchair WCs are modelled as **typed point features** rather than place attributes. `AmenityType = "parking" | "toilet"`, `AmenityTier = "strong" | "weak"` (replaces the old `ParkingTier` "disabled"/"accessible"), and `AmenityFeature` (in `lib/types.ts`) carries `amenityType`, `tier`, `osmId`, plus type-specific fields (`capacity`/`fee`/`maxstay` for parking; `euroKey`/`changingTable`/`host` for WCs). `lib/amenities/registry.ts` declares per-type properties incl. `enrichesVenue` (parking `true`, toilet `false`). `ParkingSpot` remains as a structural alias for back-compat.

**Fetching — `fetchOsmAccessibleAmenities(location, radiusKm, types[], opts)`** in `osm.ts` builds one Overpass union query over the requested types. Parking clauses are identical to the older `fetchOsmDisabledParking` (kept as a thin wrapper for `seo-search.ts`, parking-only). WC clauses are a **union of two sources**: ① standalone public toilets (`amenity=toilets` + `wheelchair=yes|designated`) → `host.kind = "standalone"`; ② any venue tagging its own WC (`nwr[toilets:wheelchair=yes|designated]`, `access!=private/no`) → `host.kind = "venue"` with `name`/`access` for popup labelling. `parseAmenityFeatures` infers `amenityType` + `tier` from tags (designated → strong, yes → weak). Query ends `out 1000 center tags`.

**WC enrichment is deliberately absent.** Unlike parking (you park nearby and walk in), a WC 200 m away is not "the venue's WC" — `enrichWithNearbyParking()` filters to `amenityType === "parking" && tier === "strong"`, so a place's `toilet.value` is never changed by a nearby WC marker.

**Dedup + payload cap.** The ① standalone and ② venue clauses can return the same physical WC twice (also node + parent way). `dedupeToiletFeatures()` (25 m radius) runs in **both** `/api/nearby-parking` and `/api/search`. `/api/search` additionally dedups, distance-sorts to the search centre, and slices to `TOILET_DISPLAY_CAP = 300` so a dense 5 km search doesn't ship ~1000 markers per response. The merged result event field is `amenitySpots: AmenityFeature[]` (toilets); parking still ships as `parkingSpots`.

**Focus mode (`focusLayers: Set<AmenityType>` in `HomeClient`)** — generalises the old boolean "Parkplatz-Modus". The `[🅿 Parkplätze] [🚻 WCs]` chips in `ChatPanel`'s nearby info row are **single-select** (parking XOR toilet); `handleToggleFocusLayer` aborts any in-flight fetch via `focusAbortRef`, then fetches the chosen layer from `/api/nearby-parking` within `settings.parkingRadiusKm`. `focusSpots` is separate state (no backup/restore ref). `focusHints` holds per-layer "none found" amber text; `focusLoadingLayer` drives the per-chip spinner (only the latest request clears it). While `focusActive` (`focusLayers.size > 0`), place markers hide and the map-layer pills are disabled.

**Map display tiers & gating.** Parking strong tier = blue "P"; weak tier = amber "P" (dark letter — white-on-amber fails contrast); weak is **display-only** (never enriches/filters), gated client-side by `showWeakParking`. WC marker colour encodes **host** (not tier): standalone = green, venue = violet. `visibleParkingSpots`/`visibleToiletSpots` in `HomeClient` resolve focus-vs-passive source and apply `showWeakParking` (parking) / `publicToiletsOnly` (WCs, restricts to `host.kind === "standalone"`). `MapView`'s bottom-left **layer-pill control** (`🅿`/`🚻`, two independent `onSetMapLayers(parking, toilets)` toggles) drives the passive layer; the bottom-right **collapsible legend** lists only the marker types currently present.

**Popup XSS rule.** Map popups are built with `innerHTML`. **Any OSM-sourced string** (place name, address, `fee`, `maxstay`, WC `host.name`) must be wrapped in the local `esc()` helper before interpolation — OSM is publicly editable. i18n strings and numbers are trusted.

`buildAttribute(…, weightMultiplier)` — when `weightMultiplier > 1.0` the source gets `verifiedRecently: true`. Currently only the OSM adapter sets this (via `check_date:wheelchair` ≤ 2 years old). The `onlyVerified` filter in `SearchFilters` requires at least one attribution to carry this flag.

### Confidence weights (`lib/config.ts`)

```ts
reisen_fuer_alle:    1.00
ginto:               0.90  // SELF_DECLARED entries → 0.94, AUDITED → 1.0
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

**Marker clustering** — place markers are grouped via `leaflet.markercluster`. `PLACE_CLUSTER_MAX_RADIUS = 50 px` controls grouping radius; clustering is disabled at zoom ≥ `PLACE_CLUSTER_DISABLE_AT_ZOOM = 17` (street level, every pin always visible). Cluster icons use the same confidence-colour scheme as individual pins and are styled with custom CSS classes (`ap-cluster`, `ap-cluster-sm/md/lg`). The default Leaflet.markercluster theme is replaced entirely — do not import its default CSS.

**MapView effect ordering invariant** — two `useEffect`s in `MapView.tsx` must not race when a "show on map" button switches the mobile tab and sets `selectedId` in the same render: the *selection effect* (`deps: [selectedId, panTrigger, mapReady]`) runs `zoomToShowLayer` + `openPopup`, while the *visibility effect* (`deps: [visible, isFullscreen]`) runs a `setTimeout(50 ms)` that calls `fitBounds` on all results. The visibility effect checks `selectedId` first and returns early (showing the selected marker instead) so it never overwrites the selection zoom. Do not remove or reorder that guard — the symptom is the popup flashing briefly then vanishing as the map zooms back out to show all results.

**CSS stacking context invariant**: the desktop map container div has `isolation: isolate` (`<div className="flex-1 min-h-0 relative isolate">`). Leaflet injects pane z-indexes of 200–700 directly; without isolation these leak into the page stacking context and paint over ChatPanel (`z-20`), hiding autocomplete dropdowns. `isolate` traps all Leaflet z-indexes inside the map container. Do not remove it.

**Filter/source/radius persistence** — `HomeClient.tsx` persists the active filter criteria, source toggles, and radius to `localStorage` via a `useEffect` (guarded by `prefsLoadedRef` so the initial load effect fires first and the persist effect never overwrites saved prefs with defaults). `alwaysShowParking` and `alwaysShowToilets` are intentionally excluded from the filter-prefs key — they are persisted separately via `AppSettings`. `handleReset` restores defaults and writes them back, so the stored value self-heals on reset.

**Welcome / onboarding screen** — first-time visitors see a welcome screen instead of the normal UI. Controlled by `isFirstVisit` in `HomeClient`, initialised lazily: `true` when neither `ap_visited` nor `ap_welcome_dismissed` is set in `localStorage`. Dismissing via "Nicht mehr anzeigen" sets `ap_welcome_dismissed` and optionally triggers a nearby GPS search. The normal `ap_visited` key is set on any regular search. Both keys can be cleared via `onResetOnboarding` in `SettingsSheet` (gear icon → Reset → reset onboarding). The welcome UI lives inside `MobileLayout` and `ChatPanel`, not in a dedicated component.

### User settings (`lib/settings.ts`)

`AppSettings` is a user-configurable set of defaults persisted to `localStorage` under key `ap_settings`. `useSettings()` returns `[settings, updateSettings]`; `loadSettings()` is called in lazy `useState` initialisers in `HomeClient` for settings that must be available before React mounts.

Fields: `defaultSearchMode` (`"text"` | `"nearby"` | `"place"` | `null` = no preference), `defaultMobileView` (`"results"` | `"map"`), `defaultChipIdx` (which chip is pre-selected, `null` = Restaurants), `sortOrder` (`"confidence"` | `"distance"`), `autoZoom` (MapView auto-fits after search), `alwaysShowParking` / `alwaysShowToilets` (passive map-layer display toggles, default `false`; persisted here, **not** in the filter-prefs key, and excluded from it in `HomeClient`), `showWeakParking` (show the weak parking tier as amber markers, incl. in focus mode; default `false`), `publicToiletsOnly` (restrict the WC layer to standalone public toilets, hiding venue WCs; default `false`), `parkingRadiusKm` (radius for the amenity focus fetch — parking **and** WC — 0.05–5.0, default 4.0).

**Critical invariant:** `SETTING_CHIPS` in `lib/settings.ts` and `CHIPS` in `ChatPanel.tsx` must stay in the **same order** — `defaultChipIdx` is an index into both simultaneously. Reordering chips in either file requires updating the other.

`SettingsSheet` (`components/settings/SettingsSheet.tsx`) renders via `createPortal` and is triggered from a gear icon in `HomeClient`. It receives `settings` and `onUpdate`; `HomeClient.handleUpdateSettings` applies the patch and syncs derived state (e.g. propagates `sortOrder` → `sortBy`).

### Name filter & place search (ChatPanel → API)

The name field is a separate input, **not** embedded in the query string. `ChatPanel.onSearch` signature: `(query: string, coords?: Coords, nameHint?: string)`. The `nameHint` is passed in the API request body and applied as a JS post-filter (`filterByNameHint` — substring + trigram ≥ 0.6) after the merge step. This means accessibility filters apply independently of name searches.

**Place-search mode** (`placeSearch: true` on `SearchParams`) is a second path for looking up a specific venue by name without city/category. Triggered either via the explicit `"place"` chat mode (third tab: "Ort suchen" / "Find Place") or from text mode when the name field is filled and the location field is empty (power-user shortcut).

`HomeClient.handlePlaceSearch(nameHint, preResolvedCoords?)` flow:
1. If Photon autocomplete provided coordinates, skip Nominatim and use them directly
2. Otherwise resolve a location: `searchCenter` → `gpsCoordRef` → `navigator.geolocation` (5 s timeout, 60 s cache) → Nominatim with optional viewbox bias
3. If Nominatim returns 404: sets `place_not_found` error. If the stream completes with zero places: sets `place_no_data` error (distinct states).
4. If exactly one result: auto-selects it (opens the info sheet)

**OSM adapter** in `placeSearch` mode replaces the tag-based Overpass query with a name-regex query across node/way/relation within 500 m. Uses character-class case-insensitive regex (`[hH][oO][tT]...`) — not the `,i` flag which is broken on some Overpass mirrors. Radius is capped at 0.5 km server-side regardless of user setting. Other adapters are unchanged; they search by bbox and the `nameHint` post-filter applies as usual.

**`skipNameSuggestRef`** (ref in ChatPanel) — one-shot flag set in `selectNameSuggestion` before calling `setName()`, consumed at the top of the name-suggestion `useEffect`. Prevents the debounced Photon fetch from re-firing (and re-showing the dropdown) immediately after a suggestion is selected. Same pattern as `skipSuggestRef` for the location field.

**`chatMode` union** — `"text" | "nearby" | "place"`. In `place` mode: `FilterPanel` is hidden on desktop (HomeClient), the filter tab is hidden on mobile (MobileLayout), and `switchMode("place")` clears the location field so the name-suggestion `useEffect` fires unconditionally. `defaultSearchMode` in `AppSettings` and `SettingsSheet` also accept `"place"`.

### Supplementary Place fields

`Place` carries optional fields that adapters populate beyond wheelchair data:

- `allowsDogs` / `dogPolicyOnly` — sourced from supplementary A.Cloud datasets (e.g. Pfotenpiloten). Records that arrive as `dogPolicyOnly: true` are dropped by the search route **unless** they merge with a place that has real wheelchair data. Once merged the flag is cleared (`undefined`).
- `isVegetarianFriendly` / `isVeganFriendly` — from OSM `diet:vegetarian|vegan=yes/only` or Google Places types `vegetarian_restaurant` / `vegan_restaurant`. `vegan=true` implies `vegetarian=true` (set automatically during merge).
- `wheelmapUrl` — authoritative Wheelmap.org URL from `accessibility.cloud`'s `infoPageUrl`; preferred over a constructed link.
- `gintoUrl` — Ginto detail page URL from `publication.linkUrl`; shown as ShieldCheck icon in PlaceCard when present.

### Geocoding API routes

Four proxy routes forward to external geocoding services (all restricted to DACH):
- `GET /api/geocode?q=` — Nominatim forward geocoding; returns `{ lat, lon, displayName }`. Accepts optional `?lat=&lon=` to bias results via a ±0.2° viewbox (`bounded=0` so it falls back globally).
- `GET /api/geocode/suggest?q=&lang=` — Photon/Komoot autocomplete restricted to `layer=city,district,locality`; returns `[{ display, name }]`. Used by the location field.
- `GET /api/geocode/place-suggest?q=&lang=` — Photon/Komoot POI autocomplete **without** layer restrictions; returns `[{ display, name, lat, lon }]`. Used by the name field. Accepts optional `?lat=&lon=` to bias results toward last-known coordinates (forwarded to Photon's `lat`/`lon` bias params). Requests 20 candidates, deduplicates, slices to 5. Photon often omits `countrycode` for POIs — the filter is `if (cc && !DACH_CODES.has(cc))` (only hard-exclude explicit non-DACH), trusting the bbox for geographic containment.
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

`GET /api/health?token=SECRET` — token-protected E2E health check. Live mode runs a real OSM search (Cafés, Berlin Mitte, entrance + toilet filter). Mock mode (`?mock=1`) runs fixture data through the real pipeline without external calls — suitable for load testing. Google Places is hardcoded off. Ginto is hardcoded off (CH-only, separate concern). Returns 200/503 with structured JSON.

### Local SEO pages (`app/[city]/[category]/` and `app/en/[city]/[category]/`)

ISR landing pages for 32 DACH cities × 10 categories × 2 locales = **640 potential routes**. `generateStaticParams` returns `[]` and `dynamicParams` is left at the default `true` — pages render **lazily on first request** (no build-time pre-rendering). Unknown slugs fall through to `notFound()` after a `CITY_MAP`/`SEO_CATEGORY_SLUGS` lookup at the top of the page component. The DE route uses `export const revalidate = 432000` (5 days); the EN route uses `Math.round(5.5 * 24 * 3600)` (5.5 days) to stagger revalidation across locales. Data is fetched live at render time via `fetchPlacesForSeoPage(...).catch(() => [])` — if the fetch fails the page renders with an empty list rather than erroring, and the ISR stale copy is served until the next successful revalidation.

**City/category configuration — `lib/cities.ts`:**
- `CITIES` — 32 cities with slug, nameDe, nameEn, country, lat, lon. `CitySlug` union type must be kept in sync with this array.
- `SEO_CATEGORY_SLUGS` — URL slug → `Category` type (all 10 current slugs are identical to their `Category` value). `SEO_CATEGORY_TO_SLUG` is the reverse.
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

### Static pages

`app/faq/page.tsx` — FAQ page, rendered statically. Contains bilingual content (DE/EN inline, not via the i18n system). `app/impressum/page.tsx` — Legal notice; includes obfuscated contact email to avoid scraping. `app/datenschutz/page.tsx` — Privacy policy (Datenschutzerklärung). `app/ueber-uns/page.tsx` and `app/en/about/page.tsx` — "Über die App" / "About" marketing page; bilingual pair using the same inline-content pattern as FAQ (no `LocaleProvider` i18n).

The EN routes use **localised slugs** distinct from the DE paths (set up in v3.85): `app/en/legal-notice` (↔ `/impressum`), `app/en/about` (↔ `/ueber-uns`), `app/en/privacy` (↔ `/datenschutz`), plus `app/en/faq`. When adding or renaming a static page, update both the DE and EN slug and the hreflang/canonical metadata on each.

### PWA / Service Worker

`app/sw.ts` + `@serwist/next`. The service worker is **disabled in development** (`disable: process.env.NODE_ENV === "development"` in `next.config.ts`).

**`NetworkOnly` for API routes** — `/api/search` and `/api/nearby-parking` are explicitly excluded from runtime caching via a `NetworkOnly` handler. Serwist's default `NetworkFirst` has a 10 s timeout; Overpass queries regularly exceed this, causing the SW to fall back to a stale or empty cache entry (manifests as "no parking spots" in the installed PWA). Do not add these routes back to `defaultCache`.

**CSP**: `next.config.ts` defines the `Content-Security-Policy` header. **Any new external domain** — whether a new API, CDN, or map tile server — requires adding it to the appropriate directive (`connect-src` for fetch/XHR, `img-src` for images). Forgetting this causes silent failures in production.

## Versioning

`APP_VERSION` in `lib/config.ts` — bump on every meaningful release. Shown in the Impressum alongside `BUILD_DATE`, which is auto-injected by `next.config.ts` at build time (`new Date().toISOString().split("T")[0]` → `"YYYY-MM-DD"`). `BUILD_DATE` is a build-time env var — it is set automatically, never manually configured.

## Environment variables (server-side only)

- `ACCESSIBILITY_CLOUD_API_KEY` — optional; source is silently skipped if absent
- `REISEN_FUER_ALLE_API_KEY` — optional; source is silently skipped if absent. Request access from DSFT/Natko at reisen-fuer-alle.de (non-commercial use available on request).
- `REISEN_FUER_ALLE_API_BASE` — base URL for the RfA API (e.g. `https://api.reisen-fuer-alle.de/v1`); required alongside the key
- `GOOGLE_PLACES_API_KEY` — optional; source is silently skipped if absent
- `ENABLE_NEARBY_PARKING=1` — feature flag; enables the disabled-parking enrichment fetch in both the main `/api/search` route and SEO pages (off by default). When active, a parallel OSM fetch for disabled-parking nodes runs alongside the venue adapters and the results are used for enrichment and `parkingSpots` map markers.
- `ENABLE_NEARBY_TOILETS=1` — feature flag; enables the wheelchair-WC fetch in `/api/search` (passive map layer) and `/api/nearby-parking` (focus mode). Independent of `ENABLE_NEARBY_PARKING`. Off by default. WCs are display-only (never enrich a place's `toilet.value`). **Both flags must be set in the Vercel production env** to be live there — they are not inferred from anything; a missing flag silently disables that layer for all users.
- `GINTO_API_KEY` — optional; Ginto GraphQL API (Swiss accessibility data, CH only). Contact support@ginto.guide. Source silently skipped if absent.
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
