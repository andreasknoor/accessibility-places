# Matching & merging (`lib/matching/`)

`match.ts` – a candidate place is considered the same as an existing canonical place when a weighted score exceeds `MATCH_SCORE_THRESHOLD = 0.72`. The formula is:

```
effectiveName × 0.5 + addrScore × 0.3 + geoScore × 0.2
```

where `addrScore = streetTrigram × 0.6 + cityMatch × 0.25 + zipMatch × 0.15`. A fast reject fires when distance > 3 × `GEO_MATCH_RADIUS_M` (240 m). Name containment (one normalised name substring of the other within 80 m) raises the effective name score to ≥ 0.9.

`merge.ts` – winning `A11yValue` is determined by summed source reliability weight. Toilet confidence is boosted to 1.0 when `isDesignated` or `hasGrabBars` is true; capped at 0.9 for weaker toilet signals. The `computeFilteredConfidence()` function averages criteria that are either active or have a non-unknown value — active-but-unknown criteria are included in the denominator so that enabling `acceptUnknown` doesn't artificially inflate scores to 100%. `passesFiltersForSource(place, sourceId, filters)` answers "would this place pass if only this one source were active?" — used by `FilterPanel` to show a predictive per-source result count. Note: `seating` is an optional criterion — not all adapters populate it, so `Place.accessibility.seating` may be `undefined`.

`passesFilters` treats both `"yes"` and `"limited"` as passing for any active criterion. This is intentional: `"limited"` (eingeschränkt) means potentially usable, not inaccessible. Only `"no"` fails; `"unknown"` fails unless `acceptUnknown` is true.

`nearby-parking.ts` – post-merge enrichment (always active; skipped in SEO validity checks via `SKIP_NEARBY_ENRICHMENT=1`). `enrichWithNearbyParking()` upgrades `parking.value` from `"unknown"` to `"yes"` with `details.nearbyOnly = true` when a disabled-parking OSM node (capacity:disabled > 0 or parking_space=disabled) is found within `DEFAULT_MAX_NEARBY_PARKING_M = 250 m`. Deliberately does **not** add a `SourceAttribution`, so confidence and per-source filter counts are unaffected. Confidence is set to `NEARBY_PARKING_CONFIDENCE = 0.75` (matches the OSM reliability weight). Map display uses a wider `NEARBY_PARKING_DISPLAY_RADIUS_M = 500 m`: parking markers are shown near any enriched result within this radius, even if slightly too far to trigger enrichment. This file also exports `dedupeToiletFeatures()` (collapses WC duplicates within `TOILET_DEDUP_RADIUS_M = 25 m`, preferring strong tier then standalone host) and `TOILET_DISPLAY_CAP = 300` — see [amenities.md](./amenities.md).

**`parkingNearby`** (`SearchFilters.parkingNearby`) — sub-toggle that only matters when `parking: true`. When `false`, the parking filter accepts only places with on-site parking attribution and rejects `nearbyOnly` enriched places. Default `true` preserves legacy behaviour (nearby enrichment counts as passing). Controlled by an explicit checkbox in `FilterPanel`. It is the parking-specific filter sub-toggle; the broader display/focus machinery is generalised across amenity types — see [amenities.md](./amenities.md).
