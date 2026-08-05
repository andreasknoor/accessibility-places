# MapViewGL (`components/map/MapViewGL.tsx`)

The MapLibre GL JS + OpenFreeMap implementation of the map, built as part of the migration tracked in [issue #48](https://github.com/andreasknoor/accessibility-places/issues/48). **Sole map implementation since the v12.0 cutover** (Phase 4, step 17) — `MapView.tsx` renders it directly, with no engine flag. The pre-migration Leaflet implementation (`MapViewLeaflet.tsx`), the `NEXT_PUBLIC_MAP_ENGINE` switch, `leaflet`/`leaflet.markercluster`, and the Leaflet-specific architecture doc it lived in (`mapview.md`) are all deleted; this file is the only map doc going forward. `MapViewProps` (`lib/map/types.ts`) is now this component's own prop contract, not a shared dual-engine one.

## Self-hosted worker (CSP)

`maplibre-gl`'s worker is self-hosted rather than spawned from a `blob:` URL, so the CSP `worker-src` directive can stay `'self'` with no `blob:` exception (a `blob:` worker is functionally close to `unsafe-eval`). Mechanism:

- `scripts/copy-maplibre-worker.mjs` (run via the `postinstall` npm script) copies **two** files from `node_modules/maplibre-gl/dist/` into `public/`: `maplibre-gl-worker.mjs` **and** `maplibre-gl-shared.mjs`.
- **Both files are required.** The worker script itself does `import ... from "./maplibre-gl-shared.mjs"` — copying only the worker file leaves that relative import 404ing inside the worker's own module graph. This failure is **silent**: no console error appears on the main thread (the failure happens in the worker's execution context), the map's `"load"` event simply never fires, and nothing renders. Found by constructing an isolated `maplibregl.Map` directly in a live browser session and observing `load` never fire even after 6+ seconds, then diffing the two files' own `import` statements.
- `lib/map/maplibre-worker.ts` calls `maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs")` once, before the first `Map` is constructed (`ensureMaplibreWorkerConfigured()`).
- Re-run the copy script (automatic via `postinstall`) after any `maplibre-gl` version bump, and re-check whether the worker's dependency list has grown (`grep -o 'from"\./[^"]*"' node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs`).

## Marker rendering — native symbol layers (R1)

Chosen over HTML markers + manual cluster sync (the other option considered in the migration plan) for GPU-scaled performance up to the OSM `out 2000` result cap, and because B.3's marker design (solid-fill teardrop, no gradients) rasterises cleanly.

- `lib/map/marker-images.ts` draws each unique marker combination to an offscreen canvas once, cached and registered via `map.addImage()`: venue pins keyed by `(category, confidence, selected)`, parking badges by `tier`, WC badges by `(host, euroKey)`.
- Places live in one GeoJSON source (`ap-places`) with native `cluster: true` — MapLibre clusters at the source level on the GPU, not via a DOM tree like `leaflet.markercluster`.
- Clusters are **not** rasterised — a plain `circle` layer (white fill, ring coloured by `clusterProperties: { maxConf: ["max", ["get", "confRank"]] }`) plus a `symbol` layer for the count text. This matches the Leaflet cluster's behaviour of colouring by the **best** (max) child confidence, not majority.
- Parking/WC spots are separate, non-clustered GeoJSON sources (`ap-parking`, `ap-toilets`) — matches Leaflet, which never clusters amenity markers either.

## Popups — unified "D" template + conditional recentring

`lib/map/popup-content.ts` builds one popup template (`buildVenuePopupHtml` / `buildParkingPopupHtml` / `buildToiletPopupHtml`) shared by venue/parking/WC popups, replacing the pre-migration full/reduced split. Ported from the local redesign prototype (`popupShellD`/`chipD`/`ctaD`), with plain Unicode glyphs (✓ ✗ ± ?) for criterion values instead of fabricated lucide SVG path data — the prototype used a runtime icon lookup unavailable here.

**Popup positioning** (`openSmartPopup()` in `MapViewGL.tsx`): the popup's `anchor` is fixed to `"bottom"` (always above the point, horizontally centred) instead of MapLibre's default `"auto"`, which picks whichever side has room and is what made popups feel like they appeared "somewhere" during prototyping. Before opening, `map.project(lngLat)` is checked against the container edges; **only if** the popup would be clipped does the map `easeTo` the point first — a marker already comfortably in view is not panned. This mirrors the same discussion that led to it for the local prototype, and is deliberately the "recentre only when necessary" variant, not "always recentre."

When a recentre does happen, the target is pushed as close to the **bottom** of the container as `margin` (16px) allows — not the viewport's exact vertical centre (only half the container height above it, provably not enough) and not a fixed fraction either (a fixed 72% bias still came up short in the ~265px Quickstart mini-map, because it didn't account for the popup constructor's own `offset` — the gap between the marker and the popup's tip — stacked on top of the popup's own height). Maximising headroom is the only version of this that's robust across wildly different container sizes (full desktop map vs. a mini-map that can be as short as the documented `SPLIT_PANE_MIN_PX=90px`); the CSS `maxHeight` cap is still the real safety net for when the popup genuinely can't fit even with maximum headroom.

**Two real bugs found only by instrumenting exact `map.project()` coordinates, not by eye against screenshots** — a screenshot in a container with enough natural slack can look "close enough" even when the underlying math is wrong:

1. **`easeTo({ center: lngLat, offset: [...] })` is a no-op when the map's current center is already exactly `lngLat`** (e.g. right after a cluster-expansion zoom that already centred on that exact point) — MapLibre doesn't seem to recompute the transform from `offset` alone if `center` itself doesn't change, so the target stayed exactly where it started despite a non-zero offset being passed. Fixed by computing the destination geographic centre directly via `project()`/`unproject()` pixel math instead of relying on the `offset` option at all — that has no dependency on whether the requested `center` differs from the current one.
2. **Clicking a marker directly raced the separate `[selectedId, panTrigger, mapReady]` "pan to selected" effect.** The `unclustered-point` click handler calls both `onSelect(place)` (which changes the `selectedId` prop) *and* opens its own smart-positioned popup — but changing `selectedId` also triggers the other effect, which runs its **own**, dumber, dead-centre `easeTo` and then **also** opens a popup. Two competing `easeTo` calls fired back to back; the later one silently won, discarding the careful positioning from the first. Fixed with `directClickPlaceIdRef`: the click handler stamps the place id it just fully handled, and the effect skips its own run for that exact firing if the stamp matches (clearing it immediately after, so a later external re-selection of the same id — e.g. "Zur Karte" — still goes through the effect normally).
3. **The recentre math only ever adjusted Y, never X.** `needsRecenter` correctly detects three overflow directions (top, left, right), but an earlier version of the recentre branch only computed a new `desiredY` and always kept `currentCenterPoint.x` unchanged — so a marker near the left/right edge had its overflow correctly *detected* but never *corrected*, and the popup still poked off the side of the map. Invisible in DACH testing (the default viewport keeps most search results away from the map's left/right edges) but reliably reproducible once international mode puts search results in cities the initial viewport isn't centred on (found live in Paris — confirmed via `getBoundingClientRect` that the popup's right edge sat 76px past the map container's edge). Fixed by computing `newX` the same way as `desiredY`, but only shifting it when `overflowsLeft`/`overflowsRight` is actually true.

**If touching this code, re-verify with logged `map.project()` coordinates before/after, in both a full-size desktop map and the Quickstart mini-map** — both bugs above were invisible in casual visual testing and only showed up as exact numbers that didn't move where they should have.

**Popup `maxHeight`** (R2 — MapLibre's `PopupOptions` has no native equivalent): reimplemented via a direct style write on the popup's own `.maplibregl-popup-content` element (`applyPopupMaxHeight()`), using the exact same `popupMaxHeight()` formula from `lib/map/geometry.ts` that Leaflet uses — re-applied on the same triggers Leaflet's `applyFreshPopupMaxHeight` was (visibility/fullscreen reveal, continuous resize).

## "Show on map" selection — a deliberate simplification of `zoomToShowLayer` (R3)

MapLibre's native clustering has no direct equivalent of `leaflet.markercluster`'s `zoomToShowLayer(marker, callback)` (zoom to the *minimal* level at which a marker individually un-clusters, then run a callback). The async, correct equivalent (`getClusterLeaves()` to find which cluster contains the target, then `getClusterExpansionZoom()`) was judged too much added risk for a flow the pre-migration Leaflet doc already flagged as the most timing-bug-prone code path in the app, with zero automated coverage to catch a regression.

Implemented instead: a synchronous heuristic in the `[selectedId, panTrigger, mapReady]` effect —

- If the target place is already rendered in the `unclustered-point` layer at the current viewport/zoom (`map.queryRenderedFeatures`), just recentre without changing zoom.
- Otherwise, jump straight to `PLACE_CLUSTER_DISABLE_AT_ZOOM` (17) — the zoom level clustering is disabled at — guaranteeing the marker un-clusters, then open its popup on `moveend`.

**Known behavioural difference from Leaflet, not yet resolved:** this can over-zoom relative to the true minimal expansion zoom when the target was clustered (e.g. a cluster that would have separated at zoom 10 instead jumps straight to 17). Flagged for Phase 4 manual verification — worth a side-by-side comparison against the Leaflet engine before this is accepted as final, not just a stopgap.

## "Search here" detection invariant (ported from the pre-migration Leaflet doc)

The floating "Hier suchen" button (`onSearchHere`) re-runs the last venue search at the panned map centre. `MapViewGL` tells a user-initiated view change from an app-driven move purely by **time window**: every programmatic `easeTo`/`jumpTo`/`fitBounds` must set `lastProgrammaticMoveRef.current = Date.now()` immediately before the call, and the `moveend` handler ignores any move within the window `isWithinProgrammaticMoveWindow()` (`lib/map/geometry.ts`) covers of that stamp. A programmatic move that forgets to stamp surfaces a spurious button. The button is hidden in amenity focus mode (`focusModeRef` guard in `moveend` + `!focusMode` JSX gate), where re-running the venue search would silently drop the parking/WC layers. `onSearchHere` must be wired in **both** `HomeClient` (desktop) **and** `MobileLayout` — a missing prop makes the feature work locally but vanish when deployed.

**Two distinct triggers, both funnelled through `userInteractedRef`** (renamed from `userPannedRef` in v12.10 — it now covers more than dragging): `dragstart` and `zoomstart` both just flip the flag to "a real user interaction happened"; the time-window check above is what actually distinguishes those from our own programmatic moves (`zoomstart` fires for programmatic zoom too, e.g. `fitBounds`/`easeTo` with a `zoom` option). `moveend` then picks the *reason* to show the pill:

- **Distance branch** (unchanged): the new centre moved beyond 25% of the smaller viewport span from `searchCenterRef` → `origin: "drag"`.
- **Zoom-only branch** (v12.10, fixes a reported bug: zooming out via scroll/pinch/`+`/`-`/double-click without panning never surfaced the button): if the centre *didn't* move enough to trip the distance branch, but the current viewport radius (`viewportRadiusKm()`) differs from `searchRadiusKmRef` (the app's currently-configured search radius, prop-mirrored) by more than `ZOOM_RADIUS_CHANGE_RATIO` (0.4) → `origin: "zoom"`.

`searchHereOriginRef` is `"drag" | "locate" | "zoom"`. `HomeClient.handleSearchHere` branches on it: `"locate"` and `"drag"` are unchanged (see below); `"zoom"` deliberately does **nothing** to `chatMode`/nearby state — a same-spot radius change shouldn't force nearby mode (wrong if this wasn't a GPS search) or force it out of nearby mode (wrong if it was) — the whole point is the user didn't move.

## Effect ordering invariant

Two effects in `MapViewGL.tsx` must not race when a "show on map" button switches the mobile tab and sets `selectedId` in the same render: the *selection effect* (`deps: [selectedId, panTrigger, mapReady]`) pans/zooms and opens the popup, while the *visibility effect* (`deps: [visible, isFullscreen, mapReady]`) calls `map.resize()` then `fitBounds` on all results after a `setTimeout(50 ms)`. The visibility effect checks `selectedId` first and returns early (`if (selectedId) return`) so it never overwrites the selection zoom — do not remove or reorder that guard, or a "show on map" tap will flash the popup then zoom back out to show all results. `mapReady` must stay in the visibility effect's deps too: the map is lazily mounted on first map-tab activation on mobile, and without `mapReady` in the deps `map.resize()` never runs on first reveal, leaving the freshly-visible container at stale/zero dimensions for the selection effect's own pan/zoom math (this was the Leaflet-era `invalidateSize` bug; the MapLibre `map.resize()` call has the identical dependency).

## CSS stacking context

The desktop/mobile map container divs keep `isolation: isolate` (`app/HomeClient.tsx`, `components/mobile/MobileLayout.tsx`), inherited from the Leaflet era where Leaflet's own 200–700 pane z-indexes leaked into the page stacking context and painted over `ChatPanel`'s autocomplete dropdown. MapLibre's own DOM footprint (popups, controls) doesn't reproduce that specific bug, but `isolation: isolate` is otherwise harmless — kept defensively rather than removed and re-litigated without a concrete reason to.

## Rotation/pitch (R7)

Disabled at construction (`dragRotate: false`, `pitchWithRotate: false`, `touchPitch: false`) and again post-construction (`map.touchZoomRotate.disableRotation()`, `map.keyboard.disableRotation()`) — belt-and-suspenders, since `getBounds()`/`project()` throughout this file assume a north-up, unpitched map (viewport-radius math, the popup edge check).

## Service worker (R12) — turned out to be moot

The migration plan flagged "no caching strategy for vector tiles/glyphs/sprite" as a risk. Checking `next.config.ts` found Serwist is fully **disabled** in production already (`disable: true`, with a hand-written self-destruct `public/sw.js` unregistering an old caching worker that shipped by accident once). There is no active service-worker caching layer for this risk to interact with.

## Verification status (Phase 4, closed out at the v12.0 cutover)

Manual test matrix (desktop Turbo-Modus, mobile Turbo-Modus, Quickstart-Modus, international mode, native iOS/Android shells) signed off by manual testing ahead of the cutover — see the commit history from v11.24 through v12.0 for the individual bugs found and fixed along the way (popup positioning, clustering, attribution control, the Quickstart split ratio, etc.).

- R11 (popup button touch handling on real mobile devices) — plain `addEventListener` is used (MapLibre popups are ordinary DOM outside the WebGL canvas, unlike Leaflet's touch-interception problem), which was the main touch-specific risk; covered by the manual pass above.
- E2E/visual regression automation — deferred by explicit choice (2026-07-31): the team is not adopting Playwright for this yet, given the added devDependency weight; live manual verification was the safety net for this migration.
