# Plan: Reduce Vercel Fluid Active CPU usage

Status: **planned, not implemented** (2026-10-06)

## Context

The project is approaching the Hobby plan's Fluid Active CPU limit. Active CPU
only bills time the function is actually executing — awaiting Overpass,
Nominatim, Photon or Redis is free. So the cost drivers are server-side React
rendering, parsing large JSON payloads, and CPU-bound loops — not the number of
upstream calls per se.

Per-route metrics are not available on Hobby (`vercel metrics` requires
Observability Plus; `vercel usage` returns 404), so the ranking below is a
code-based estimate and **Phase 0 must confirm it before anything is built.**

Candidate measures (from the analysis):

| # | Measure | Expected CPU effect | Risk | Priority |
|---|---------|--------------------|------|----------|
| 1 | Serve `/` and `/en` statically, deep links via rewrite to a dynamic route | High (likely largest consumer: every page view, every native-app cold start, every bot) | Medium | 2 |
| 2 | Spatial grid + precomputation in `findMatch` | Medium, unverified (synthetic: 59 ms @ 2000, 134 ms @ 3000 places per search) | Low with differential test | 3 (only if Phase 0 justifies it) |
| 3 | Make `/api/nearby-parking` CDN-cacheable | Low / uncertain hit rate | Low | 4 (optional) |
| 4 | CDN cache headers on geocode routes | Low CPU, fewer invocations | Very low | 1 |

## Guiding rules

- One measure per commit, per deployment, per `APP_VERSION` bump — so any
  regression in GlitchTip/analytics can be attributed to exactly one change.
- Every phase ships with its own automated guard (test or build check); the
  guard is written **before** the change and must fail against a deliberately
  broken implementation once (proves it actually guards something).
- Each phase is verified on the Vercel preview deployment before merging to
  `main`. Rollback = Vercel Instant Rollback to the previous deployment.
- Standard gates per commit: `npm test`, `npx tsc --noEmit`, `npm run lint`,
  `npm run test:a11y`.

---

## Phase 0 — Measure (no behaviour change)

Goal: know which function actually burns the CPU, so phases with no payoff
(and therefore pure risk) can be dropped.

1. Vercel dashboard → **Usage → Fluid Active CPU**: read the per-function
   breakdown for the current billing period (visible on Hobby). Record the
   shares of `/` (+ `/en`), `/api/search`, `/api/nearby-parking`,
   `/[city]/[category]`, geocode routes.
2. Optional, short-lived instrumentation in `/api/search`: log
   `performance.now()` deltas around step 5 (match & merge) and around the
   adapter JSON parsing, plus `places.length` per source. Inspect via
   `vercel logs` for a day, then remove.
3. Check external callers: is any uptime monitor hitting `/api/health`
   (which queries all sources)? If so, point it at `/api/ping` or reduce the
   interval.
4. Check bot traffic share on `/` and SEO pages (Vercel Analytics / Firewall
   overview).

**Decision gate:** reorder or drop phases 1–4 based on the numbers. Phase 2 is
only implemented if match & merge is a meaningful share of `/api/search` CPU.

**Risk:** none (read-only; temporary logs must not include user coordinates
beyond what is already logged — log counts and durations only).

---

## Phase 1 — Cache headers for geocode routes (measure #4)

Routes: `app/api/geocode/route.ts`, `app/api/geocode/reverse/route.ts`,
`app/api/geocode/unified-suggest/route.ts` (legacy `suggest`/`place-suggest`
optional — no longer called by the UI).

### Change

- Add a small helper (e.g. `lib/http-cache.ts`) exporting the header values,
  so policy lives in one place:
  - success (200): `public, max-age=0, s-maxage=86400, stale-while-revalidate=604800`
    (browser revalidates, CDN caches; Nominatim's usage policy explicitly asks
    for caching)
  - "not found" (404 `location_not_found`): short CDN TTL, e.g. `s-maxage=300`
  - everything else (400, 429, 5xx, timeouts, `geocoding_unavailable`):
    `no-store`
- Optionally round the `lat`/`lon` bias parameter of `unified-suggest`
  client-side (e.g. 2 decimals ≈ 1 km) to avoid cache fragmentation.

### Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Transient upstream failure (429/timeout) cached → users see "geocoding unavailable" for hours | Cache header set **only** on the success branch; explicit `no-store` on every other branch. Unit test per route asserting the header for success and for **each** error branch (mock `fetch` → 200, 404, 429, 500, throw). |
| A newly added error branch later forgets `no-store` | Default to `no-store` and only opt **in** on success (helper returns success headers only via an explicit call). |
| Cache key misses a variant (`lang`, `intl`, bias) → wrong-language or wrong-region suggestions | All variants are query parameters, which are part of Vercel's CDN cache key by default. Preview check: same `q` with `lang=de` vs `lang=en`, `intl=1` vs none → `x-vercel-cache` MISS for each first call. |
| Rounding the bias changes suggestion order slightly | Only round to ≈1 km; bias is soft anyway. Can be skipped entirely if undesired. |
| Stale geodata | OSM place names/coordinates change rarely; 1-day TTL is acceptable. |

### Verification

- Unit tests in `__tests__/api/` for the three routes (headers per branch).
- Preview: `curl -sI` twice for the same URL → second response
  `x-vercel-cache: HIT`; an error case → no `HIT`.

Residual risk: very low.

---

## Phase 2 — Static home page with rewrite for deep links (measure #1)

### Why the rewrite approach (and not reading params client-side)

`HomeClient` consumes `initialCity`, `initialCategory`, `initialSelectLat/Lon`
in **lazy `useState` initialisers and first-render logic**:
`quickstartCityCategory` (HomeClient.tsx:245), `deepLinkForcesExpert` (:257),
`chatMode` (:316), and the session-restore gates (:542 ff., :570, :608, :617).
If those props were only available after mount, the first render would run the
non-deep-link path (wrong mode, wrong auto-search, session restore firing on a
deep link) — the same class of boot-timing bug as #418 and the v10.31–v10.37
native deep-link fixes. The rewrite approach keeps the props byte-identical for
every deep link and only changes how plain `/` is served.

Pre-check done: `app/layout.tsx` and `app/en/layout.tsx` use no dynamic APIs;
only the two `page.tsx` files (`headers()` + `searchParams`) make the route
dynamic.

### Change

1. Create a dynamic deep-link route per locale that renders the current page
   logic (props from `searchParams`), e.g. `app/link/page.tsx` and
   `app/en/link/page.tsx` (name to be chosen; must not collide with
   `[city]/[category]` — single segment is safe). Shared implementation in one
   module so both entry points cannot drift.
2. `next.config.ts` → `rewrites()` returning `{ beforeFiles: [...] }`
   (**must** be `beforeFiles`: plain-array rewrites run *after* the filesystem
   check, so `/` would never be rewritten). One entry per trigger parameter,
   because `has` items are AND-ed:
   - `source: "/"`, `has: [{ type: "query", key: "q" }]` → `/link`
   - same for `cat`, `selectLat`, `selectLon`, `selectName`
   - same five for `source: "/en"` → `/en/link`
   The original query string is preserved on rewrite (to be verified on the
   preview, see below).
3. `app/page.tsx` / `app/en/page.tsx`: drop `searchParams` and `headers()`;
   render `HomeClient` with no deep-link props. Optionally
   `export const dynamic = "error"` so Next fails the build if anything
   dynamic is ever reintroduced (verify this option's semantics in
   `node_modules/next/dist/docs/` first).
4. Country for the international hint (`initialCountry`): see open decision
   D1. The hint is already effect-gated (`intlHintDismissed` starts `true`),
   so moving the detection client-side cannot cause a hydration mismatch.
5. Deep-link route metadata: `robots: { index: false }`, canonical pointing to
   `/` resp. `/en` (same as today).

### Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| A deep-link parameter not covered by a rewrite rule → link opens the plain start screen | Rule list derived from the single `Props` type of the shared page module; unit test asserting every deep-link prop key has a matching rewrite (import the config's `rewrites()` in a test). Manual matrix below covers each link shape. |
| Rewrite placed in `afterFiles` by mistake → never applies | Use the `{ beforeFiles }` object form; preview test of each link shape. |
| Query string not forwarded to the rewrite target | Verify on preview: deep link must render the linked place/city; a test page logging received props during the preview check if needed. |
| Unknown params (`utm_*`, `fbclid`) → static page | Intended: those are ignored by `HomeClient` today too. |
| Page silently becomes dynamic again later (CPU saving lost without any error) | CI step: parse `next build` output and fail unless `/` and `/en` are listed as `○` (Static). Plus `dynamic = "error"` if confirmed suitable. |
| Native apps (iOS/Android) load `/` from CDN: behaviour change on cold start | Native place links never used SSR props anyway (HomeClient.tsx:318, :1582 ff. — handled client-side via the App URL listener); boot effects are unchanged. Covered by the manual native matrix. |
| Stale HTML after deploy | Vercel purges the CDN on deploy; static pages are served with `max-age=0, must-revalidate`. Native WebView cache issue is pre-existing (app restart after deploy). |
| `/link` indexed as duplicate content | `noindex` + canonical; `/link` added to `robots.ts` disallow. |
| Country detection semantics change (see D1) | Explicit decision; hint is non-critical and dismissible. |
| SEO pages' "open in app" deep links (`[city]/[category]` → `/?q=&cat=`) break | Part of the manual matrix; also covered by the rewrite unit test. |

### Verification

Automated:
- Rewrite coverage unit test (above).
- Build-output check for `○ /` and `○ /en`.
- Existing `HomeClient.test.tsx` still passes unchanged (props contract
  unchanged).

Manual matrix on the preview URL (desktop browser, mobile browser, iOS app,
Android app — the native apps can be pointed at the preview only if the shell
supports it; otherwise run the native part right after production deploy with
rollback ready):

| Case | Expected |
|------|----------|
| First visit (cleared storage) | Welcome screen, no flash of the main UI |
| Returning visit | Session restore works, correct mode (Quickstart/Expert) |
| `/?q=Berlin&cat=cafe` | Quickstart city/category results (or Expert fallback per rules) |
| `/?q=Berlin&cat=museum` | Expert fallback |
| `/?selectLat=…&selectLon=…&selectName=…` | Place opens |
| Combined SEO shape (`q`+`cat`+`selectLat/Lon`) | Place opens, 250 m cap respected |
| Same set under `/en` | Same, English UI, `<html lang="en">` |
| SEO page → "open in app" link | Correct results |
| iOS/Android cold start, quick actions (parking/WC), App Links | Unchanged behaviour |
| Non-DACH access (VPN) | International hint per D1 |
| `curl -sI /` | `x-vercel-cache: HIT` on second request, no function invocation |

Residual risk: medium — mainly the manual native coverage. Option: add a small
Playwright suite for the deep-link matrix first (see D3).

---

## Phase 3 — Faster matching in `/api/search` (measure #2)

**Only if Phase 0 shows match & merge is a relevant CPU share.**

### Change

- In `lib/matching/match.ts`, add an index structure used by the search route
  loop (`app/api/search/route.ts:422–429`):
  - grid keyed by cell, cell size ≥ `3 × GEO_MATCH_RADIUS_M` (= 240 m, the
    fast-reject distance), longitude cell width scaled by `cos(lat)`;
  - lookup scans the 3×3 neighbourhood;
  - candidates are evaluated in **ascending canonical index** order so the
    strict-`>` tie-break picks the same index as today.
- Precompute per canonical place only values that never change after
  insertion: normalised name and name trigrams. `mergePlaces` does not modify
  `coordinates` or `name`, but **does** fill missing address fields
  (`merge.ts:138–142`), so address-derived values are either not cached or
  recomputed on merge.
- Keep the old `findMatch` signature working (tests, `seo-search.ts`), or move
  both callers to the new API in the same commit.

### Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Different dedup result on score ties (order dependence) | Ascending-index evaluation; differential test (below) asserts identical output including order. |
| Stale cached address normalisation after merge | Do not cache address values (or invalidate on merge); covered by differential test with fixtures where a later source fills a missing address. |
| Matches lost across cell boundaries / at high latitudes | Cell size ≥ fast-reject radius, cos(lat) scaling; property-based test with points placed near cell edges, incl. latitudes up to the northern edge of the supported countries. |
| `seo-search.ts` uses a different code path and diverges | Both callers use the same function; SEO test suite must pass. |
| Optimisation brings no real gain | Phase 0 gate; benchmark against recorded real payloads before merging. |

### Verification

- **Differential test**: keep the current implementation as
  `findMatchReference` in the test file. Run old vs new merge pipeline over
  recorded real adapter outputs (fixtures: Berlin all categories, Zürich,
  rural Austria, a dense Overpass response near `out 2000`) and assert
  deep-equal canonical lists (same order, same merged sources).
- Property-based test: ~10 000 random synthetic sets, including clustered
  points and points on cell boundaries; assert old == new.
- Existing matching tests unchanged and green.
- Before/after benchmark on the fixtures, numbers recorded in the PR.

Residual risk: low (best automatically verifiable phase).

---

## Phase 4 — CDN-cacheable `/api/nearby-parking` (measure #3, optional)

Expected hit rate is low (GPS and "search here" coordinates are rarely
identical); do this only if Phase 0 shows the route is a large CPU share.

### Change

- Remove `uid`/`pf` from the URL (HomeClient.tsx:1417–1421). Count the amenity
  search separately (see D2).
- Round `lat`/`lon` client-side relative to the radius: step ≤ 10 % of the
  radius (e.g. 0.05 km radius → ~5 m; 4 km → ~400 m, capped). Implemented as a
  pure, unit-tested helper.
- Raise `s-maxage` (parking/WC data changes slowly), e.g. 3600 +
  `stale-while-revalidate`; shorter TTL for empty-but-successful results
  (e.g. 60 s).

### Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Usage stats undercount (CDN hits skip `trackUserSearch`) | D2: dedicated tracking beacon, or accept and annotate the stats. Compare search counts for the week before/after. |
| Rounding shifts small-radius searches → missing spots | Radius-relative rounding with unit tests at the smallest preset (0.05 km) and the largest (5 km). |
| Empty response from an incomplete mirror cached for an hour | Short TTL for empty results; failures already `no-store`. |
| Distance shown from the rounded instead of the real centre | Client keeps using the unrounded `searchCenter` for distance; only the request is rounded. Test that `distanceM` uses the real centre. |

Residual risk: low; benefit uncertain.

---

## Open decisions

- **D1 — Country detection for the international hint** after Phase 2:
  (a) client-side from `Intl.DateTimeFormat().resolvedOptions().timeZone`
  (zero server cost; wrong for VPN users / manually fixed time zones), or
  (b) a tiny `/api/geo` returning `x-vercel-ip-country`, called once per device
  and stored in `localStorage` (keeps IP semantics; one cheap invocation per
  new device).
- **D2 — Amenity search counting** after Phase 4: separate beacon vs. accepted
  undercount.
- **D3 — Playwright** for the deep-link/boot matrix before Phase 2
  (one-off setup, permanent protection for the most fragile area of the app)
  vs. manual matrix only.

## Rollout order

Phase 0 → Phase 1 → Phase 2 → (Phase 3 if justified) → (Phase 4 if justified).
After each production deploy: watch GlitchTip for new issues and compare
search/app-open counts (Umami / Vercel Analytics) with the previous days for
48 h before starting the next phase. Rollback via Vercel Instant Rollback.

## Docs to update when implemented

- `CLAUDE.md`: home page rendering model (static + deep-link rewrite), cache
  policy of the geocode routes, matching index.
- Fix the stale revalidate note: `[city]/[category]` uses
  `revalidate = 2592000` (30 days), while `CLAUDE.md` and the page comment say
  5 days.
