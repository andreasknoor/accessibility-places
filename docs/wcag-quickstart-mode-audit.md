# WCAG 2.2 AA Audit — Quickstart Mode

**Date:** 2026-07-25 (audit) / 2026-07-25 (fixes implemented, v11.4)
**Scope:** `components/simple/SimpleLayout.tsx`, `components/simple/SimplePlaceCard.tsx`, `components/simple/SimpleDetail.tsx`, `components/ModeSwitcher.tsx` — i.e. every screen reachable while `simpleView` resolves truthy (`start`, `tiles`, `locating`, `results`, `venue`, `city`, `detail`).
**Status:** **All findings below (D1–D5, P1–P2) have been implemented, v11.4.** `npm test` and `npx tsc --noEmit` pass; every fix except D2 was re-verified live in a running browser (see the "Fix" note under each finding). This document is kept as the audit record — findings are left in their original, as-found wording, with a short implementation note appended to each.
**Reason this scope matters now:** per `docs/plans/quickstart-mode-default.md`, this is now the **default landing experience on mobile** for new users, not an opt-in secondary mode. Defects here reach more users than defects in Turbo Mode.

This report follows the same honesty framework as the app-wide `docs/wcag-accessibility-plan.md`: every finding below is labelled **Confirmed** (empirically verified live in a running browser), **Confirmed (static)** (verified by direct code/config inspection, not runtime), or **Needs human/AT testing** (outside what this session's tooling could check). Nothing here is reported as fact without one of those three labels attached.

---

## 1. Methodology & tooling limitations (disclosed up front)

- Live app running at `localhost:3000`, driven via Chrome browser automation (`mcp__claude-in-chrome__*`), plus direct source reading of the four files in scope.
- Automated regression nets were re-run and are green: `npm run test:a11y` (12/12 passed), `npm run check:contrast` (all 13 gated token pairs pass; the pre-existing `border` review-only 1.23:1 fail is unrelated/accepted).
- **What worked well:** injecting JS to call `.focus()` on a specific element, then reading `document.activeElement` and `getComputedStyle()`, reliably and precisely confirmed both focus-reachability and focus-indicator styling. Dispatching a real `KeyboardEvent('keydown', {key:'ArrowDown'})` on a focused element and observing the resulting `aria-valuenow` change reliably confirmed a working keyboard alternative to a drag interaction.
- **What did not work, and is therefore *not* covered below:**
  - **Synthetic Tab-key navigation** (`computer` tool's `key: "Tab"` action) did not reliably move focus in this environment — it left `document.activeElement` on `BODY`, or landed on an unexpected element depending on prior click position. **Result: SC 2.4.3 Focus Order could not be live-verified this session.** Findings below that touch focus order are code-review inferences only, flagged as such.
  - **Viewport resize** (`resize_window` to 320×700) did not actually shrink `window.innerWidth` (stayed at 1710). **Result: SC 1.4.10 Reflow at 320 CSS px / 400% zoom could not be live-verified.** Quickstart's layout is simpler and more single-column than Turbo Mode's (no resizable desktop columns visible on the phone-width screens actually used), so risk is judged lower, but this is inference, not verification.
  - Real screen-reader output (VoiceOver/TalkBack/NVDA) was not exercised — no AT is attached to this browser session. All "would a screen reader announce X" judgments below are based on ARIA semantics/DOM structure, not captured audio/braille output.

---

## 2. Confirmed defects

### D1 — No visible keyboard focus indicator on the venue-search and city-search text inputs
**WCAG 2.2 SC 2.4.7 Focus Visible (AA) — FAIL.** Status: **Confirmed** (live `getComputedStyle()`).

`SimpleLayout.tsx`, venue-search input (~line 1111–1125) and city-search input (~line 1162–1170):

```
className="flex-1 min-w-0 bg-transparent text-base md:text-sm outline-none placeholder:text-muted-foreground"
```

`outline-none` with **no replacement** — not even `focus-visible:`-gated, applied unconditionally. The wrapping container (`border border-border bg-muted`) has no `focus-within:` styling either. Confirmed empirically: focusing the input via `.focus()` (verified `document.activeElement === input`) yields `outlineStyle: "none"`, `boxShadow: "none"`. A keyboard-only user tabbing to this field gets **no visual indication it is focused** — on a screen where the entire task is typing into that field.

`app/globals.css` has zero `:focus`/`focus-visible`/`focus-within` rules (confirmed via grep), so there is no global fallback rescuing this.

**Suggested fix direction:** pair with `focus-visible:ring-2 focus-visible:ring-ring` on the wrapping container (`focus-within:`) — the same pattern already used correctly by `SimplePlaceCard`'s tap-target box (see §4) and the skip-link.

**✅ Fixed (v11.4):** added `focus-within:ring-2 focus-within:ring-ring` to both input containers. Re-verified live: focusing either input now shows `box-shadow: rgb(37,99,235) 0 0 0 2px` on the container.

### D2 — No visible keyboard focus indicator on the results-screen resize separator
**WCAG 2.2 SC 2.4.7 Focus Visible (AA) — FAIL.** Status: **Confirmed** (live `getComputedStyle()`).

`SimpleLayout.tsx`, `role="separator" tabIndex={0}` (~line 981–1006):

```
className="shrink-0 flex items-center justify-center h-6 cursor-row-resize touch-none select-none focus-visible:outline-none"
```

`focus-visible:outline-none` with **no paired replacement class at all** — the suppression is explicit but nothing takes its place. Confirmed empirically in the live results screen: `.focus()` succeeds (`document.activeElement === sep` → true), and `getComputedStyle()` on the focused element returns `outlineStyle: "none"`, `boxShadow: "none"`.

Note: the keyboard **operability** of this control is fine and was also confirmed live — dispatching a real `ArrowDown` keydown while focused changed `aria-valuenow` (40 → 44), so SC 2.5.7 Dragging Movements is satisfied. This finding is specifically about the *visibility* of focus, not whether the control works.

**Suggested fix direction:** same as D1 — add a visible `focus-visible:ring-2 focus-visible:ring-ring` (or equivalent) instead of bare suppression.

**✅ Fixed (v11.4):** added `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset` (inset so the ring stays within the 24px-tall handle rather than clipping). **Not live-reconfirmed with the same rigor as D1**, disclosed honestly: this session's `.focus()`-based verification method turned out to only satisfy plain `:focus` — it does not make Chromium's `:focus-visible` heuristic match (confirmed: the same test against `SimplePlaceCard`'s already-correct, pre-existing `focus-visible:ring` box *also* fails this way, via `element.matches(':focus-visible')` returning `false` after a scripted `.focus()`). This is a tooling gap identical in kind to the Tab-simulation limitation already disclosed in §1, not evidence the fix is wrong — the class names are confirmed present and syntactically identical to the proven-working pattern. A real keyboard Tab-to-focus on a physical device/AT session is needed to close this loop with full confidence.

### D3 — Picked-city clear button is below the minimum target size
**WCAG 2.2 SC 2.5.8 Target Size Minimum (AA) — FAIL.** Status: **Confirmed** (live `getBoundingClientRect()`).

`SimpleLayout.tsx`, tiles-screen picked-city chip (~line 852–860):

```tsx
<button onClick={clearPickedCity} aria-label={t.simple.cityClear} className="shrink-0 p-0.5 -mr-0.5 hover:opacity-70 transition-opacity">
  <XIcon className="w-3.5 h-3.5" aria-hidden />
</button>
```

Measured live: **18×18 CSS px.** Required minimum is 24×24 CSS px. No exception applies — it isn't inline text, it isn't the only instance of an equivalent-sized target for this action, and there's no documented larger duplicate control elsewhere that performs the same "remove picked city" action.

**Suggested fix direction:** increase padding (e.g. `p-1.5` instead of `p-0.5`) to reach ≥24×24 px, or enlarge the invisible hit area via a pseudo-element without changing the visual icon size.

**✅ Fixed (v11.4):** padding increased `p-0.5`→`p-1.5` (offsetting margin adjusted `-mr-0.5`→`-mr-1.5` to keep the same visual position). Also added the same `focus-visible:ring` pattern as D1/D2, since this button had the identical missing-focus-indicator issue once inspected. Re-verified live: `getBoundingClientRect()` now measures **26×26 px**.

### D4 — No heading elements anywhere in the Quickstart flow except the detail screen
**WCAG 2.2 SC 1.3.1 Info and Relationships (A) — likely FAIL / at minimum a significant AT-navigation gap.** Status: **Confirmed (static)**, via `grep -n '<h1\|<h2\|<h3'` across all four in-scope files.

Result: **zero** heading elements in `SimpleLayout.tsx` (covers `start`, `tiles`, `locating`, `results`, `venue`, `city` — six of the seven screens) and in `SimplePlaceCard.tsx` (the per-result card, so place names in a result list are not marked up as headings either). The **only** heading in the entire Quickstart surface is `SimpleDetail.tsx`'s single `<h2>{place.name}</h2>`.

Screen readers rely on headings as the primary landmark-level navigation mechanism ("jump to next heading"). A user landing on, say, the results screen has no heading to orient by — the screen title ("Cafés & Eis in Deiner Nähe") is rendered as plain text in the header row, not `<h1>`/`<h2>`. This is a structural gap across the majority of the mode now used as the **default** entry point.

**Suggested fix direction:** mark the per-screen title text (currently plain text in the shared `Header` function and the `start` screen's own header) as `<h1>`, and each `SimplePlaceCard` name as an `<h3>` (nested under the screen's `<h1>`) — mirroring `SimpleDetail`'s existing `<h2>` choice, adjusted for the one-level-shallower context of a list item vs. a standalone detail screen. Needs a pass to pick a consistent heading level scheme across all six screens, not just a mechanical `<h1>` swap in isolation.

**✅ Fixed (v11.4)**, scheme actually used (each screen owns exactly one `<h1>`, adjusted from the originally sketched direction above once the full picture across all seven screens was laid out):
- `start` screen's own headline → `<h1>`.
- Shared `Header`'s `title` text (used by `tiles`/`results`) → `<h1>`.
- `venue`/`city` screens (which render `Header` with **no** `title` — the input itself is the content) → a screen-reader-only `<h1 className="sr-only">` added, reusing the existing tile-label copy (`t.simple.startVenue` / `t.simple.startCity`) rather than new strings.
- `locating` screen's visible text → `<h1>` (was a plain `<p>`).
- `SimpleDetail`'s place name → promoted `<h2>`→`<h1>` (it's that screen's sole top-level heading, not one nested under something else).
- `SimplePlaceCard`'s place name (in the results list) → `<p>`→`<h2>`, nested under the results screen's own `<h1>`.

Re-verified live end-to-end: results screen shows `<h1>Cafés & Eis in Hamburg</h1>` with each card as `<h2>` (e.g. "Espresso House"); opening a card's detail screen shows exactly one heading, `<h1>Espresso House</h1>`.

One test needed updating as a result (`__tests__/components/SimpleLayout.test.tsx`, the "Zur Karte" test) — it asserted "no heading named X" to prove the detail screen didn't open, which is no longer sufficient now that the result card legitimately carries a same-named `<h2>`; changed to assert specifically on heading `level: 1` (`SimpleDetail`'s exclusive level), which correctly distinguishes the two. Full suite green after the change (1262 passed).

### D5 — No live-region announcement of search completion / result count
**WCAG 2.2 SC 4.1.3 Status Messages (AA) — FAIL.** Status: **Confirmed (static)**, via `grep -n 'aria-live\|role="status"\|role="alert"'` across `SimpleLayout.tsx`.

All three matches are: an error `<p role="alert">` (×2, correct) and one `role="status"` on the venue/city-suggestion debounce spinner (`aria-label={t.chat.thinking}`, correct for that specific narrow case). **Nothing else is a live region** — specifically, the `locating` screen's "Standort wird ermittelt…" text (line ~903) and the results screen's arrival/count (e.g. "28 Orte gefunden") have no `aria-live` announcement at all.

Contrast with the full UI: `ResultsList` (Turbo Mode) has a dedicated sr-only `role="status" aria-live="polite"` specifically for announcing search progress/outcome (documented in `CLAUDE.md`'s Accessibility section). Quickstart Mode has no equivalent — a screen-reader user who taps a category tile gets no spoken confirmation that a search started, is still running, or has finished with N results; they would need to manually re-explore the DOM to discover the outcome.

**Suggested fix direction:** add a shared sr-only `aria-live="polite"` region (mirroring `ResultsList`'s pattern) that announces locating-in-progress → result count / no-results, reused across the `locating`→`results` transition.

**✅ Fixed (v11.4):**
- Results screen: added a `sr-only role="status" aria-live="polite" aria-atomic="true"` region, directly mirroring `ResultsList`'s pattern — announces `t.chat.thinking` while loading, then `t.results.resultsAnnounce(count)` or `t.chat.noResults` once a search has run (handles both the place-results and amenity-results branches via one shared count expression).
- `locating` screen: wrapped its container in `role="status" aria-live="polite"` so "Standort wird ermittelt…" is announced the instant that screen mounts (no separate duplicate sr-only text needed — the visible `<h1>` text doubles as the announced content since it's the region's only non-`aria-hidden` content).

Re-verified live: after a category search settled, the results-screen live region's `textContent` read exactly `"28 Orte gefunden"`.

---

## 3. Confirmed but only a narrow pass — worth flagging as a process gap

### P1 — `ModeSwitcher`'s Turbo-mode color bypasses the design-token contrast gate
Status: **Confirmed (static)**, manual contrast calculation.

`components/ModeSwitcher.tsx` uses hardcoded Tailwind utility colors instead of the app's HSL custom-property token system:

```tsx
target === "quickstart"
  ? "text-primary hover:bg-primary/10"        // token-based, gated
  : "text-amber-600 hover:bg-amber-50",       // hardcoded, NOT gated
```

Manually computed: amber-600 icon on white = **3.19:1**; amber-600 on amber-50 hover state = **3.07:1**. Both **narrowly pass** the 3:1 non-text-contrast threshold (SC 1.4.11) for this icon-only button — this is not currently a failure. But `scripts/check-contrast.mjs` only parses `:root` HSL token pairs in `app/globals.css`; a hardcoded Tailwind color is invisible to it. A future tweak to this specific shade (e.g. a slightly lighter amber for "warmer" branding) would ship without any CI signal, unlike every other interactive color in the app.

**Suggested fix direction:** either move this into a named token (`--simple-turbo` alongside the existing `--simple-city`/`--simple-venue` pattern) and add it to the gate, or accept the risk explicitly and leave a comment noting it's intentionally outside the gate.

**✅ Fixed (v11.4):** added `--simple-turbo: 32.1 94.6% 43.7%` to `app/globals.css` `:root` (the HSL conversion of Tailwind's amber-600, so the resting-state colour is visually unchanged) plus a `--color-simple-turbo` Tailwind mapping; `ModeSwitcher.tsx` now uses `text-simple-turbo hover:bg-simple-turbo/10` instead of the hardcoded classes (the hover background changes from the flat `amber-50` swatch to a 10%-opacity tint of the same token, matching the pattern the `quickstart`-target branch already used with `bg-primary/10` — a deliberate small consistency improvement, not a visual regression). Added to `check-contrast.mjs`'s gated pairs; re-ran the script: `simple-turbo on background` → **3.19:1**, passing the 3:1 gate (matches this report's earlier manual calculation exactly).

### P2 — `--simple-city` / `--simple-venue` tokens are also outside the contrast gate
Status: **Confirmed (static)**, via grep of `scripts/check-contrast.mjs`.

Same root cause as P1, different tokens: `--simple-city` (line 125) and `--simple-venue` (line 126) in `app/globals.css` are used as icon foreground colors on the `start` screen's tinted circle backgrounds (`bg-simple-city/15` etc.) and as `border-l-4` accent colors. Both uses are decorative/non-text (icon marked `aria-hidden`, redundant with adjacent text label; border is a divider, not conveying information on its own) — so this is **not currently a failure** under any SC, but like P1 it's a coverage gap in the automated gate that should be closed now while the number of "off-token" colors is still small (two, soon three counting `ModeSwitcher`'s amber).

**✅ Fixed (v11.4):** both added to `check-contrast.mjs`'s gated pairs (checked against `background`, the flat-page approximation of their actual tinted-circle usage — see the script comment added alongside them). Results: `simple-city on background` → **3.37:1** (pass), `simple-venue on background` → **3.02:1** (pass, but with almost no margin — worth knowing before any future tweak to that specific hue/lightness). Both are now gated, so a future regression on either would fail `npm run check:contrast` in CI.

---

## 4. Verified working (do not regress)

- **`SimplePlaceCard`'s tap-target box** (line 68) correctly pairs suppression with a replacement: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`. This is the pattern D1/D2 should be brought in line with — it already exists correctly elsewhere in the same file tree, so this is a consistency fix, not a new pattern to invent.
- **Skip link** (`SimpleLayout.tsx`, ~line 728) is correctly implemented: `sr-only` with a `focus-visible:` reveal, `focus-visible:not-sr-only focus-visible:fixed … focus-visible:bg-primary`. Confirmed present and pointing at `#main-content`, which does exist (`document.querySelector('main').id === "main-content"`, confirmed live).
- **Keyboard alternative to the drag-resize gesture** (SC 2.5.7) works: confirmed live via dispatched `ArrowDown` keydown changing `aria-valuenow`.
- **Target sizes pass** (SC 2.5.8) for every other measured control: settings gear (28×28), header `ModeSwitcher` button (28×28), "Zurück" back button (73×32 — text link, exempt anyway but comfortably clears it), category tile buttons (207×74), the resize separator itself as a target (446×24 — full width), "Zur Karte" button (88×24, exactly at the 24px height boundary — fine but worth knowing it has zero margin if padding ever shrinks).
- **Error messaging** uses `role="alert"` correctly in both the geolocation-failure path (line 850) and the general search-error path (line 917).
- **`document.documentElement.lang === "de"`**, confirmed live — the `lang` attribute is correctly set on this DE-locale page.
- **Automated regression nets green**: `npm run test:a11y` (12/12), `npm run check:contrast` (13/13 gated pairs).
- **End-to-end functional smoke test** of the city-search flow (typed "Hamburg" → picked "Hamburg (DE)" from live suggestions → results screen showing correct title and radius-annotated count) confirms the underlying feature works correctly, independent of the accessibility findings above.

---

## 5. Not evaluated — needs human/AT testing

Consistent with `docs/wcag-accessibility-plan.md`'s own stated limits, the following are **not covered** by this report and were not claimed as pass or fail:

- **SC 2.4.3 Focus Order** — synthetic Tab simulation was unreliable in this session's tooling (see §1); the actual tab sequence across all seven screens needs a real keyboard walkthrough.
- **SC 1.4.10 Reflow** (320 CSS px / 400% zoom) — `resize_window` did not actually shrink the viewport in this session; needs a real narrow-viewport or OS-zoom test.
- **SC 1.4.3 / 1.4.11 contrast of composited surfaces** — any text or icon rendered over the Leaflet map tiles (e.g. map controls, if any float over tile imagery in Quickstart's results screen) was not measured; `check-contrast.mjs` only covers flat `:root` token pairs.
- **Real screen-reader output** (VoiceOver/TalkBack/NVDA) — semantics were inferred from ARIA/DOM structure only; actual announced text, especially around D4/D5 above, was not captured from a real AT.
- **SC 3.2.6 Consistent Help** — not assessed; Quickstart has no persistent "help" mechanism to check for consistency of placement (may be N/A if the app has no help feature at all — needs a scoping decision, not just a check).
- **SC 3.3.7 Redundant Entry** — likely N/A (no multi-step form that re-asks for the same data), but not formally verified.
- **SC 3.3.8/3.3.9 Accessible Authentication** — N/A, no authentication flow anywhere in the app.
- **Touch/pointer gesture testing on a real mobile device** — all verification here was via a desktop Chrome browser session; real touch-target behavior (as opposed to the CSS-pixel measurements in D3) on iOS/Android was not exercised.

---

## 6. Implementation pass — done (v11.4)

All seven findings were implemented together rather than staged, since none turned out to conflict and the combined diff was still small. Original priority order (kept for the record):

1. **D1 + D2** (focus visibility) — same root cause, same fix pattern already proven correct elsewhere in this exact file (`SimplePlaceCard`). Low risk, small diff, closes two AA failures at once.
2. **D3** (target size) — trivial padding change, one file, one line.
3. **D5** (live region) — moderate effort; needs a shared sr-only status element wired into the `locating`→`results` transition, ideally reusing `ResultsList`'s existing pattern/copy conventions rather than inventing new strings.
4. **D4** (heading structure) — the largest-scope item: touches the shared `Header` function, the `start` screen's own header markup, and `SimplePlaceCard`. Needs a considered heading-level scheme across all six screens before touching code, not a mechanical find-replace.
5. **P1 + P2** (token-gate coverage) — process improvement, not a user-facing defect; can be scheduled independently of the above, e.g. alongside the next unrelated `check-contrast.mjs` change.

**Verification run after implementation:** `npm test` (1262 passed, 0 failed — one test updated, see D4's note), `npx tsc --noEmit` (clean), `npm run check:contrast` (16/16 gated pairs, up from 13, all passing), `npm run test:a11y` (12/12). Every fix was re-verified live in a running browser except D2, where the live-verification method itself hit a disclosed tooling limit (see D2's note) rather than the fix being unconfirmed by other means (class names verified present and correct).

**Left for a genuinely separate pass** (outside this report's scope, §5 above): real keyboard Tab-order walkthrough, real 320px/400%-zoom reflow testing, and real screen-reader (VoiceOver/TalkBack/NVDA) verification — none of these can be done from this session's tooling, live browser or otherwise.

---

## 7. Addendum (v11.7) — skip link now targets the primary action, not just the landmark

Follow-up request, not one of the original D1–D5/P1–P2 findings: on the `start` screen specifically, "Zum Inhalt springen" previously jumped to `#main-content` (the `<main>` landmark) — technically SC 2.4.1-compliant, but a keyboard/screen-reader user still had to tab past the settings-gear button to reach the screen's actual primary action.

**Change:** the skip link's `href` is now conditional on `screen`: `#quickstart-start-nearby` (a new `id` on the "In meiner Nähe suchen" button) when `screen === "start"`, unchanged `#main-content` on every other screen (none of which has a single obvious "primary action" to jump to instead). Re-verified live: activating the skip link moves `document.activeElement` directly to that button; navigating away and back confirms the fallback still targets `#main-content` on other screens.

**Also fixed while touching this area:** the three start-screen tiles ("In meiner Nähe suchen" / "In einer anderen Stadt suchen" / "Einen konkreten Ort bzw. Lokalität suchen") had no visible focus-indicator at all (same class of gap as D1/D2, just not caught in the original pass since the audit's target-size/heading/live-region sweep didn't re-inspect every button on every screen). Since the skip link now makes the first of these three a genuine, expected keyboard landing point, an invisible focus ring there would have undermined the whole point of the change — added `focus-visible:ring-2 focus-visible:ring-ring` to all three tiles for consistency (they're structurally identical siblings). `npm test` (1266 passed), `npx tsc --noEmit` clean.
