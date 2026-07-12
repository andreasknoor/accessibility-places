# Remove the "In der Nähe" button from the search row

Status: concept, not implemented. Functional description only — implementation
phases at the end. Based on the discussion of 2026-07-11/12 (Google-Maps-style
implicit nearby default, revised twice: no implicit GPS acquisition, no
auto-search on locate — the map locate button *arms* the existing "Hier
suchen" pill instead).

## Goal

Remove the dedicated nearby control (the inline "Standort verwenden" / ⌖
action in the search field) from the search row. Nearby search stops being an
explicit *mode* the user enters and becomes one of three possible **search
origins**, resolved by a single, explainable precedence rule:

> A search applies to: **what you typed** — otherwise **where you moved the
> map** (confirmed via the "Hier suchen" pill) — otherwise **where you are**
> (GPS fix, if one exists).

This is the final step of the issue #28 simplification line (mode tabs →
unified field → this). The GPS permission request stays bound to an explicit
user gesture at all times; there is deliberately **no** implicit GPS
acquisition on app start or on chip tap.

## What the button does today (inventory)

The inline nearby action currently serves five functions, all of which need a
new home or an explicit decision to drop:

1. **Trigger**: acquires a GPS fix + reverse-geocodes the district, then runs
   a nearby search with the active chip.
2. **Permission context**: the OS location prompt appears in response to this
   tap — a clean "requested in context" gesture.
3. **State display**: after the fix, the green location token ("Suche um
   <Bezirk>") shows the active origin; its ✕ clears the fix.
4. **Refresh**: tapping again re-acquires the position.
5. **Mode switch**: sets the internal nearby mode, which gates distance
   display in the results list.

## Target behaviour

### Search row

- The inline nearby action is **removed**. The empty field shows only the
  regular placeholder.
- The **green location token stays** — it remains the single, cross-view
  display of "the current search origin is your GPS position around
  <district>", with ✕ to discard the fix. It is now display + exit only,
  never a trigger.
- Empty field + active token + "Suchen"/Enter still re-runs the nearby search
  at the fix (unchanged).
- Typing still visually steps the token back; clearing the text brings it
  back (unchanged, reversible).

### Map (the new nearby entry point)

- The existing locate button keeps its universal, non-destructive meaning:
  tap → map pans/zooms to the GPS fix, user-location dot shown. **It never
  auto-runs a search** (a locate tap while planning a remote trip must not
  destroy the current results).
- **New:** a locate tap counts as an intentional viewport move and therefore
  **arms the existing "Hier suchen" pill** — an explicit exception to the
  v9.14 rule that only real drag gestures arm it. The pill then re-runs the
  active chips/filters/nameHint at the GPS-centred viewport, reusing the
  existing coordinate-search path (including its search-field cleanup via the
  exitNearby mechanism).
- Flow: locate tap (1) → orientation, old results still visible → pill tap
  (2) → nearby results. Two taps instead of one, but reversible and
  convention-conforming (this is exactly Google Maps' behaviour).
- The GPS permission prompt now happens on the locate tap — same clean
  gesture context as before, just relocated.
- Pill label stays the uniform "Hier suchen" for now; a differentiated "In
  meiner Nähe suchen" after a locate-initiated pan is a possible later
  refinement (costs an extra state: the pill would need to know the pan came
  from the locate button).

### Results list

The list needs no new control. The search row (visible in both mobile tabs)
carries the origin state via the token; origin *changes* from the list happen
by typing a place. The remaining gap — a list-only user with no fix and no
typed place who wants nearby — is closed by:

- the **welcome screen's** existing "In der Nähe suchen" card (first run),
- the **defaultSearchMode = nearby** setting's existing auto-locate on start
  (explicit user consent via settings; unchanged),
- the **amenity chips'** existing auto-locate (unchanged — they already
  acquire a fix on tap when no location is known),
- a new **empty-state hint** in the results list when no origin exists:
  "Gib einen Ort ein — oder tippe auf ⌖ in der Karte, um in deiner Nähe zu
  suchen" (i18n DE+EN). Venue chip taps with no origin at all continue to run
  no search (as today); the hint explains why.

Accepted trade-off: triggering a *fresh* nearby search from the list view
takes one tab switch. This is deliberate — the alternative (chip tap
implicitly acquiring GPS) reintroduces the permission-without-context problem.

### Distance display

Today distance is shown only in nearby mode. The mode disappears, so the rule
becomes origin-based: **distance is shown iff the active search's origin is
the GPS fix** (locate-pill search or token-based re-run). Typed and
"Hier suchen"-after-drag searches show no distance (unchanged semantics,
new mechanism).

### Permission denied / GPS unavailable

- Locate tap fails → existing map-side error handling (message near the
  button). The denial is remembered for the session; subsequent locate taps
  show the hint instead of re-prompting into a guaranteed failure.
- Because nothing acquires GPS implicitly, a denied permission never breaks
  the default flow — typing a place remains a fully equivalent first-class
  path.
- Outside DACH without international mode: unchanged behaviour, but now only
  reachable via an explicit locate tap (no implicit path that could start the
  app in an error state).

## What stays untouched

- `nearbyPhase` fix acquisition, `watchPosition` live updates, reverse
  geocoding, session restore of the located state (`saveNearbyLocation`).
- Welcome screen flows and the `isFirstVisit` Capacitor invariant (#418).
- Amenity chip locate routing (`pendingAmenityTypeRef`).
- Viewport-origin precedence for chips (typed > viewport pan > GPS fix >
  activeSearchCoords > typed location) — the concept only removes one *entry
  point*, not the origin chain.
- Native quick actions (`pendingFocusAction`) and SEO deep links (they carry
  a location → exception 1 by definition).

## Settings migration

`defaultSearchMode` ("text" | "nearby" | null) survives conceptually as
"start with an automatic nearby search: yes/no" — only the wording in
SettingsSheet changes (it no longer selects a *mode*, it opts into the
startup auto-locate). `"text"` and `null` collapse to "no auto-locate".
Persisted values keep loading without migration (values are reinterpreted,
not renamed).

## Risks

1. **ChatPanel state machine** — the mode concept is woven through
   `exitNearbyState`, `exitNearbyTrigger`, session restore, and the token
   logic; this is the highest-regression-risk area of the app. Implementation
   must be its own carefully tested change, not a drive-by.
2. **v9.14 pill regression** — the locate-tap exception must not re-open the
   original bug (programmatic pans arming the pill); the exception is scoped
   to exactly one call site (locate button handler), not to a loosened pan
   heuristic.
3. **Discoverability dip** — long-time users who know the row button will
   look for it. Mitigations: the empty-state hint, and the token (the most
   visible artefact of nearby) is unchanged.
4. **Distance-display rule change** — needs explicit tests; today's
   `chatMode === "nearby"` gate disappears.

## Implementation phases (suggested)

1. **Map side first (additive, shippable alone):** locate tap arms the pill.
   No removal yet — the row button and the pill path coexist; telemetry
   (`locate_pill_search` vs `chip_select` nearby) shows whether the new path
   gets adopted.
2. **Distance display** switched from mode-gated to origin-gated.
3. **Row button removal** + empty-state hint + settings rewording.
4. **Cleanup:** drop the now-dead mode-switch UI strings, update FAQ
   (search behaviour section) and CLAUDE.md (search pipeline / ChatPanel
   description).

Each phase behind its own commit; phase 1 and 3 deserve real-device checks
(Capacitor iOS/Android) because of the permission-flow and cold-start
invariants.
