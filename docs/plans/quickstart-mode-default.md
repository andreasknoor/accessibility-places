# Quickstart Mode as the default start for new users

Status: **implemented** (v11.0, 2026-07-25) — uncommitted at time of writing.

Deviations from the plan, decided during implementation:
- The mode is resolved live from a tri-state field rather than seeded; see
  Phase 2/5 below, which merged into one mechanism.
- Phase 5's "optional soft guard" (`ap_visited`) turned out to be load-bearing
  after all — without it every existing mobile user who never touched the
  setting would have been moved into Quickstart. It is snapshotted per tab
  session in `sessionStorage`, not read per mount.
- The native quick-action path initially took the Turbo fallback; since v11.1
  it follows the active mode instead (Phase 4's last bullet), so no scoped-out
  deep-link path remains.

Revised after a critical review of the first draft. The original Phase 4 seeded
a persisted value from inside `loadSettings()`; that carried a data-corruption
risk on iOS and has been replaced by a tri-state field (see Phase 2). Three
factual errors about the code were also corrected — the Quickstart start screen
has no gear icon, the main SEO link is not a pure place link, and
`settings.simpleView` is not readable on the first render.

## Goal

New installs land in **Quickstart Mode** (today's Simple View,
`settings.simpleView`) instead of Turbo Mode. Quickstart's own start screen
(`simple.startTitle` — "Wie willst Du suchen?", three labelled routes) doubles
as the welcome screen, so a first-time user reaches an actionable state with
zero interstitials.

Existing users and anyone who has switched to Turbo are unaffected.

Naming and iconography (decided separately): **Quickstart Mode** uses a
play-circle glyph in the primary blue; **Turbo Mode** uses a gauge glyph in
orange. Both replace the current "Einfache Ansicht (Beta)" label.

## Why Variant 1 (Quickstart default) over an explicit mode prompt

The risk is asymmetric. If Quickstart turns out to be too little, the switch is
one tap away and — after Phase 1 — visibly so. If Turbo is the default and
turns out to be too much, the user may abandon the app before ever finding the
switch.

An explicit "which mode do you want?" screen was rejected: it asks users to
choose between two things they have not seen, and it would add a second
interstitial on top of the existing `isFirstVisit` welcome screen (or replace
it, losing its "In der Nähe suchen" CTA). It would also widen the surface of
the known `isFirstVisit` cold-start race (React #418).

## Scope: mobile default, universal availability

The question "should Quickstart be smartphone-only?" splits into two that are
answered differently:

- **Default** — Quickstart is the default only on mobile/touch devices. A
  desktop browser starts in Turbo.
- **Availability** — the switcher exists in both layouts. A desktop user who
  wants Quickstart gets it.

A hard mobile gate was rejected. Quickstart is built on mobile premises (one
screen at a time, a back button, three large tap targets) and on a wide display
it is a phone-width column in whitespace — so it should not be forced on
desktop users. But the people who most need a reduced interface are not defined
by their device: cognitive, visual and motor impairments are heavily
represented among *desktop* assistive-technology users, precisely because
desktop screen readers and switch access are more mature than their mobile
counterparts. Gating a simplification feature to phones would tell exactly
those users that the full UI is their only option on the platform they use most
— the wrong answer for an accessibility product.

`useIsMobile()` (`hooks/useIsMobile.ts`, `(pointer: coarse), (max-width: 767px)`)
measures input type and width, not need. It does happen to catch a desktop
browser at 400 % zoom (WCAG 2.2 SC 1.4.10 reflow shrinks the CSS viewport below
767 px), which is a point in a gate's favour — but it does nothing for someone
at 100 % zoom who simply wants fewer choices.

## Findings from the code (verified 2026-07-25)

All line numbers are as of this writing.

1. **The Quickstart branch returns before every layout branch.**
   `if (settings.simpleView) { return <SimpleLayout … /> }` sits at
   `app/HomeClient.tsx:1726`, ahead of both the mobile (`isMobile`) and desktop
   returns. Deep-link props never influence which branch is taken. Quickstart
   therefore also renders on desktop, inside a `max-w-md` phone-width column.

2. **`settings` is not readable on the first render.** `HomeClient:174` uses
   `useSettings()`, which starts at `DEFAULT_APP_SETTINGS` and loads in a
   *passive* `useEffect` (`lib/settings.ts:155–159`). So `settings.simpleView`
   is the default on the first render and only settles afterwards — the branch
   at `:1726` renders Turbo first, then swaps. Today invisible (default and
   stored value agree for nearly everyone); after Phase 5 it becomes a visible
   layout swap. Partly masked by `SplashOverlay`, but only partly: that
   overlay shows on mobile only (`SplashOverlay.tsx:23`) and only on the first
   home mount of a tab session (`:22`). **Not** covered: returning from
   FAQ/Impressum via "Zurück" (remounts `HomeClient`), desktop users who chose
   Quickstart, and warm remounts. Phase 5 must resolve the initial value
   synchronously — the lazy-`useState` pattern already used for `sortBy`
   (`:232`) and `amenityRadiusKm` (`:257`).

3. **`localStorage` is not reliably readable at layout-effect time on iOS.**
   `HomeClient:405–413` documents it: "on cold start localStorage is not yet
   readable at layout-effect time, so `loadSettings()` returns the default …
   and a saved preference is lost." This is why nothing in this plan may
   *write* a one-time decision derived from a `localStorage` read — a bad read
   followed by a good write permanently mis-modes an existing user. Render-time
   reads that are wrong are acceptable (self-healing on the next explicit
   choice); one-time writes are not.

4. **`loadSettings()` is pure and has many callers.** `lib/settings.ts:127`,
   called from `loadSavedPrefs()` (`HomeClient:127`), two lazy `useState`
   initialisers (`:232`, `:257`), a layout effect (`:399`) and `useSettings()`'
   effect (`lib/settings.ts:158`). `saveSettings` (`:150`) is module-private.
   No seeding side effect belongs here.

5. **The existing merge already yields a tri-state for free.**
   `loadSettings()` does `{ ...DEFAULT_APP_SETTINGS, ...stored }` (`:133`) and
   returns `DEFAULT_APP_SETTINGS` when there is no blob (`:131`). Since
   `saveSettings` persists the whole merged object (`:151`), anyone who has
   *ever* changed *any* setting has an explicit `simpleView` value stored. So
   "key absent" already means exactly "never expressed a preference" — no
   migration code is needed to detect it. This is what Phase 2 exploits.

6. **`SimpleLayout` receives no deep-link props at all**
   (`HomeClient:1732–1757`). It owns an internal screen state machine
   initialised to `"start"` (`components/simple/SimpleLayout.tsx:166`,
   `type Screen = "start" | "tiles" | "locating" | "results" | "venue" | "city" | "detail"`).
   Nothing external can route it to `"results"` or `"detail"`.

7. **Deep-link effects still fire in Quickstart, invisibly.**
   `runPlaceDeepLink` (`HomeClient:964`) and the mount effect at `:1009` are
   hooks *above* the early return, so a deep link does run a search and fill
   `places` — but `SimpleLayout` keeps rendering `"start"`.

8. **There are three deep-link shapes, not two.** `isPlaceDeepLink` is
   `!initialCity && selectLat && selectLon` (`:171`) — so a link carrying
   *both* `q=` and `selectLat=` is **not** a place deep link. That combined
   shape is exactly what `components/seo/SeoPageContent.tsx:267` generates for
   every SEO result ("Mehr Details in Accessible-Places"), i.e. the app's most
   important external link. It is handled by the *city* path at `:942`
   (`handleSearch("<term> in <city>", …, initialSelectName)`), while the place
   path at `:1010` explicitly bails when `initialCity` is set.

9. **The Quickstart start screen has no `<Header>` and no gear icon.**
   `SimpleLayout.tsx:647–654`: its top row contains only `LanguageSwitcher`.
   The shared `<Header>` (`:128–153`, with gear + language) is used by
   `tiles`/`results`/`venue`/`city`/`detail` only. The "Turbo-Modus an" pill
   (`:710–723`) likewise exists only on the start screen.

10. **Two stale comments claim the settings toggle is the only way out of
    Quickstart** — `lib/settings.ts:45–47` and
    `components/settings/SettingsSheet.tsx:154–157`. Untrue since v10.69, when
    the pill started flipping `simpleView` off directly. Correct them in
    Phase 1, which removes the row they describe.

11. **`LanguageSwitcher` navigates.** It calls `router.push()` between `/` and
    `/en` (`components/LanguageSwitcher.tsx:22–23`). Anything hosting it must
    tolerate being unmounted by its own control.

12. **`markVisited()` fires on more than searches** — `HomeClient:512`
    (`handleSearch`), `:1063` (`handleGpsResolved`, i.e. mere GPS resolution,
    including launch auto-locate) and `:1152` (amenity search). All three are
    reachable from Quickstart, so `ap_visited` stays a valid "has used the app"
    signal there — but it is broader than "has searched".

## Phase order

Phases 1–4 are all preconditions for the default change in Phase 5. Landing
Phase 5 early would strand new users on Quickstart screens with no visible exit
(finding 9) and break every external link for them (findings 6–8).

**Effort is not evenly distributed.** Phase 4 is roughly as large as Phases 1,
2, 3, 5 and 6 combined; plan it as two separate pieces of work.

---

## Phase 1 — Mode switcher into the header, language into settings

Reshuffles three controls without changing behaviour, so the mode is
discoverable *before* it becomes the default.

- **Mode switcher takes the language switcher's header slot** in the three
  headers that have one: `components/mobile/MobileLayout.tsx:294–305` (radius
  pill → `LanguageSwitcher` → gear), the shared `SimpleLayout` `Header`
  (`:128–153`), and the desktop header (`HomeClient:1925`). The gear stays
  rightmost; the header keeps three elements.
- **Leave the Quickstart start screen alone** (`SimpleLayout.tsx:647–654`).
  Per finding 9 it has no gear and no `<Header>` — its top row is the only
  language access that screen has, and it already carries the "Turbo-Modus an"
  pill, so a second mode control there would be redundant *and* would remove
  the last way to change language before entering the app. This is the one
  place the swap must **not** happen.
- **Desktop**: Quickstart is not the desktop default (see Scope) but stays
  available there, so the desktop header needs both the way in and the way out.
- **Language switcher becomes the first row in the settings sheet**
  (`components/settings/SettingsSheet.tsx:150–163`). Prominent placement
  matters: a first-time visitor who landed in the wrong language must still
  find it quickly. Needs a label + hint string pair in `lib/i18n/de.ts` and
  `en.ts`.

  Per finding 11 it navigates, which unmounts the sheet. Close the sheet
  explicitly before `router.push()` rather than letting it vanish mid-
  interaction, and word the hint so the reload is expected.
- **Remove the `simpleView` row from the settings sheet** (`:158–163`). With a
  one-tap header control on every screen that has a header, plus the start
  screen's pill, a third entry point writing the same value is redundant — the
  same reasoning that removed the duplicate `alwaysShowParking` toggle in
  v9.64.
- Correct the two stale "ONLY way back" comments (finding 10), and rewrite the
  `Header` doc comment at `SimpleLayout.tsx:122–127`, which explains the
  arrangement being changed.

Keep the internal field name `simpleView`. Renaming it to `quickstart` would
invalidate every stored `ap_settings` blob for no user-visible gain; the rename
belongs in the i18n strings only.

## Phase 2 — Make `simpleView` tri-state (no behaviour change)

The field currently models two states but needs three: *chose Quickstart*,
*chose Turbo*, *never chose*. Without the third, deciding a default requires
seeding a persisted value — which cannot be done safely (finding 3).

- `AppSettings.simpleView: boolean` → `boolean | null`, `null` = never chosen.
  `DEFAULT_APP_SETTINGS.simpleView: null`. The pattern already exists twice in
  the same interface (`defaultSearchMode`, `defaultChipCat`).
- **No migration code.** Per finding 5 the existing merge already produces the
  right value in every case: an explicit stored `false`/`true` survives; a blob
  without the key yields `null`; no blob at all yields `null`.
- Resolve `null` at the single read site. In this phase, resolve it to `false`
  so nothing changes for anyone; Phase 5 changes only that expression.
- Update the `AppSettings.simpleView` doc comment (`lib/settings.ts:38–48`) —
  it currently describes the two-state model and the removed settings row.

This phase is behaviourally inert and can land on its own.

## Phase 3 — Deep-link resolver and Turbo fallback

- Add one **resolver** shared by this phase and Phase 4:

  ```
  resolveDeepLinkTarget(props) → "quickstart-detail" | "quickstart-results" | "turbo" | null
  ```

  `null` = no deep link. It must handle all three shapes from finding 8 — `q`
  + `cat`; `selectLat` + `selectLon`; and the combined SEO shape carrying both.
  In this phase every non-`null` result is treated as `"turbo"`; Phase 4 fills
  in the two Quickstart branches. Two independently grown conditions across the
  phases is exactly the drift this avoids.
- Add a session-scoped override in `HomeClient`,
  `const [deepLinkForcesTurbo, setDeepLinkForcesTurbo] = useState(false)`, and
  change the branch at `:1726` accordingly.
- Seed it from props deterministically, the same way `isPlaceDeepLink` is
  computed (`:171`), so there is no hydration mismatch.
- Set it from `runPlaceDeepLink` (`:964`) too — the only path on iOS, where
  props are never populated, on both cold and warm launch. Set it alongside the
  existing `setIsFirstVisit(false)` / `setChatMode("text")` calls, which are
  there for the same "external intent outranks the startup default" reason.
- Same in the native quick-action handler (`:1363` `checkAction`).
- **Never call `updateSettings` here.** The override lives and dies with the
  mount; the next ordinary launch is back in Quickstart. One tapped link must
  not permanently eject anyone.

After Phase 4 this becomes the fallback for links Quickstart genuinely cannot
represent, not a temporary crutch.

## Phase 4 — Quickstart honours deep links

The largest phase; split it in two. Phase 3 alone is not an acceptable end
state — a first-time user arriving via an SEO link is precisely the audience
Quickstart exists for, and Phase 3 drops them into the full UI.

### 4a — Place links → the `detail` screen

- `SimpleLayout` already renders a `Place` via `SimpleDetail`
  (`components/simple/SimpleDetail.tsx:39`, props `place`, `distanceM`,
  `onBack`, `onOpenSettings`); it just has no external entry point. Add a prop
  that seeds `selectedPlace` + `screen: "detail"` once the search resolves.
- Reuse the existing defensive fallback at `SimpleLayout.tsx:590–598` ("detail
  requested but no place") rather than adding a second one — note its comment
  says the state is "currently unreachable", which this phase changes. Update
  it.
- Set `detailReturnTo` deliberately: a deep-linked user has no `results` screen
  behind them, so back must lead to `start`, not to an empty list.

### 4b — City/category links → the `results` screen

- Seed `pickedCity` and `selectedCategory`, then `screen: "results"`.
- Only possible for the intersection of the 10 SEO categories
  (`SEO_CATEGORY_SLUGS`, `lib/cities.ts`) and the 8 Quickstart tiles
  (`SIMPLE_CATEGORIES`, `lib/settings.ts:70`) — currently `cafe`, `restaurant`,
  `hotel`, `attraction`.
- **Everything outside that intersection returns `"turbo"` from the resolver.**
  A `theater` or `biergarten` link has no Quickstart tile; silently searching a
  different category, or showing an empty tile screen, would both be worse than
  the full UI. Make it an explicit, commented branch, not an accident of the
  mapping.
- The combined SEO shape (finding 8) is the common case: route it to
  `"quickstart-detail"` when its category is in the intersection, since the
  user tapped a specific venue; fall back to `"turbo"` otherwise.
- Native quick actions (`pendingFocusAction` → `handleAmenitySearch`) target
  the parking/WC amenity search. Quickstart has its own amenity path
  (`handleSimpleAmenitySearch`, `onAmenitySearch`), so route them there rather
  than to the Turbo fallback.

## Phase 5 — The device-aware default

With Phase 2 in place this is one expression, not a migration.

- Resolve the branch as: explicit stored value wins; `null` falls back to
  whether the device matches the mobile query.
- **Resolve it synchronously on the first render** (finding 2), via a lazy
  `useState` initialiser in `HomeClient` — the pattern already used for
  `sortBy` (`:232`) and `amenityRadiusKm` (`:257`) — then reconcile with
  `settings.simpleView` once `useSettings()` resolves. Without this the app
  paints Turbo and swaps to Quickstart on every uncovered cold start.
- **Reuse `useIsMobile`'s query string** (`(pointer: coarse), (max-width: 767px)`,
  `hooks/useIsMobile.ts:5`); export the constant so the fallback and the layout
  branch cannot drift apart. Guard for the SSR/no-`window` path.
- **Optional soft guard for returning users.** Someone who used the app but
  never changed a setting has no `ap_settings` blob, so they resolve to `null`
  and would move to Quickstart. Reading `ap_visited` (finding 12) can suppress
  that. Unlike the original design this is a **render-time read only** — it
  writes nothing, so the iOS racy-read case (finding 3) merely shows Quickstart
  once to an existing user, who switches back with one tap and has the choice
  persisted from then on. Self-healing, so the read is allowed to be wrong.
  Recommended, but not load-bearing.
- Per-device by design: `localStorage` is per-origin-per-device, so a phone and
  a desktop browser decide independently. The native shells always match the
  mobile query.

## Phase 6 — Consolidate the welcome screen

With Quickstart as the default, a new user would otherwise meet *two* welcome
surfaces: the `isFirstVisit` screen and Quickstart's own start screen.

- Suppress the `isFirstVisit` welcome UI while Quickstart is active. It lives
  inside `MobileLayout` and `ChatPanel`, neither of which is mounted in the
  Quickstart branch — so this likely needs no code. Verify rather than assume.
- `ap_visited` is set from all three Quickstart routes via `markVisited()`
  (finding 12), so the Phase 5 soft guard stays meaningful.
- `onResetOnboarding` clears both keys (`:1826`, `:1926`). After Phase 5 that
  also means "behave like a fresh install", i.e. return to Quickstart on
  mobile. Correct, but a change worth a line in the reset UI's description.

## Tests

- **Tri-state resolution** (Phase 2): stored `true` → Quickstart; stored
  `false` → Turbo; key absent → `null`; no blob → `null`; an explicit value is
  never overwritten in either direction.
- **Default resolution** (Phase 5): `null` + mobile query matches → Quickstart;
  `null` + desktop → Turbo; `null` + mobile + `ap_visited` present → Turbo (if
  the soft guard ships).

  `vitest.setup.ts:51` mocks `window.matchMedia` to always return
  `matches: false` (desktop). The mobile cases **must** override that mock —
  otherwise they silently exercise only the desktop branch and pass for the
  wrong reason.
- **Nothing is written at startup**: after any first render in any mode,
  `ap_settings` is unchanged unless the user acted.
- **Resolver** (Phase 3): all three link shapes from finding 8, plus an
  in-intersection and an out-of-intersection category.
- **Availability, not just default**: with a stored `simpleView: true`, a
  desktop-width render still returns `SimpleLayout` — the default resolution
  decides the starting value, never what the branch at `:1726` may render.
- **Settings sheet**: no `simpleView` row; language row present and first.
- **Headers**: mode switcher present in `MobileLayout`, `SimpleLayout.Header`
  and the desktop header; `LanguageSwitcher` absent from those three but still
  present on the Quickstart start screen.
- Extend `__tests__/a11y/` for the new header control — it needs an
  `aria-label` naming the target mode, not a bare "switch".

Run `npm test` and `npx tsc --noEmit` before pushing. Phase 2 widens
`AppSettings.simpleView` to `boolean | null`, which will surface in every
settings fixture across the suite and in any `if (settings.simpleView)` narrow
— `tsc` catches these, `vitest` does not.

## Conventions

Bump `APP_VERSION` in `lib/config.ts` on every commit, carried as a `(vX.Y)`
suffix in the commit message. Add a `CHANGELOG.md` row for the default change —
a genuine user-facing feature, not a tweak. All new user-facing strings go
through `lib/i18n/de.ts` + `en.ts` (labels, hints, and the switcher's
`aria-label`).
