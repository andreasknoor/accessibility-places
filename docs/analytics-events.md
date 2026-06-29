# Analytics Events

All events are fired via `track()` from `lib/analytics.ts`, which dual-emits to
Vercel Analytics and (when `NEXT_PUBLIC_UMAMI_WEBSITE_ID` is set) Umami. Every
event receives a `platform` property automatically (`"web"` | `"android"` | `"ios"`).

---

## Core Search Events

### `search`
A venue search completed successfully.

| Property | Type | Description |
|---|---|---|
| `mode` | `"text" \| "nearby"` | Whether the user typed a location or used GPS |
| `result_count` | `number` | Number of venues returned after filtering |

**When:** After the streaming `/api/search` response is fully parsed and results are rendered.  
**Why it matters:** Primary volume metric. `result_count` reveals how often searches yield useful data.

---

### `nearby_search`
A GPS-based nearby search completed. Fires alongside `search` when `mode === "nearby"`.

| Property | Type | Description |
|---|---|---|
| `result_count` | `number` | Number of venues returned |

**When:** Same as `search`, but only in nearby mode.  
**Why it matters:** Tracks GPS-feature adoption separately from text searches.

---

### `search_no_results`
A search returned zero results.

| Property | Type | Description |
|---|---|---|
| `mode` | `"text" \| "nearby"` | Search mode |
| `radius_km` | `number` | Radius used at the time of the empty search |

**When:** After a search resolves with `result_count === 0`.  
**Why it matters:** High rates indicate missing data coverage or overly strict default filters.

---

### `search_freetext`
The user typed text in the search field and pressed Enter **without** selecting from the autocomplete dropdown.

| Property | Type | Description |
|---|---|---|
| `category` | `Category \| "alle"` | Which chip was active at submission time |

**When:** In `ChatPanel.handleSubmit`, on the raw text-entry path (not a suggestion pick, not a place search).  
**Why it matters:** Reveals how often users bypass autocomplete — high rates may indicate the suggestions aren't surfacing the right results or the UX isn't clear enough.

---

### `search_here`
The user tapped the "Hier suchen" pill after panning the map.

| Property | Type | Description |
|---|---|---|
| `radius_km` | `number` | Viewport-derived search radius (rounded to integer km) |

**When:** In `HomeClient.handleSearchHere`.  
**Why it matters:** Measures how often users actively explore beyond the initial search area.

---

## Category & Chip Events

### `chip_select`
A venue category chip was tapped (including "Alle").

| Property | Type | Description |
|---|---|---|
| `category` | `Category \| "alle"` | The selected chip's category key |
| `mode` | `"text" \| "nearby"` | Active search mode at tap time |

**When:** At the start of `ChatPanel.selectChip`, for every chip tap.  
**Why it matters:** Shows which categories are most used and whether users prefer browsing by category or typing.

---

### `viewport_chip_search`
A category chip was tapped while a panned map viewport was pending — the search used the visible map area instead of the last GPS fix or typed location.

| Property | Type | Description |
|---|---|---|
| `category` | `Category \| "alle"` | The selected chip's category key |
| `radius_km` | `number` | Viewport radius (rounded to integer km) |

**When:** Inside `ChatPanel.selectChip`, on the early-return viewport path.  
**Why it matters:** Tracks adoption of the viewport-as-origin feature (v9.5+). Low rates may mean the "search here" pill is discoverable enough but users don't then combine it with chip filtering.

---

## Navigation & Location Events

### `locate`
The GPS locate button (⌖) was tapped.

**No properties.**

**When:** In `ChatPanel.onLocateTap`.  
**Why it matters:** Measures how often users use GPS-based search entry vs. typing.

---

### `suggest_pick`
A result from the autocomplete dropdown was selected.

| Property | Type | Description |
|---|---|---|
| `kind` | `"area" \| "venue"` | Whether the user picked a location or a specific venue |

**When:** In `ChatPanel.selectSuggestion`.  
**Why it matters:** `kind: "venue"` picks lead to a place search; `kind: "area"` picks lead to a category search. The ratio reveals how users navigate.

---

### `place_search`
A specific venue was selected from the autocomplete, triggering a place search.

**No properties.**

**When:** In `ChatPanel.selectSuggestion`, when `s.kind === "venue"`.  
**Why it matters:** Tracks usage of the place-lookup feature specifically.

---

## Amenity Events

### `amenity_search`
A parking (🅿) or WC (🚻) amenity search was triggered.

| Property | Type | Description |
|---|---|---|
| `type` | `"parking" \| "toilet"` | Which amenity type was searched |

**When:** In `HomeClient.handleAmenitySearch`.  
**Why it matters:** Core accessibility feature. Tracks whether users find the amenity chips and use them.

---

### `parking_shown`
The passive parking-spots map layer was toggled on.

**No properties.**

**When:** In `HomeClient.handleToggleParking` and `handleUpdateSettings`.  
**Why it matters:** Tracks usage of the ambient "always show parking" overlay.

---

## Filter & Settings Events

### `filter_apply`
One or more accessibility filters were activated.

| Property | Type | Description |
|---|---|---|
| `criteria` | `string` | Comma-separated list of active filter keys (e.g. `"entrance,toilet"`) |

**When:** In `HomeClient.handleFilters`, when the filter set changes.  
**Why it matters:** Shows which filters are actually used; unused filters are noise to remove.

---

### `radius_change`
The search radius slider was moved (and a new search was triggered).

| Property | Type | Description |
|---|---|---|
| `km` | `number` | The new radius value |

**When:** In `HomeClient.handleRadiusChange`.  
**Why it matters:** Reveals the radius distribution users prefer; informs default radius decisions.

---

### `expand_radius`
The "Radius vergrößern" button was tapped when a search returned zero results.

| Property | Type | Description |
|---|---|---|
| `from_km` | `number` | Radius before expansion |
| `to_km` | `number` | Radius after expansion (capped at `RADIUS_MAX_KM`) |

**When:** In `HomeClient.handleExpandRadius`.  
**Why it matters:** A proxy for "search failed to find anything useful" — high rates point to coverage gaps.

---

### `sort_change`
The result sort order was changed.

| Property | Type | Description |
|---|---|---|
| `order` | `"confidence" \| "distance"` | The newly selected sort order |

**When:** In `HomeClient`, both on the mobile (`MobileLayout`) and desktop `ChatPanel` sort control.  
**Why it matters:** If few users sort by distance it may not be worth the UI complexity.

---

### `international_mode_toggle`
The international search mode was switched on or off.

| Property | Type | Description |
|---|---|---|
| `enabled` | `boolean` | `true` when turned on, `false` when turned off |

**When:** In `HomeClient.handleUpdateSettings` when `patch.internationalMode` is set.  
**Why it matters:** Tracks adoption of the beta international feature.

---

### `settings_open`
The settings sheet (gear icon) was opened.

**No properties.**

**When:** In `SettingsSheet`, on the trigger button click.  
**Why it matters:** Baseline for settings discoverability — if almost no one opens it, UX placement should change.

---

## Mobile Navigation

### `tab_switch`
A tab in the mobile bottom navigation bar was tapped (Ergebnisse / Karte / Filter).

| Property | Type | Description |
|---|---|---|
| `tab` | `"results" \| "map" \| "filter"` | The tab the user switched to |

**When:** In `MobileLayout`, on the tab bar button click. Only fires on explicit user taps — programmatic tab switches (e.g. after a search completes) do not fire this event.  
**Why it matters:** Reveals the navigation pattern on mobile. A low `filter` rate means the Filter tab is not being discovered; a high `map` rate confirms map-first usage. Comparing `tab_switch { tab: "filter" }` against `filter_apply` shows the drop-off between opening the filter panel and actually setting a filter.

---

## Detail & External Events

### `detail_sheet_open`
The place info sheet was opened for a result.

| Property | Type | Description |
|---|---|---|
| `category` | `Category` | The category of the place whose sheet was opened |

**When:** In `PlaceCard`, on card body click and on the map-pin button click.  
**Why it matters:** Measures engagement depth — users who open the sheet are evaluating the place seriously.

---

### `place_not_found`
A place search resolved with no usable result.

| Property | Type | Description |
|---|---|---|
| `reason` | `"not_found" \| "no_data"` | `not_found`: place name not in OSM; `no_data`: found but no accessibility data |

**When:** In `HomeClient.handlePlaceSearch` error branches.  
**Why it matters:** `no_data` cases identify venues to prioritise for accessibility data collection.

---

### `external_link`
An external link was opened from the place info sheet (Wheelmap, OSM, Google Maps, Ginto, AccèsLibre, venue website).

| Property | Type | Description |
|---|---|---|
| `domain` | `string` | Hostname of the opened URL (e.g. `"www.openstreetmap.org"`) |

**When:** In `NativeLink.onClick`.  
**Why it matters:** Shows which external sources users trust enough to follow up on.
