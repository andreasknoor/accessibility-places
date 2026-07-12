# Unified search field & place search (ChatPanel → API)

Explore mode has **one search input** (since issue #24 step 2, v4.21) and **no submit button** (Google Maps model, replacing the earlier docked "Suchen" button). Autocomplete comes from `/api/geocode/unified-suggest` — one Photon call without layer restriction, classified into `kind: "area" | "venue"`. The dropdown renders an always-present "search for `<text>`" row first (`highlightedIdx === -1`, mirrors Enter with nothing highlighted — both call `submit()`), then two labelled suggestion groups (areas first) over a single flat keyboard index; the input carries combobox ARIA with `aria-activedescendant`. The freetext row's visibility is decoupled from the suggest fetch (`showSuggestions` open/closed switch vs. `suggestions` data array) — an empty or failed API response must not remove the only mouse/touch-reachable way to trigger a search.

**Selection commits the intent:**
- **Area pick** → the category search path: `onSearch(query)`. With a chip selected the query is `"<ChipLabel> in <display>"`; with the "Alle" chip (all categories) it is `"in <display>"` — the `in` prefix keeps `parseQuery` from inferring categories out of city names (the city "Essen" matches the restaurant hint "essen").
- **Venue pick** → `onPlaceSearch(name, coords)` with the Photon coordinates (Nominatim skipped). The input shows the picked display string; `pickedVenueRef` lets Enter re-run the same place search, and the category chips grey out (`venuePicked`) until the user edits the field.
- **Enter on raw free text** → always an area search (conservative default — typed text is never silently routed to a venue lookup). The raw text goes through `parseQuery`, so `"Sushi in Berlin"` scopes the category from the text.

**Quote syntax = name filter.** `"Vapiano" in Berlin` extracts the quoted part via `extractQuotedName()` (any quote style) into `nameHint`, passed in the API body and applied as a post-merge JS filter (`filterByNameHint` — substring + trigram ≥ 0.6). Accessibility filters therefore apply independently of name filters. The autocomplete strips quoted segments before querying Photon (`QUOTE_STRIP_RE`); an area pick preserves the quoted part (`"X" in <display>`). A quoted name **without** any location triggers `onPlaceSearch(quoted)`.

**Place-search mode** (`placeSearch: true` on `SearchParams`) is the venue-lookup path.

`HomeClient.handlePlaceSearch(nameHint, preResolvedCoords?)` flow:
1. If the suggestion provided coordinates, skip Nominatim and use them directly
2. Otherwise resolve a location: `searchCenter` → `gpsCoordRef` → `navigator.geolocation` (timeout, 60 s cache) → Nominatim with optional viewbox bias
3. If Nominatim returns 404: sets `place_not_found` error. If the stream completes with zero places: sets `place_no_data` error (distinct states).
4. If exactly one result: auto-selects it (opens the info sheet)

**OSM adapter** in `placeSearch` mode replaces the tag-based Overpass query with a name-regex query across node/way/relation within 500 m. Uses character-class case-insensitive regex (`[hH][oO][tT]...`) — not the `,i` flag which is broken on some Overpass mirrors. Radius is capped at 0.5 km server-side regardless of user setting. Other adapters are unchanged; they search by bbox and the `nameHint` post-filter applies as usual.

**`programmaticLocRef`** (ref in ChatPanel) — holds the input value whenever it was set programmatically (restore from `ap_last_search`/URL, area pick, venue pick). The suggest effect is suppressed while the input equals this value — unlike a one-shot skip flag, this survives the locale/biasCoords re-renders that fire after a search completes (`setSearchCenter` → `biasCoords` change), which used to re-open the dropdown. Cleared on user input.

**Nearby mode queries** go through `nearbyQuery(label, district)`: `"<label> in <district>"` with a chip, `"in <district>"` for all categories, and a neutral non-empty fallback when no district resolved (the route rejects empty `userQuery` for non-place searches).

**History:** the dedicated `"place"` chat mode (third tab) was removed in v4.13; the separate name field (two-input layout) was removed in v4.21. `initialMode="place"` and `defaultSearchMode: "place"` are still accepted and map to `"text"`.
