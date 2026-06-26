# API routes, rate limiting & production details

## Rate limiting

`/api/search` applies in-memory sliding-window rate limits per IP: 10 searches/min general, 3/min for Google Places. These reset on serverless cold start — not suitable for multi-instance without a shared store.

## `raw` stripping in production

In production, `raw` adapter response data is stripped from `sourceRecords` before the response is sent (see `stripRaw()`); `metadata` is additionally reduced to a per-source key allowlist (`METADATA_WHITELIST` in `app/api/search/route.ts` — only `osm` and `google_places` have entries; others collapse to `{}`). In development the raw data is preserved for debugging. Adapters must also populate `SourceRecord.metadata` (a plain object mirroring the key fields from `raw`) so the info sheet can display data in production — all five adapters do this. When adding a new adapter, always set both `raw` and `metadata`.

`GET /api/raw?source=&id=&lat=&lon=&cat=` — on-demand full-`raw` lookup for the `PlaceDebugSheet` "raw data" block. Since the search payload ships no `raw` (above), the sheet lazy-loads the complete upstream object for **one** source record on expand: the route re-queries that single adapter at the place's own coordinates (0.5 km radius), matches by `externalId`, and returns `{ raw }`. Rate-limited (30/min), `NetworkOnly` in the service worker, geo-gates bypassed (`international: true`) so any existing record can be re-fetched.

## Error reporting (GlitchTip)

`instrumentation.ts` (server) and `instrumentation-client.ts` (client) initialize `@sentry/nextjs` pointed at the self-hosted GlitchTip instance at `logs.accessible-places.org`. GlitchTip speaks the Sentry ingest protocol. Enabled only in production when `NEXT_PUBLIC_SENTRY_DSN` is set. Performance tracing is off (`tracesSampleRate: 0`). **Critical invariant:** `withSentryConfig` wrapper is deliberately not used — it is webpack-only and breaks the required Turbopack build. Do not add it.

**GlitchTip flush invariant:** the search route captures Sentry events (#1 unhandled crash, #2 all-sources-failed, #3 unexpected-adapter-error) from inside the streaming `ReadableStream`. It **must** `await Sentry.flush(2000)` before `controller.close()` (via the `flushAndClose` helper) — on Vercel Fluid/serverless the instance can be frozen the moment the response ends, dropping queued-but-untransmitted events. `flush()` is a cheap no-op when nothing was captured. The client (`HomeClient`) has its own 45 s overall search deadline (`SEARCH_TIMEOUT_MS`): a stalled stream aborts and surfaces `t.chat.errorTimeout` (tagged `reason: "timeout"` in the client-side Sentry capture) instead of spinning forever.

## Place photo

`GET /api/image/google?photoName=` — proxy for Google Places photo URLs. Validates `photoName` against `places/*/photos/*` pattern (SSRF guard), then calls the Places API with `skipHttpRedirect=true` and returns `{ url }` JSON with a 24 h / 7-day SWR cache header. Requires `GOOGLE_PLACES_API_KEY`.

**Place photo** (`PlaceDebugSheet`) — loaded client-side with priority: (1) Google Places via `/api/image/google` (only if Google source is active); (2) OSM `image` tag — `File:…` → Wikimedia Commons `Special:FilePath`, `http…` → direct; (3) OSM `wikimedia_commons` tag; (4) Wikidata P18 claim (fetched from the Wikidata API using the OSM `wikidata` tag). All are best-effort; no photo shown if all fail.

## Analytics & stats

**Vercel Analytics** (`@vercel/analytics`) — `track()` fires custom events from `HomeClient`: `search` (mode, result_count), `search_no_results` (mode, radius_km), `place_not_found` (reason: `no_data` | `not_found`), `filter_apply` (criteria), `parking_shown`. No PII is sent. **Vercel Speed Insights** (`@vercel/speed-insights`) — the `<SpeedInsights />` component is mounted once in `app/layout.tsx` (root) for Core Web Vitals reporting.

`GET /api/stats?token=SECRET` — token-protected adapter usage stats (requires `KV_REST_API_URL`). `lib/stats.ts` tracks per-source call counts, error counts, and response time (min/max/avg) in Upstash Redis using hour-granularity keys (`stats:h:<metric>:<sourceId>:<YYYY-MM-DDTHH>`) with a 90-day TTL. `trackCall`, `trackError`, and `trackDuration` are called fire-and-forget from `app/api/search/route.ts` **per source, inside each adapter's `.then`** (the `wrapped` array) as it settles — **not** after `Promise.all` and **not** from `safeRun`. Running them per-source (rather than gated behind the slowest adapter) means a slow/hanging source can't also suppress the other sources' stats and the GlitchTip alerts (#3 unexpected-adapter-error fires there too). This also keeps `safeRun` and `fetchAllSources` side-effect-free so they can be called safely from ISR pages (a `no-store` Upstash fetch inside an ISR page would demote it to dynamic at runtime).

## Amenity routes

`GET /api/nearby-parking?lat=&lon=&radius=&types=` — despite the legacy path, serves **both** amenity types via `?types=parking,toilet` (default `parking`). Radius 0.05–25 km (default 0.3; max raised from 5 to match the OSM helper so the focus "search this area" can cover a zoomed-out viewport). Toilets are dropped unless `ENABLE_NEARBY_TOILETS=1`. Validates coordinates, rate-limits (20/min), dedups WCs, and sets `Cache-Control: no-store` on Overpass failure (a blip must not poison the 5-min CDN window). Used by the **amenity search** (chips); the passive map layer's spots arrive via the `result` event of `/api/search`, not this route.

**Amenity "search this area"** — during an amenity search, `MapView` shows a persistent top-centre button that re-fetches the active amenity type at the **current map centre** with a radius derived from the visible viewport (centre→corner), via `onFocusSearchHere(center, radiusKm)` → `handleAmenitySearchHere` → `handleAmenitySearch`. This is deliberately separate from the venue `onSearchHere` machinery (avoids the fragile pan-detection invariant). `focusSearchCenter` (= `amenityPanned`, null = anchored at the origin) is threaded to MapView: when set, the map-fit is **skipped entirely** so the map stays where the user put it. On mobile the amenity results appear as list cards + markers, so the Results/Filter tabs stay fully usable (no tab-gating, unlike the removed focus mode).

`POST /api/report-parking` — user reports a weak-tier (amber) parking marker as a likely dedicated disabled spot (button in the MapView popup). Creates a GitHub issue in this repo via `GITHUB_REPORT_TOKEN` with OSM/iD-editor links for manual tag review. Rate-limited 5/min per IP; returns 503 when the token is not configured.

## Health check

`GET /api/health?token=SECRET` — token-protected E2E health check. Live mode runs a real OSM search (Cafés, Berlin Mitte, entrance + toilet filter). Mock mode (`?mock=1`) runs fixture data through the real pipeline without external calls — suitable for load testing. Google Places is hardcoded off. Ginto is hardcoded off (separate concern). Returns 200/503 with structured JSON.
