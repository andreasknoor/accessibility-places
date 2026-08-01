# MapViewGL (`components/map/MapViewGL.tsx`)

The MapLibre GL JS + OpenFreeMap implementation of the map, built as part of the migration tracked in [issue #48](https://github.com/andreasknoor/accessibility-places/issues/48). Lives alongside `MapViewLeaflet.tsx` (the pre-migration Leaflet implementation, unchanged) behind an internal, non-user-facing engine flag in `components/map/MapView.tsx` (`NEXT_PUBLIC_MAP_ENGINE=maplibre`, default `leaflet`). Both implementations share one prop contract, `MapViewProps` in `lib/map/types.ts`.

**This is not yet the default engine.** `MapViewLeaflet.tsx` stays live in production until Phase 4 verification (full manual matrix, including the native iOS/Android shells) passes. See the issue for the phase breakdown.

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

MapLibre's native clustering has no direct equivalent of `leaflet.markercluster`'s `zoomToShowLayer(marker, callback)` (zoom to the *minimal* level at which a marker individually un-clusters, then run a callback). The async, correct equivalent (`getClusterLeaves()` to find which cluster contains the target, then `getClusterExpansionZoom()`) was judged too much added risk for a flow the Leaflet doc (`mapview.md`) already flags as the most timing-bug-prone code path in the app, with zero automated coverage to catch a regression.

Implemented instead: a synchronous heuristic in the `[selectedId, panTrigger, mapReady]` effect —

- If the target place is already rendered in the `unclustered-point` layer at the current viewport/zoom (`map.queryRenderedFeatures`), just recentre without changing zoom.
- Otherwise, jump straight to `PLACE_CLUSTER_DISABLE_AT_ZOOM` (17) — the zoom level clustering is disabled at — guaranteeing the marker un-clusters, then open its popup on `moveend`.

**Known behavioural difference from Leaflet, not yet resolved:** this can over-zoom relative to the true minimal expansion zoom when the target was clustered (e.g. a cluster that would have separated at zoom 10 instead jumps straight to 17). Flagged for Phase 4 manual verification — worth a side-by-side comparison against the Leaflet engine before this is accepted as final, not just a stopgap.

## Rotation/pitch (R7)

Disabled at construction (`dragRotate: false`, `pitchWithRotate: false`, `touchPitch: false`) and again post-construction (`map.touchZoomRotate.disableRotation()`, `map.keyboard.disableRotation()`) — belt-and-suspenders, since `getBounds()`/`project()` throughout this file assume a north-up, unpitched map (viewport-radius math, the popup edge check).

## Service worker (R12) — turned out to be moot

The migration plan flagged "no caching strategy for vector tiles/glyphs/sprite" as a risk. Checking `next.config.ts` found Serwist is fully **disabled** in production already (`disable: true`, with a hand-written self-destruct `public/sw.js` unregistering an old caching worker that shipped by accident once). There is no active service-worker caching layer for this risk to interact with.

## Not yet ported / verified

- Full manual test matrix (desktop × mobile web × Quickstart × iOS shell × Android shell) — see issue #48's Testing section. Only live-verified so far: desktop Chrome, core flow (search → markers → clustering → cluster-expansion-zoom → popup → "Zur Karte" pan+popup → results-list sync).
- R11 (popup button touch handling on real mobile devices) — plain `addEventListener` is used (MapLibre popups are ordinary DOM outside the WebGL canvas, unlike Leaflet's touch-interception problem), but this needs verification on a real touchscreen, not just assumed.
- E2E/visual regression automation — deferred by explicit choice (2026-07-31): the team is not adopting Playwright for this yet, given the added devDependency weight; live manual verification is the current safety net.
