# Map viewport as search origin (Concept A + D)

**Status:** planned, not started
**Date:** 2026-06-28
**Goal:** When the user works primarily with the map — pans/scrolls to a new area
and *then* picks a category (venue chip or amenity chip) — the search should use
the **currently visible map viewport** as its reference (centre + radius), not the
stale origin of the previous search (`activeSearchCoords` / `gpsCoordRef`).

This combines:
- **Concept A (implicit map origin):** after a *real* user pan, the next chip
  selection uses the live viewport.
- **Concept D (visible signal):** never switch the origin silently — the existing
  "Hier suchen" pill (top-left, next to the count pill) is the visible cue that
  the next action refers to the visible area.

Rejected alternatives and the full UX/risk comparison live in the chat that
produced this plan; the short version: **C (invisible "last-interacted-surface"
heuristic)** was rejected for poor expectation-conformance, **B (explicit
"search as I move the map" toggle, Airbnb-style)** is kept as a *fallback* to add
later only if implicit behaviour proves surprising in practice.

---

## Current behaviour (the problem)

Three origin sources exist in parallel and none of them is the live viewport:

| Path | Origin used today | Code |
|---|---|---|
| Venue chip | `activeSearchCoords` (centre of *current results*) → else location text | `ChatPanel.selectChip` (≈ ChatPanel.tsx:609/619) |
| Amenity chip | typed loc → GPS fix → `searchCenter ?? activeSearchCoords` → auto-locate | `ChatPanel.selectAmenity` (ChatPanel.tsx:553) |
| Amenity dispatch | `coords ?? gpsCoordRef.current ?? gpsCoords` | `HomeClient.handleAmenitySearch` (HomeClient.tsx:827) |

The live map centre is only reachable through `onSearchHere` / `onFocusSearchHere`
(the explicit "Hier suchen" button). It is **never lifted to `HomeClient`** for
the chip handlers to read. Result: pan the map, pick a category → search re-runs
around the *old* origin. This is the unintuitive behaviour to fix.

Radius today: venue chip uses `radiusKm` (filter), amenity chip uses
`amenityRadiusKm` (filter). See `docs/architecture/matching.md` and the
`handleSearchHere` / `handleAmenitySearchHere` comments for the F4 "silent
override" finding that constrains radius changes.

---

## Target behaviour

1. **Origin priority** (highest first), applied uniformly to venue + amenity chips:
   1. **User-typed location** (`isUserTyped` in `selectAmenity`) — unchanged. Typing
      "Hamburg" while panned to Berlin still means Hamburg.
   2. **Live viewport — only if the user has manually panned since the last search**
      (the new behaviour). NEW.
   3. Active GPS fix (`nearbyPhase`) — unchanged.
   4. `searchCenter ?? activeSearchCoords` — unchanged fallback.
   5. Auto-locate — unchanged.
2. **Radius follows the origin:** when origin (2) wins, radius is viewport-derived
   (centre→corner), clamped (venue 1–50 km, amenity 0.05–5 km) and **written back**
   to the slider/settings, exactly like `handleSearchHere` /
   `handleAmenitySearchHere` already do. Otherwise radius is unchanged (filter).
3. **Visible signal (Concept D):** while a pending un-searched pan exists, the
   "Hier suchen" pill is shown (already implemented next to the count pill). It is
   the cue that "the next action searches the visible area". No silent switch.
4. **Cold-map / first-visit gate:** the viewport is *only* a valid origin once the
   user has positioned the map intentionally — i.e. a real search has happened or
   GPS has resolved. Never use the default DACH-overview viewport as an origin.

---

## Technical design

### 1. Lift the live viewport to `HomeClient`

Generalise the `onPanned` callback added in v9.4 (currently reports a "search here"
runner) into a viewport reporter. Two options — prefer **(a)**:

**(a) Ref-based reporter (no re-render):**
- New MapView prop `onViewportChange?: (v: { center: {lat,lon}, radiusKm: number, userPanned: boolean } | null) => void`.
- Fired from the **same pan-detection path** that already sets `searchHereCenter`
  (MapView.tsx ≈ 396) — so it reuses the `PROGRAMMATIC_MOVE_WINDOW_MS` time-window
  invariant and never reports programmatic recenters (autoZoom fit, locate pan,
  `center`-prop change) as user pans.
- `userPanned: true` only when `searchHereCenter` is set by a genuine `moveend`;
  reports `null` (or `userPanned:false`) when the pan state is cleared
  (`setSearchHereCenter(null)` on `center` change / after a search).
- `HomeClient` stores the latest value in a `viewportRef` (a `useRef`, NOT state —
  the chip handlers read `.current` at click time; avoids re-render churn on every
  `moveend`).

Keep the existing `onPanned` (mobile inline pill) — it can be derived from the same
internal effect, or `onViewportChange` can subsume it. Do **not** remove the
desktop centred "Hier suchen" button.

### 2. Helper: resolve the chip origin

Add a small pure helper (e.g. in `lib/search-ui.ts`) so the rule is tested in
isolation and shared by both chip paths:

```ts
// Returns the viewport origin iff the user has actively panned and the map is
// "real" (a search/GPS has positioned it). Else null → caller falls back to the
// existing origin chain.
resolveViewportOrigin(viewport, { hasPositioned }): { center, radiusKm } | null
```

- `hasPositioned` = `hasSearched || gpsResolved` (cold-map gate, item 4).
- Pure; unit-tested for: not panned → null; panned but cold map → null; panned +
  positioned → viewport.

### 3. Wire venue chip (`ChatPanel.selectChip`)

`ChatPanel` does not own the viewport. Two ways:
- **Preferred:** `HomeClient` injects the resolved origin. `selectChip` already
  calls `onSearch(query, coords)`. Add an optional `viewportOrigin` prop (or extend
  `activeSearchCoords` semantics) so that, when a pan is pending, `HomeClient`
  passes the viewport coords + a radius override down. Concretely: `HomeClient`
  owns `viewportRef`; pass `mapOrigin={resolveViewportOrigin(...)}` into `ChatPanel`
  and let `selectChip` prefer it over `activeSearchCoords` **but below
  `isUserTyped`**. Radius override travels via a new optional arg on `onSearch`
  (already supported downstream: `handleSearch(query, radiusKmOverride, coords, …)`).
- Insert the viewport branch in `selectChip` *after* the typed/nearby checks and
  *before* the `activeSearchCoords` branches (ChatPanel.tsx:603–628).

### 4. Wire amenity chip (`ChatPanel.selectAmenity` + `HomeClient.handleAmenitySearch`)

- In `selectAmenity`, insert the viewport branch **after** `isUserTyped` (line 527)
  and `nearbyPhase` object (542), **before** `known = searchCenter ?? activeSearchCoords`
  (553): if a viewport origin is available, `onAmenitySearch?.(type, vp.center, vp.radiusKm)`.
- `onAmenitySearch` / `handleAmenitySearch` already accept a `radiusKmOverride`
  (HomeClient.tsx:824) and a `panned` arg — pass the viewport radius (snapped +
  clamped via `snapAmenityRadiusKm`) and set `panned` so the map fit doesn't force
  the old origin back into view.

### 5. Radius write-back

When the viewport origin wins, mirror the existing handlers:
- Venue: `setRadiusKm(clamp(viewportRadius, 1, 50))` before/with the search.
- Amenity: `setAmenityRadiusKm(snapAmenityRadiusKm(viewportRadius))` +
  `updateSettings({ parkingRadiusKm })`.
This keeps the FilterPanel slider in sync (F4) so the user sees what was searched.

---

## Risks & invariants to respect

- **Pan-detection time window** (`docs/architecture/mapview.md`): reuse the existing
  `searchHereCenter` signal; do NOT add a raw `moveend` listener that could treat
  `autoZoom`/locate/`center`-prop recenters as user pans. This is the single
  highest-risk area.
- **autoZoom interaction:** after the search fires, MapView fits to results and the
  viewport changes — fine, because origin/radius are read at click time and written
  back. Verify the fit doesn't immediately re-arm a "pending pan" (it must be
  stamped programmatic).
- **Cold-map gate:** without item 4, a first-visit user could search the default
  DACH overview. Gate strictly on `hasSearched || gpsResolved`.
- **Typed-location precedence:** must stay above the viewport (selectAmenity's
  `isUserTyped`). A regression here breaks "type Hamburg while panned elsewhere".
- **SEO deep-links / programmatic recenters** (`programmaticLocRef`, locate pan,
  amenity pan): these set `center` programmatically → must report `userPanned:false`.
- **Mobile vs desktop:** desktop keeps the centred "Hier suchen" button; mobile uses
  the inline pill (v9.4). Both must reflect the same pending-pan state.

---

## Test checklist

Unit (`lib/search-ui` helper):
- not panned → null; panned + cold map → null; panned + positioned → viewport;
  radius clamps (venue 1–50, amenity 0.05–5).

Component / integration:
- Pan map → pick venue chip → search centred on viewport, radius = viewport (slider
  updates).
- Pan map → pick amenity chip → amenity search on viewport, ≤ 5 km.
- Type "Hamburg", pan to Berlin, pick chip → **Hamburg** wins (typed precedence).
- First visit (no search, no GPS) → pick chip → does NOT use default viewport.
- Programmatic recenter (locate / SEO deep-link / autoZoom fit) → NOT treated as a
  user pan; chip uses prior origin.
- After a viewport search, `radiusKm` / `amenityRadiusKm` reflect what was searched.

Always: `npm test`, `npx tsc --noEmit` (new optional props on `ActiveSources`-like
interfaces / MapView props), bump `APP_VERSION`.

---

## Files to touch

- `components/map/MapView.tsx` — generalise `onPanned` → `onViewportChange`; report
  centre+radius+userPanned from the existing pan-detection effect.
- `app/HomeClient.tsx` — `viewportRef`; resolve origin; pass into `ChatPanel`;
  radius write-back in the chip→search and chip→amenity paths.
- `components/chat/ChatPanel.tsx` — viewport branch in `selectChip` and
  `selectAmenity` at the documented priority slots.
- `lib/search-ui.ts` — `resolveViewportOrigin` helper (+ tests).
- i18n — only if any new visible string is added (Concept D reuses `t.map.searchHere`).

## Deferred (Concept B fallback)

If implicit behaviour proves surprising for field-primary users: add an
`AppSettings.searchAsMoveMap` toggle (default off), surfaced on the map, gating the
viewport-origin behaviour. Same plumbing as above, guarded by the flag.
