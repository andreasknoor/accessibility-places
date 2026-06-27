# Local SEO pages (`app/[city]/[category]/` and `app/en/[city]/[category]/`)

ISR landing pages for 32 DACH cities × 10 categories × 2 locales = **640 potential routes**. `generateStaticParams` returns `[]` and `dynamicParams` is left at the default `true` — pages render **lazily on first request** (no build-time pre-rendering). Unknown slugs fall through to `notFound()` after a `CITY_MAP`/`SEO_CATEGORY_SLUGS` lookup at the top of the page component. The DE route uses `export const revalidate = 432000` (5 days); the EN route uses `Math.round(5.5 * 24 * 3600)` (5.5 days) to stagger revalidation across locales. Data is fetched live at render time via `fetchPlacesForSeoPage(...).catch(() => [])` — if the fetch fails the page renders with an empty list rather than erroring, and the ISR stale copy is served until the next successful revalidation.

**City/category configuration — `lib/cities.ts`:**
- `CITIES` — 32 cities with slug, nameDe, nameEn, country, lat, lon. `CitySlug` union type must be kept in sync with this array.
- `SEO_CATEGORY_SLUGS` — URL slug → `Category` type (all 10 current slugs are identical to their `Category` value). `SEO_CATEGORY_TO_SLUG` is the reverse.
- `SEO_CATEGORY_TO_CHIP_IDX` — slug → CHIPS array index in ChatPanel (all 10 SEO categories have a chip equivalent). The "Related categories" section on SEO pages **only shows chip-backed categories** — both for UX consistency and because those categories have a pre-select chip when the user lands on the main app.
- `SEO_CATEGORY_QUERY_TERM` — slug → `{ de, en }` query string recognisable by `parseQuery()`. Used for the auto-search trigger on the home page.
- `SEO_CATEGORY_LABEL` — plural display labels used in page headings and navigation chips.
- `CITY_MAP` — `Map<CitySlug, City>` for O(1) lookup in page routes.

**Data fetching — `lib/seo-search.ts`:**
`fetchPlacesForSeoPage(lat, lon, category, radiusKm=5)` calls `fetchAllSources` directly (no HTTP round-trip). Fetches with all filters off (`acceptUnknown: true`) and `SEO_SOURCES` (excludes Google Places). Also fetches disabled-parking OSM nodes in parallel and runs `enrichWithNearbyParking()` before filtering (skipped when `SKIP_NEARBY_ENRICHMENT=1`, used by the SEO validity check script to halve Overpass load). After merging, always applies `FILTERS_STRICT` (entrance=true, toilet=true, acceptUnknown=false). Recomputes `computeFilteredConfidence` using these filters, sorts descending (tiebreaker: `name.localeCompare`), returns top 25.

**Rendering — `components/seo/SeoPageContent.tsx`:**
Server component shared by DE and EN routes. Includes Schema.org `ItemList` + `BreadcrumbList` JSON-LD, hreflang language switcher, related categories (chip-backed only — `SEO_CATEGORY_TO_CHIP_IDX !== undefined` — and filtered by `hasData`), and related cities (filtered by `hasData`). The confidence badge format matches the main app exactly: `"X% · Verlässlich/Mittel/Unsicher"` via `confidenceLabel()` from `merge.ts`. Source attribution names the active adapters (`"OpenStreetMap, accessibility.cloud, Ginto (CH)"`) — exclude adapters that require keys absent in the deployment. Place cards show entrance, toilet, and parking attributes (parking is only shown when its value is not `"unknown"`); the `nearbyOnly` parking case renders as `"Ja, in der Nähe (Xm)"`. External links (Wheelmap, Google Maps, website) are icon-only (`Accessibility`, `Map`, `Globe` from lucide-react).

**Validity data — `lib/generated/seo-validity.json` + `lib/seo-validity.ts`:**
A JSON file with 320 `citySlug/categorySlug → boolean` entries (plus a `_generatedAt` metadata key) that records which combinations actually have accessible places. Updated by `npm run check:seo` (or the daily GitHub Actions cron `.github/workflows/check-seo-validity.yml`). Safety rules: failed checks never overwrite an existing `true` (Overpass downtime cannot remove confirmed pages); the file is not written if < 50% of checks succeed. `hasData(citySlug, categorySlug)` defaults to `true` for unknown combos (conservative). `VALID_SEO_PATHS` is a `Set<string>` used by both the sitemap and `SeoPageContent`.

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
