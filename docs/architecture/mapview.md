# MapView (`components/map/MapView.tsx`)

`MapView` uses Leaflet and is loaded via `dynamic(..., { ssr: false })` to prevent server-side rendering errors.

## Place pin markers

Each result renders as a teardrop pin (`svgMarker`) whose circular head is filled with the confidence colour (green/amber/red) and shows the category emoji from `CATEGORY_ICONS`; the tip is anchored exactly on the coordinate. Selected markers scale up. This replaced the uniform ♿ circle once the app grew to 28 categories — a single wheelchair glyph no longer disambiguated venue type.

## Marker clustering

Place markers are grouped via `leaflet.markercluster`. `PLACE_CLUSTER_MAX_RADIUS = 50 px` controls grouping radius; clustering is disabled at zoom ≥ `PLACE_CLUSTER_DISABLE_AT_ZOOM = 17` (street level, every pin always visible). Cluster icons use the same confidence-colour scheme as individual pins and are styled with custom CSS classes (`ap-cluster`, `ap-cluster-sm/md/lg`). The default Leaflet.markercluster theme is replaced entirely — do not import its default CSS.

## "Search here" detection invariant

The floating "Hier suchen" button (`onSearchHere`) re-runs the last venue search at the panned map centre. MapView tells a user pan from an app-driven move purely by **time window**: every programmatic `setView`/`fitBounds`/`zoomToShowLayer` must set `lastProgrammaticMoveRef.current = Date.now()` immediately before the call, and the `moveend` handler ignores any move within `PROGRAMMATIC_MOVE_WINDOW_MS` (700 ms) of that stamp (`zoomToShowLayer` re-stamps inside its `openPopup` callback to cover autoPan). A programmatic move that forgets to stamp surfaces a spurious button; the earlier counter-based approach desynced and suppressed the button entirely (v4.35 → v4.36). The button is hidden in amenity focus mode (`focusModeRef` guard in `moveend` + `!focusMode` JSX gate), where re-running the venue search would silently drop the parking/WC layers. `onSearchHere` must be wired in **both** `HomeClient` (desktop) **and** `MobileLayout` — a missing prop makes the feature work locally but vanish when deployed.

## Effect ordering invariant

Two `useEffect`s in `MapView.tsx` must not race when a "show on map" button switches the mobile tab and sets `selectedId` in the same render: the *selection effect* (`deps: [selectedId, panTrigger, mapReady]`) runs `zoomToShowLayer` + `openPopup`, while the *visibility effect* (`deps: [visible, isFullscreen, mapReady]`) runs a `setTimeout(50 ms)` that calls `invalidateSize` then `fitBounds` on all results. The visibility effect checks `selectedId` first and returns early (showing the selected marker instead) so it never overwrites the selection zoom. Do not remove or reorder that guard — the symptom is the popup flashing briefly then vanishing as the map zooms back out to show all results.

## First-mount `invalidateSize` invariant

`mapReady` **must** stay in the visibility effect's deps. On mobile the map is lazily mounted on first map-tab activation; `MapView.init()` loads Leaflet asynchronously and only then `setMapReady(true)`. The visibility effect's initial run bails (`mapInst.current` is null mid-init), and `visible` does not change when `mapReady` later flips — so without `mapReady` in the deps, `invalidateSize()` is never called on first mount and the freshly-revealed container keeps zero/stale dimensions. The selection effect's `zoomToShowLayer` then runs against an unmeasured container and silently no-ops: tapping "show on map" the very first time shows the clustered default view with no zoom and no popup, while every subsequent attempt works (toggling tabs changes `visible` and re-runs the effect). Adding `mapReady` makes `invalidateSize` + the deferred selection zoom run once init completes (v6.8).

## CSS stacking context invariant

The desktop map container div has `isolation: isolate` (`<div className="flex-1 min-h-0 relative isolate">`). Leaflet injects pane z-indexes of 200–700 directly; without isolation these leak into the page stacking context and paint over ChatPanel (`z-20`), hiding autocomplete dropdowns. `isolate` traps all Leaflet z-indexes inside the map container. Do not remove it.
