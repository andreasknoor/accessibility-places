# Public API v1 (`/api/v1/*`)

Read-only JSON API built for an automated AI agent that cross-checks venue
accessibility with plain HTTPS GET requests (no JavaScript, no headers, no
auth flow). The agent-facing usage guide is served live at `GET /api/v1/docs`
(source: `lib/public-api/docs.ts`); the OpenAPI 3.1 spec at
`GET /api/v1/openapi.json` (`lib/public-api/openapi.ts`). This file covers
the decisions behind it.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /api/v1/places/lookup?name=&city=&address=&lat=&lon=&limit=` | Venue by name → best matches with `match_score` |
| `GET /api/v1/places/nearby?lat=&lon=&radius=&category=&wheelchair=&limit=` | Venues around a point, nearest first |
| `GET /api/v1/toilets/nearby?lat=&lon=&radius=` | Wheelchair toilets (default 100 m, max 500 m) |
| `GET /api/v1/places/{id}` | One venue (`osm:node:…` / `osm:way:…` / `osm:relation:…`) |
| `GET /api/v1/openapi.json`, `GET /api/v1/docs` | Spec + guide (no token needed — no data) |

## Data-source licensing (decided 2026-10-27)

Responses merge sources into one record, so the response is a *derivative
database* of OSM and must itself be ODbL (share-alike). Only ODbL-compatible
sources may enter it; `license: "ODbL-1.0"` and `attribution[]` are on every
response.

| Source | In the API? | Why |
|---|---|---|
| OpenStreetMap | ✔ | ODbL; attribution "© OpenStreetMap contributors" |
| Ginto | ✔ open-data entries only | Database under ODbL 1.0, commercial use allowed (ginto.guide/de/licence). Each entry carries `licenseInfo { license isOpenData attribution }` — the adapter now requests it and `isRepublishable()` drops entries with `isOpenData !== true` before merging. Live sample (Berlin 14, Zürich 50): all `isOpenData: true`, `license`/`attribution` empty. ⚠ The PDF "Nutzungsbedingungen ginto.guide" (about.ginto.guide/en/downloads) was not machine-readable — confirm once manually. |
| accessibility.cloud | ✘ | No API-consumer terms found; licences are per data source (many organisations). A non-ODbL-compatible record inside a merged ODbL response would breach share-alike. Re-enable only after Sozialhelden confirms terms, ideally as a filter on per-source licence. |
| Google Places | ✘ | Places policies forbid caching/storing anything but `place_id`; our 24 h CDN cache alone would violate that. (Side note, app not API: Google content is also not supposed to be shown on a non-Google map — the app renders it on MapLibre when the source is enabled.) |
| Reisen für Alle | ✘ | Contractual data (DSFT), access "non-commercial on request" — no redistribution right. |
| AccèsLibre | ✘ (n/a) | Licence Ouverte 2.0 would be compatible, but it is France-only and the API is DACH-scoped. |

The source set lives in `API_SOURCES` (`lib/public-api/constants.ts`).

## Access token

`PUBLIC_API_TOKENS` — comma-separated list (≥ 16 chars each), checked with a
constant-time compare. Unset → every data endpoint answers 503.

- **Separate from `HEALTH_CHECK_SECRET` on purpose**: that secret also authorises
  `DELETE /api/stats` (wipe all stats) and the top-users list, while this token
  travels in plain URLs (agent prompts, logs, request logs).
- **Query parameter only (`?token=`), never a header**: the CDN cache key is the
  URL. A header-authenticated response would be cached under a token-less URL
  and served to anyone.
- **Rotation**: add the new token, switch the consumer, remove the old one.
  Responses already cached under the old token's URLs stay servable until the
  cache entry expires (24 h + 7 d stale-while-revalidate) — redeploy to purge
  them immediately.

## Behaviour

- **Pipeline reuse**: `lib/place-pipeline.ts` `fetchAndMerge()` (adapters → match →
  merge → nearby-parking) is shared with `lib/seo-search.ts`; the streaming
  `/api/search` keeps its own copy because it interleaves events/stats.
  `lib/adapters/osm.ts` gained `raceOverpass()` (the endpoint race, extracted
  from `fetchOsm`) and `fetchOsmPlacesByQuery()`.
- **Lookup**: Photon candidates for `"<name> <address> <city>"` (≤ 3 anchors
  ≥ 300 m apart; caller's lat/lon wins; city-only 5 km fallback) → per anchor
  the app's place-search mode (OSM name regex + Ginto, 0.5 km) → drop
  non-venues (`isVenueTags`: bus stops, routes, taxi ranks, info boards,
  entrance nodes) → `match_score = 0.6·name + 0.25·proximity + 0.15·city`.
- **Conflicts**: the API returns the **most conservative** value
  (no < limited < yes) and lists all values in `conflicts[]`. This deliberately
  differs from the app, which picks the highest summed weight.
- **Confidence** maps the app's tiers (`criterionTier`): bestätigt → high,
  wahrscheinlich → medium, unsicher/none → low; any conflict → low.
- **Extra fields from raw OSM tags** (`lib/public-api/tags.ts`):
  `entrance_step_free` (step_count / ramp, plus entrance nodes on the building
  outline), `elevator` (elevator tags, highway=elevator nodes inside the area —
  needs Overpass areas, enabled on the private server), `surface_notes`,
  `description`. Entrance/elevator nodes are only fetched for lookup + detail.
- **API-only categories** `castle`, `garden`, `concert_hall`, `arts_centre`
  (no app chip): extra OSM query (`osm-extra.ts`) + tag recognition; the app's
  `Category` union is untouched.
- **Nearest toilet**: same query as `/toilets/nearby`, 500 m; `0` when the venue
  itself resolves to `toilet_wheelchair = yes`. On `/places/nearby` only for
  radius ≤ 1 km (the `out 1000` cap would truncate larger queries).
- **Partial failure**: per-source failures → `warnings[]`, HTTP 200, 5-min cache.
  Every configured source failed → 502. Upstream timeout 8 s.
- **Caching**: complete responses `public, s-maxage=86400,
  stale-while-revalidate=604800` (CDN; repeated agent runs never reach
  Overpass), errors `no-store`. The service worker never handles `/api/v1/*`
  (`NetworkOnly` in `app/sw.ts`).
- **Rate limit**: 60 req/min per IP — Upstash when configured, else
  in-memory; fails open. Redis keys hold a truncated SHA-256 of the IP, never
  the raw IP. No cookies, no request logging.
- **Coverage**: DACH only (coordinates outside → 400).

## Open points

- Ginto terms PDF — manual confirmation.
- accessibility.cloud — ask Sozialhelden about redistribution terms.
- Datenschutzerklärung: suggested addition — "Für die Nutzung der öffentlichen
  Programmierschnittstelle (/api/v1) wird die IP-Adresse ausschließlich in
  gehashter Form und für höchstens eine Minute zur Begrenzung der
  Anfragerate verarbeitet (Art. 6 Abs. 1 lit. f DSGVO)."
- OSM element `last_updated` is null — the adapter query does not request
  `out meta`; `last_verified` (check_date) is used instead.
