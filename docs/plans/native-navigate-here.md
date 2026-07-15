# "Navigate here" — starting turn-by-turn navigation from a place

Status: implemented (v10.6, branch `feat/navigate-here`, not yet merged).
`startDefaultNavigation()` and the reduced-scope Android-only chooser
(`startNavigationWithApp()`) ship as designed in `lib/native/navigation.ts`;
see CLAUDE.md's "'Navigate here'" section for the implementation summary
and exact file map. Native Android/iOS apps (Capacitor), with
a note on PWA/web reuse. Grounded in the existing `lib/native/*` patterns
(`geolocation.ts`, `browser.ts`) and the current PlaceCard/PlaceDebugSheet
link rows. Variant C ("Detail concept: Variant C") is expanded with a
placement analysis (five candidates evaluated) and a reduced-scope option
that avoids its one native-project requirement, plus an approved HTML
placement prototype (`docs/prototypes/navigate-here-placement3.html`)
covering the recommended sticky-button + popover pattern. "Extension:
parking/WC quick search" covers the same question for `AmenityCard` and
the map marker popups, which have no detail sheet to anchor to and need
their own, separate placement decision — prototyped in
`docs/prototypes/navigate-here-amenity.html` (the `AmenityCard` labelled-
button + popover, and a before/after of the parking and toilet marker
popups' footer). "Desktop implications" covers what the concept means for
non-native desktop browsers, where `getPlatform()` alone can't
distinguish desktop from mobile web.

## Goal

From a place's card or detail sheet, one tap should hand off to the phone's
maps app with turn-by-turn navigation to that place already starting —
not just "show this pin on a map."

## What already exists that this builds on

- Every `Place` always has `coordinates: { lat, lon }` — no new data
  dependency.
- `getPlatform()` (`lib/analytics.ts`) already resolves `"ios" | "android" |
  "web"` via `Capacitor.getPlatform()` — reusable for scheme branching,
  zero new detection code.
- `NativeLink` / `openExternalUrl()` (`components/ui/native-link.tsx`,
  `lib/native/browser.ts`) already open external URLs via
  `@capacitor/browser` (Chrome Custom Tabs / SFSafariViewController) on
  native, `window.open()` on web. **This mechanism is reused as-is by
  Variant A below, but is the wrong tool for Variants B/C/D** — see
  "Why not just reuse NativeLink" below.
- PlaceCard's footer icon row (website/phone/Ginto/Wheelmap) and
  PlaceDebugSheet's `InfoRow` list are the natural, already-existing slots
  to add a navigation entry into — no new UI surface needed structurally.

## Why not just reuse `NativeLink` for everything

`Browser.open()` opens a **Custom Tab / SFSafariViewController** — a
browser context that sits *inside* the app's process. That's the right
choice for a website link, but it is the wrong mechanism for a maps
**deep-link scheme** (`maps://`, `google.navigation:`, `geo:`): those
aren't `http(s)` URLs, and asking an embedded browser view to "open" a
non-web scheme either does nothing, shows an error, or (at best) relies on
Android/iOS-level app-link resolution *inside* that embedded view, which
is less reliable than a direct OS-level hand-off. For any variant that
uses a native scheme, the correct mechanism is a **plain WebView
navigation** (`window.location.href = uri`) — the OS's built-in "I don't
recognise this scheme, hand it to an installed app" behaviour then takes
over, the same way it would for a link tapped in any other app.

## Variants

### A — Universal Google Maps link (`https://www.google.com/maps/dir/?api=1&destination=lat,lon`)

Google's own documented cross-platform "directions" URL. Reuses the
existing `NativeLink` component completely unchanged — this is literally
just one more icon in the existing link row, no new native-aware code at
all.

- **UX:** Good on Android — Google Maps is a verified Android App Link
  for this domain, so it typically hands off to the Google Maps app
  directly (Chrome Custom Tabs generally still honour Android App Link
  verification). Weaker on iOS — the Google Maps iOS app does not reliably
  register this as a Universal Link from an embedded SFSafariViewController
  context, so the more likely outcome is the Google Maps *website*
  opening, with the user having to notice and tap "Open in app"
  themselves. Always opens Google Maps specifically, never Apple Maps —
  on iOS this is the "foreign" app for a lot of users.
- **Functional gain:** Medium. Solves the core request on Android; on iOS
  it's closer to "show a link to directions" than "app opens and starts
  navigating."
- **Technical risk:** Very low. Zero new native code, zero new platform
  branching, works identically in the plain PWA (opens a new browser tab).
- **Native vs. web split:** 100% web app. Literally reuses an existing
  component with a new `href`.

### B — Platform-native deep-link scheme ★ recommended

Branch on `getPlatform()` and navigate the WebView directly to a
platform-native URI:

- **Android:** `google.navigation:q=<lat>,<lon>` — Google's own Android
  Intent URI, specifically designed to launch Google Maps **already in
  driving-navigation mode** (not just a pin). Google Maps ships as a
  system app on essentially every certified Android device, so this is a
  safe bet without an installed-app check.
- **iOS:** `maps://?daddr=<lat>,<lon>&dirflg=d` — Apple Maps' own scheme.
  Apple Maps is guaranteed present on every iOS device (it's a system
  app), launches directly into driving directions.
- Fallback for the plain web/PWA case (no native scheme makes sense there):
  Variant A's universal Google Maps URL.

- **UX:** Best of the variants — one tap, each platform opens its own
  "home" maps app in the mode users expect (Google Maps on Android, Apple
  Maps on iOS — matching each OS's own convention, not forcing a
  Google-first assumption onto iOS users), navigation genuinely starts
  immediately rather than just centering a pin.
- **Functional gain:** High — matches the literal ask ("start navigation,"
  not "show the place") precisely, on both platforms.
- **Technical risk:** Medium. Needs a small new module
  (`lib/native/navigation.ts`, mirroring `browser.ts`'s structure) that
  does `window.location.href = uri` instead of `Browser.open()`. iOS
  (WKWebView) hands off unrecognised schemes to the OS by default — no
  native project changes needed there. Android is the one place that
  needs real verification: Capacitor's WebView wrapper generally already
  hands off external/intent-scheme URLs to the OS via its default
  `shouldOverrideUrlLoading` handling, but this must be confirmed against
  this app's actual Capacitor version on a **real device** (not just the
  emulator) — worst case, a one-line addition to
  `docs/capacitor-android-setup.md`'s config, not an Xcode/Android-Studio
  code change.
- **Native vs. web split:** ~95% web app (the new module, the platform
  branching, the URI construction — all plain TypeScript). ~5% native:
  device-level verification of Android's default scheme hand-off; no
  actual native project code required in the common case.

### C — In-app "open with…" chooser

Tapping "Navigate" opens a small sheet, built in the web app UI, offering
explicit choices ("Google Maps", "Apple Maps" on iOS, optionally others)
before triggering the matching deep link from Variant B.

- **UX:** One extra tap/decision versus B, but removes ambiguity for
  users whose preference doesn't match the OS default (an iOS user who
  has Google Maps installed and prefers it; a market where Waze or
  another app dominates).
- **Functional gain:** High, plus caters to regional/personal app
  preference — but adds a decision step for the majority of users who
  just want "go," which somewhat works against the "one tap, it just
  starts" framing of the original request.
- **Technical risk:** Medium–high, and this is the **one variant that
  cannot be done as a pure web-app change**. To avoid offering an option
  that isn't actually installed (tapping "Waze" when it isn't installed
  either errors or bounces to the App/Play Store), iOS requires checking
  `canOpenURL()` per target app — which since iOS 9 only works if that
  app's URL scheme is pre-declared in `ios/App/App/Info.plist`'s
  `LSApplicationQueriesSchemes` array. That's a genuine native Xcode
  project file edit, not reachable from the web codebase, and it grows
  with every additional app offered. Also the most UI/a11y surface of the
  three variants (a new modal needs the `useFocusTrap` treatment per
  CLAUDE.md's a11y conventions, new DE/EN strings, its own tests).
- **Native vs. web split:** ~70% web app (chooser UI, URL construction),
  but the iOS installed-app detection is genuinely native-project work
  (Info.plist), not just "more JavaScript."

### D — Android `geo:` URI instead of `google.navigation:` (variant on B, Android only)

Same idea as B, but Android uses the OS-standard `geo:0,0?q=<lat>,<lon>
(<label>)` URI instead of the Google-Maps-specific scheme. If more than
one navigation-capable app is installed (Waze, Google Maps, etc.), Android
itself pops its **own native "Open with" chooser** — zero extra UI code on
our side, the OS does it. iOS is unchanged from B (Apple Maps has no
OS-level chooser concept to borrow from).

- **UX:** Better than B for the subset of Android users with a
  non-Google preferred nav app (gets Variant C's benefit on Android
  specifically, for free). Identical to B on iOS.
- **Functional gain:** Comparable to B, slightly better on Android for
  that subset of users.
- **Technical risk:** Low–medium, with one real caveat: `geo:` is a
  weaker guarantee than `google.navigation:` for actually **starting**
  navigation mode — some `geo:` URI handlers just drop a pin rather than
  entering driving mode (a known Android fragmentation quirk, device- and
  app-version-dependent). Given the request is specifically "start
  navigation," this weaker guarantee is a real trade-off against D's
  Android-side flexibility.
- **Native vs. web split:** Same as B — ~95% web app, ~5% device-level
  verification, no native project code required in the common case.

## Detail concept: Variant C

Expands Variant C (in-app "open with…" chooser) into an implementable
concept. The central open question is **where in the UI this lives** —
addressed first, since it shapes everything else (whether the chooser is a
full sheet or a lightweight popover, how much it competes for space with
existing links).

### Where should "Navigate here" live?

Five candidate placements, evaluated against the existing UI (see
`components/results/PlaceCard.tsx`, `components/results/PlaceDebugSheet.tsx`,
`components/map/MapView.tsx`).

**1. PlaceCard footer icon row** (alongside Ginto/Website/Phone/Wheelmap)

- The row already has 4–5 icons plus a "Zur Karte" button — genuinely
  crowded already.
- A real conflict, not just clutter: the row **already contains a "Google
  Maps" icon** (`googleMapsHref`, a `Map` lucide icon) that opens a Google
  Maps *search* for the place — not directions. A second, visually similar
  map/pin icon added right next to it would be very easy to confuse with
  the existing one; a user has no way to tell "opens a search" from
  "starts navigating" from icon shape alone.
- Opening a multi-option chooser from a small icon buried in a scrolling
  list card is also a mismatch of interaction weight — a heavy action
  (open a sheet, make a choice) triggered by the lightest possible tap
  target.
- **Verdict: not recommended as the primary placement.** Crowding plus a
  real, pre-existing icon-confusion risk.

**2. PlaceDebugSheet header** (next to the existing Share icon)

- Prominent and always visible without scrolling — the header already
  established itself as "the place for sheet-level actions" (Share sits
  there today).
- Icon-only is arguably still too subtle for an action this central to an
  accessibility app's value proposition — comparable visual weight to
  Share, a much less important action.
- The real problem: PlaceDebugSheet is *itself* a slide-in panel
  (`role="dialog" aria-modal`, its own `useFocusTrap`). A full chooser
  **sheet** opened from inside it would be this codebase's first
  sheet-inside-a-sheet — nothing today nests modals, so focus-trap
  hand-off, Escape-key routing, and backdrop-tap routing between two
  stacked dialogs would all be new territory, not just a styling
  question.
- **Verdict: good discoverability, but the only placement that raises a
  real architectural question** (modal nesting) if the chooser is a full
  sheet — resolved below by *not* using a full sheet here.

**3. PlaceDebugSheet — dedicated, prominent button** (full-width, sticky)

- Matches how dedicated maps/POI apps themselves treat "Directions": a
  first-class action, not an icon lost in a row. Given this app's entire
  premise is "can I actually get to and into this place," giving
  navigation at least the visual weight the Website/Phone icons already
  get — arguably more — is defensible, not over-engineering.
- A sticky-bottom button (reachable one thumb-length away regardless of
  scroll position within the sheet's accessibility details) gives the
  strongest "always reachable" property of any candidate.
- Sidesteps placement 2's modal-nesting problem *if* the chooser itself is
  rendered as a small popover anchored to the button (see "Chooser
  behaviour" below) rather than a second full sheet.
- Cost: a new sticky-footer region in PlaceDebugSheet, which doesn't
  exist today (content currently scrolls edge-to-edge under the header).
  Pure layout work, not an architectural risk.
- **Verdict: recommended primary placement.**

**4. Map marker popup** (`MapView`)

- Contextually sensible — you're already looking at spatial context — but
  popups in this app are deliberately minimal (name, category, a link
  into the full detail sheet) and reposition/close on pan and zoom, an
  awkward host for a multi-step chooser interaction.
- Only reachable from the Map tab. Most users land on Results first
  (`defaultMobileView` defaults there for most settings combinations), so
  popup-only would leave the feature effectively hidden for a lot of
  sessions unless duplicated into the card too — doubling the surface to
  build, test, and keep in sync.
- **Verdict: not suitable as the primary or only placement** — at most a
  secondary convenience once the primary placement exists elsewhere.

**5. PlaceDebugSheet "External links" section** (as another `InfoRow`,
alongside OSM/Wheelmap)

- Cheapest to build — one more row following an existing, exact pattern.
- Buried at the bottom of a scrolling sheet, below Accessibility, Basic
  info, and Offer sections. For a feature framed around "get me there,
  fast," making it the *least* effort to reach directly undercuts the
  feature's own premise.
- **Verdict: technically cheapest, weakest UX — not recommended as the
  main placement.**

**Recommendation for placement:** primary action = **Placement 3**
(sticky, full-width button in `PlaceDebugSheet`), optionally mirrored as a
quick icon in the PlaceCard footer for users who don't want to open the
full sheet (Placement 1) — but only with a **visually distinct icon**
(e.g. lucide's `Navigation` compass/arrow glyph, not another `Map` pin) so
it cannot be confused with the existing Google Maps search icon. Placement
2 and 4 are dropped; 5 is skipped as redundant once 3 exists.

### Chooser behaviour

- Rendered as a small **popover anchored to the button** (Radix
  `Popover`, already used elsewhere — e.g. `RadiusPresetPopover`), *not*
  a second full-screen sheet. This is what avoids Placement 2/3's modal-
  nesting problem entirely: a popover is a lighter-weight overlay that
  doesn't need its own focus trap competing with the parent sheet's.
- Content: "Google Maps" and, on iOS, "Apple Maps" — each triggering the
  matching Variant B deep link. Android's own OS-level chooser (Variant D)
  is *not* duplicated inside this popover — offering "Google Maps" here
  is enough; a user who wants a third-party app (Waze etc.) on Android is
  still one tap away via that OS chooser if a `geo:` fallback is offered
  instead of/alongside `google.navigation:` (open question, not required
  for a first cut).

### The installed-app detection question

Tapping "Google Maps" on iOS when the app isn't installed needs to *do*
something reasonable — the concept doc's earlier "Why this needs
`Info.plist`" point deserves the detail: without a `canOpenURL` check
(which requires declaring `comgooglemaps` under
`ios/App/App/Info.plist`'s `LSApplicationQueriesSchemes`), a WKWebView
navigation to an unregistered custom scheme fails **silently** — no error,
no fallback, just a dead tap. That silent-failure risk is *why* C carries
real native cost, not a nice-to-have: without it, the "Google Maps" option
in the popover would sometimes just do nothing, which is worse than not
offering the option at all.

Two ways to scope this:

- **Full version:** add the `Info.plist` entry, gate the "Google Maps"
  option on `canOpenURL`, hide it when the app isn't installed. Correct,
  but is the one genuine native Xcode change in this whole feature.
- **Reduced-scope version:** ship the popover choice only where it's
  *free* — Android needs no manifest entitlement for this kind of check
  (`PackageManager` queries aren't gated the way iOS 9+ gates
  `canOpenURL`), so Android can offer a real "Google Maps vs. system
  chooser" choice with zero native project changes. iOS ships
  Apple-Maps-only in this reduced scope — i.e. **identical to Variant B on
  iOS**, and only genuinely "Variant C" on Android. This avoids the
  `Info.plist` change completely, at the cost of iOS never getting a
  choice screen (arguably fine: Apple Maps is the iOS-native expectation
  anyway, so the "choice" mainly matters on Android where preferences are
  more fragmented).

The reduced-scope version is worth strongly considering as the first cut:
it keeps the "native vs. web" split close to Variant B's (~90–95% web app)
while still delivering a real chooser where it has the most actual value
(Android's more varied app landscape), deferring the one true native-code
requirement (`Info.plist`) until there's evidence iOS users actually want
a Google Maps option badly enough to justify it.

## Extension: parking/WC quick search (amenity results)

Everything above assumes a `Place` (a venue) with its `PlaceDebugSheet`.
The parking (🅿) and toilet (🚻) quick-search chips produce a structurally
different result: `AmenityFeature` (`lat`/`lon` directly, no nested
`coordinates`), rendered by `AmenityCard` — and **`AmenityCard` has no
detail sheet at all**. It's a single flat card (header, criterion box,
footer link row, "Zur Karte" button); there is no `PlaceDebugSheet`
equivalent to open. Placement 3's "sticky button in the sheet" therefore
has no direct home for amenities — this needs its own placement decision,
and in fact **two** independent ones, since amenity spots are always shown
on *both* surfaces at once (unlike venues, where the map is secondary to
the list): the `AmenityCard` itself, and the marker's map popup
(`MapView.tsx`, the parking/toilet marker `bindPopup` construction).

### AmenityCard (list) placement

The same reasoning as venue Placement 1 mostly carries over unchanged:
the footer already has a Google-Maps-search icon (`Map` icon,
`googleMapsHref`), a conditional Wheelmap icon, a conditional
"report weak parking" link, and the "Zur Karte" button — real estate is
already spoken for, and the existing Google-Maps icon has the identical
confusion risk a new map/pin-style icon would create.

Unlike venues, though, there's no sheet to push this into instead — the
footer row *is* the only candidate here, not one option among several.
Recommendation: a small **labelled** button ("Navigation", not just an
icon) in the footer row, using the same distinct compass/arrow glyph as
the venue concept — heavier than a bare icon (borrowing the "this deserves
more weight than Website/Phone" argument from Placement 3), but without
inventing a new sticky region, since a sticky footer belongs to a
full-screen sheet, a pattern that doesn't exist for amenities and
shouldn't be introduced just for this. Tapping it opens the same anchored
popover chooser described above, just anchored to this smaller button
instead of a full-width one — the mechanism doesn't change, only what
it's attached to.

### Map marker popup placement

The parking and toilet marker popups (`MapView.tsx`) already have a
primary-styled CTA button (`POPUP_CTA`) in their footer:

- **Parking popup:** always wired to `data-gmaps` → opens a Google Maps
  *search* for the coordinates via `openExternalUrl`.
- **Toilet popup:** wired to whichever of Wheelmap/Google Maps happens to
  be available — Wheelmap takes the primary slot when a Wheelmap URL
  exists, Google Maps otherwise, with the other link demoted into the
  secondary `POPUP_LINKS` row.

Recommendation: give "Navigate here" its **own, always-present** primary
CTA slot in both popups, demoting Google-Maps-search and Wheelmap into the
secondary links row underneath (where "Zeige in Ergebnissen" /
"Weak-parking melden" already live) — rather than conditionally
repurposing whichever link currently occupies that slot, which would
leave the WC popup's behaviour inconsistent with the parking popup's.

**No in-popup chooser here** — unlike the card/sheet recommendation,
tapping this button should trigger Variant B's platform deep link
directly (Google Maps on Android / Apple Maps on iOS), with no picker
step. Two reasons this differs from the card recommendation: the popup is
short-lived and closes on pan/zoom (the same property that ruled out
"Placement 4" for venues), and at `maxWidth: 240–250px` there is
materially less room for a multi-option popover to render sensibly. A
direct, no-choice action fits the popup's existing "one tap, one outcome"
buttons (`data-gmaps`, `data-report`, `data-show-results` are all
single-action today) better than introducing the one multi-step
interaction in an otherwise single-tap surface.

**Technical note — this is genuinely different code, not just a
different button:** the marker popups are hand-built HTML strings with
manual `L.DomEvent.on(...)` bindings (see the existing `data-gmaps` /
`data-report` / `data-show-results` handlers), not React components. The
Radix `Popover` used for the card-side chooser cannot be dropped in here
— none of the card-side chooser implementation is reusable for the map
popups; it needs its own vanilla-DOM handler, following the exact pattern
the existing buttons in this file already use. This is a second, separate
implementation, not a shared component with two call sites — worth
sizing as such if this gets built.

One clarification for both surfaces: navigation always targets the
amenity spot's own `lat`/`lon` — for a WC hosted inside a venue
(`host.kind === "venue"`), this is the toilet's own coordinate, not a
separate venue location (in practice the same point or a few metres off,
but the distinction matters for `host.kind === "venue"` cases where the
entrance used for the toilet differs slightly from the venue's own
`Place.coordinates`).

## Desktop implications

Everything above was framed around `getPlatform()` (`Capacitor.getPlatform()`
→ `"ios" | "android" | "web"`), which is a *native-app* signal — it cannot
distinguish a desktop browser from a mobile browser, both report `"web"`.
Working through what "Navigate here" means on desktop surfaces a gap the
concept didn't address explicitly.

- **Variant B is meaningless on desktop.** There is no OS-level hand-off
  to a turn-by-turn app on a computer. (One curiosity: macOS registers
  `maps://` for the desktop Apple Maps app, so it would technically work
  there — not worth building special-casing for a single-OS edge case
  that doesn't match the feature's actual intent.)
- **Desktop necessarily lands on Variant A** — the universal Google Maps
  URL, opened in a new browser tab with the route pre-filled. This isn't
  new work; it's the same fallback the concept already specified for "the
  plain PWA/web case," just requiring a more precise definition of that
  case (see below) than "not native."
- **The button's framing slightly overclaims on desktop.** "Navigation
  starten" is accurate on mobile (guided turn-by-turn genuinely begins).
  On desktop it opens a webpage where the user still has to interact
  (Google Maps hasn't started routing yet, just pre-filled the
  destination) — a real, if minor, promise gap worth a copy decision:
  either accept the imprecision, or use different wording on desktop
  (e.g. "In Google Maps öffnen" / "Open in Google Maps").
- **The chooser popover has nothing to choose from on desktop.** With
  only one real outcome (Google Maps in a new tab), showing a popover
  with a single option adds a click for no decision. On desktop the
  button should trigger Variant A directly, no popover step.

**The `getPlatform()` vs. `useIsMobile()` distinction this requires:**
`getPlatform()` alone conflates desktop and mobile web. The app already
has `useIsMobile()` (`hooks/useIsMobile.ts` — `pointer: coarse` or
`max-width: 767px`) for exactly this kind of layout-relevant distinction
elsewhere; the navigation feature needs the same second signal to tell
"mobile browser, might still hand off to an installed maps app via
platform app-links" (mobile web, Variant A behaves like it does today)
apart from "desktop, no hand-off is possible, this is just a Maps
webpage" (skip the popover, adjust copy if desired).

**What does *not* change:** `PlaceDebugSheet` and `AmenityCard` have no
desktop-specific styling today (no `md:`/`lg:` classes, no `isMobile`
branch) — the same components render on both. Placement 3's sticky
button and the `AmenityCard`/marker-popup treatment carry over to desktop
completely unchanged visually; this is a behavioural distinction (which
variant fires, whether a popover appears), not a layout one. It also
sharpens the original "native vs. web split" conclusion: on desktop there
is no native dimension at all — it's the purest possible case of Variant
A, 100% web app code, reusing the same `NativeLink`-style fallback the
concept already relies on elsewhere.

## Recommendation

**Variant B**, with Variant A as the automatic fallback for the plain
PWA/web case (no native scheme applies there anyway, so this is "free" —
the same component handles both). This gets the strongest, most literal
match to "start navigation" on both platforms with the least new
complexity, and keeps the native/web split almost entirely on the web
side. D's Android-chooser upside is real but narrow (only matters to
users with a non-Google nav app installed) and comes with a real
regression risk (weaker "did navigation actually start" guarantee) that
cuts against the feature's core promise — worth keeping in mind as a
possible *later* refinement, not a first cut.

If a chooser turns out to matter (see "Detail concept: Variant C" above),
its **reduced-scope version** — Android gets a real Google-Maps-vs-
system-chooser choice, iOS ships Apple-Maps-only (identical to B there) —
is the pragmatic middle ground: it adds Android-side choice without
pulling in the one genuine native project change (`Info.plist`) the full
version requires. The primary placement question is settled either way:
**Placement 3** (a dedicated, sticky button in `PlaceDebugSheet`,
optionally mirrored as a distinctly-iconed shortcut in the `PlaceCard`
footer) applies whether B or C ships.

## UI placement

Two natural spots, not mutually exclusive:

- **PlaceCard footer icon row** — one more icon alongside
  website/phone/Wheelmap, consistent with the existing pattern, minimal
  effort.
- **PlaceDebugSheet** — arguably deserves more prominence than a small
  icon here, given how central "get me there" is to an accessibility-
  focused app; a labelled button (not just an icon) fits the sheet's more
  spacious layout better than the card's compact footer.

## Native vs. web app split — summary

| | Web app (this Next.js codebase) | Native project (Xcode / Android Studio) |
|---|---|---|
| **A** | 100% — new `href` on existing `NativeLink` | none |
| **B / D** | ~95% — new `lib/native/navigation.ts` module (URI construction, `getPlatform()` branching, `window.location.href` hand-off) | ~5% — real-device verification of Android's default WebView scheme hand-off; a config-only fix in the unlikely case it doesn't already work, no code |
| **C** | ~70% — chooser UI + URL construction | Required: `Info.plist` `LSApplicationQueriesSchemes` entries per offered app (iOS), genuine Xcode project edit |

The overarching pattern: **almost all of this feature is web app code**,
following the exact shape of the existing `lib/native/geolocation.ts` /
`lib/native/browser.ts` modules — a small platform-aware wrapper function,
called from UI components that don't otherwise need to know or care
whether they're running natively or in a browser tab. The only variant
that pulls in real native-project work is C, and only because of iOS's
app-detection requirement specifically — everything else is a native
*capability* (the OS handing off a URI scheme) that the web app code
triggers, not native *code* the web app has to ship alongside.
