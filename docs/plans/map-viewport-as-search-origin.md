# Map viewport as search origin (Concept A + D)

**Status:** implemented (v9.5, 2026-06-28). See "Implementation notes" at the end.
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

---

## Implementation notes (v9.5)

Built with a prior risk analysis; three deviations from the plan above, all to
reduce risk:

1. **Signal = the "search here" pill, not a separate "has panned" flag (R1/R3).**
   MapView's new `onViewportChange` fires from the *same* effect that drives the
   pill (`searchHereCenter && !focusMode`), so the reported viewport origin and the
   visible pill are in lockstep by construction — they can never diverge. The
   cold-map gate is therefore NOT re-implemented: MapView's existing `moveend`
   handler only sets `searchHereCenter` when `searchCenterRef` is set (i.e. the map
   has been positioned by a search/GPS), so a cold/default-overview map reports
   `null` and the chip falls through to its old origin chain. No `hasPositioned`
   param was needed — one source of truth instead of two.

2. **Origin resolved in `HomeClient`, read lazily by `ChatPanel` (R6).** The live
   viewport lives in `HomeClient`'s `viewportRef` (a ref, not state — `moveend` is
   high-frequency, but the value is only read at chip-click time). `ChatPanel` gets
   a stable `getViewportOrigin()` callback (reads the ref → no re-render churn) and
   keeps the precedence decision (it knows typed/nearby state). The clamp/snap is a
   pure helper (`venueViewportOrigin` / `amenityViewportOrigin` in `lib/search-ui`).

3. **Scope cut for the amenity-focus case (R2).** While an amenity search is
   *running*, `focusMode` suppresses MapView's pan signal, so `getViewportOrigin()`
   returns `null` and an in-focus chip re-select keeps using "search this area".
   Viewport origin therefore applies when *entering* a venue/amenity search (the
   common case: pan in venue results → pick a chip), not while one is active.

**Precedence ordering:** the concrete wiring slots from sections 3/4 were followed
(viewport branch *after* typed/nearby, *before* `activeSearchCoords`), which places
viewport just below an active GPS nearby fix — a deliberate, documented choice that
overrides the abstract "2 above 3" line in "Target behaviour".

**Radius write-back (R7):** venue path syncs the 1–50 km slider in `HomeClient`'s
`onSearch` wrapper; amenity path snaps + persists `parkingRadiusKm` inside
`handleAmenitySearch`, gated on `radiusKmOverride != null && panned` (the viewport /
"search this area" signature) so the plain chip and FilterPanel-slider paths are
untouched. Reuses the existing `snapAmenityRadiusKm` / clamp helpers.

**Files touched:** `MapView.tsx` (`onViewportChange` prop + report from the pan
effect), `lib/search-ui.ts` (`clampVenueRadiusKm`, `venueViewportOrigin`,
`amenityViewportOrigin`, `ViewportOrigin`), `HomeClient.tsx` (`viewportRef`,
`getViewportOrigin`, `onSearch`/amenity write-back, MapView/ChatPanel wiring),
`ChatPanel.tsx` (viewport branches in `selectChip`/`selectAmenity`, widened
callbacks), `MobileLayout.tsx` (prop pass-through), tests in
`__tests__/lib/search-ui.test.ts`. No new i18n strings (reuses the pill).

**Not statically verifiable** (needs manual/AT testing — the pan signal is
time-window + threshold based and not reproducible in jsdom): the actual pan→chip
flows, that programmatic recenters (locate / SEO deep-link / autoZoom fit) don't
arm a viewport origin, and that typed-location still wins over a pan.

## Follow-up fix (v9.7): "Hier suchen" button did not exit nearby mode

**Symptom (reported):** start in nearby mode (GPS results), pan the map, click the
**"Hier suchen" button**, then pick a venue chip → the map snapped back to the GPS
position instead of refining the searched (panned) area.

**Cause:** the viewport-origin work made the *chip-on-pan* path exit nearby
(`ChatPanel.selectChip` → `exitNearbyState`), but the symmetric *button* path
(`HomeClient.handleSearchHere`) did not. After the explicit "search here", the
pan-pending state clears (`viewportRef` → null, no pill), yet `chatMode` stayed
`"nearby"` with a live `nearbyPhase` GPS fix. The next `selectChip` hit the
`mode === "nearby" && nearbyPhase` branch (above the `activeSearchCoords` branch)
and re-ran at the GPS coords.

**Fix:** `handleSearchHere` bumps a new `exitNearbyTrigger` counter; a `useEffect`
in `ChatPanel` calls `exitNearbyState()` on the bump (mirrors `locateTrigger`).
Once nearby is left, the chip pick falls through to the `activeSearchCoords` branch
and refines the panned area. Files: `HomeClient.tsx` (`exitNearbyTriggerKey` +
bump in `handleSearchHere`), `ChatPanel.tsx` (`exitNearbyTrigger` prop + effect +
`exitNearbyStateRef`), `MobileLayout.tsx` (pass-through). Test in
`__tests__/components/ChatPanel.test.tsx`.
