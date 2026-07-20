# WCAG 2.2 AA Audit — 2026-07-20

Scope: automated regression tooling (`npm run test:a11y`, `npm run check:contrast`) plus a manual code
audit of components not yet covered by the axe suite (`ChatPanel`, `PlaceDebugSheet`, `MapView`), per the
gaps flagged in `docs/wcag-accessibility-plan.md`. All findings below are code-verified (file + line), not
speculative. Consistent with that plan's own honesty caveat: this is a **code-level audit**, not a
substitute for a real screen-reader/keyboard pass by a human — none of the below required runtime/visual
observation to find, so they're additive to (not a replacement for) that outstanding manual work.

**Automated gates (unaffected):** `test:a11y` (axe/vitest-axe) — 5/5 passing, 0 structural violations on
the covered components. `check:contrast` — all 13 gating token pairs pass WCAG contrast.

---

**Update 2026-07-20 (v10.30):** all Serious and Moderate findings below (#1–#7) are fixed. #8 (minor)
remains open.

## Blocker
None found.

## Serious

### 1. Central search input has no accessible name — ✅ FIXED (v10.30)
**File:** `components/chat/ChatPanel.tsx:1335` (input), `role="combobox"` on the wrapper
**SC:** 1.3.1 Info and Relationships / 3.3.2 Labels or Instructions
The app's single unified search field — the primary entry point to every search flow — has no `<label>`,
`aria-label`, or `aria-labelledby`. It relies solely on `placeholder` (`t.chat.unifiedPlaceholder` /
`t.chat.nearbyTokenPlaceholder`), which WCAG explicitly does not accept as a programmatic label: it
disappears on input and many screen readers don't reliably expose it as the field's name. A screen-reader
user landing on this control hears an unlabeled combobox.
**Fix direction:** add `aria-label` (or a visually-hidden `<label htmlFor>`) sourced from i18n, distinct
from the placeholder text so it still reads sensibly once the field has content.

### 2. Place-detail sheet has no heading structure — ✅ FIXED (v10.30)
**File:** `components/results/PlaceDebugSheet.tsx` (whole file — confirmed zero `<h1>`–`<h6>` elements);
title node at line 447 is a `<p id="place-sheet-title">`, referenced by `aria-labelledby` on the dialog
(line 439).
**SC:** 1.3.1 Info and Relationships / 2.4.6 Headings and Labels
This is a long modal with multiple distinct sections (accessibility criteria, source attributions,
comments, navigation actions). `aria-labelledby` correctly names the dialog, but with no real heading
anywhere inside, screen-reader users lose heading-navigation (`H` key in NVDA/VoiceOver rotor) as a way to
jump between sections — they're forced to read linearly through a long, dense sheet. This is the exact
component the existing plan flags as not yet in the axe suite, and axe's structural check wouldn't have
caught this specific gap anyway (a docless `<p>`-as-title is not an axe violation).
**Fix direction:** promote the title `<p>` to an `<h2>` (the sheet is a dialog, not the document root, so
`h1` is reserved for the page) and give each internal section a real heading rather than a purely visual
label.

## Moderate

### 3. Map popup action buttons under the 24×24px minimum touch target — ✅ FIXED (v10.30)
**File:** `components/map/MapView.tsx:201` (popup action-chip markup, hand-built HTML string for Leaflet)
**SC:** 2.5.8 Target Size (Minimum) — new in WCAG 2.2 AA
The popup's action chips (Navigate / Google Maps / Details, etc.) render at ~22px tall, under the 24 CSS-px
minimum WCAG 2.2 introduces. Small but on a core flow (every marker tap goes through this popup) and on a
touch surface (mobile map use) where target size matters most.
**Fix direction:** bump padding/min-height on `.popup-cta`/`.popup-link` classes to clear 24px, or use the
2.2 spacing exception if targets are otherwise inline text links.

### 4. Parking marker tiers distinguished by hue only — ✅ FIXED (v10.30)
**File:** `components/map/MapView.tsx:331` (marker icon builder)
**SC:** 1.4.1 Use of Color
Reserved-disabled vs. merely-wheelchair-accessible parking spots render the identical "P" glyph, differing
only by fill color (blue vs. orange). This is distinct from the already-accepted/documented "Ampel"
confidence scheme (red/amber/green, red-green colorblindness knowingly accepted per project memory) — this
is a *second*, undocumented color-only distinction on the same map, not covered by that prior decision.
**Fix direction:** differentiate glyph or add a small badge/border, not just hue — same treatment the
confidence markers already got.

### 5. Radius preset selection conveyed by color only — ✅ FIXED (v10.30)
**File:** `components/filters/RadiusPresetPopover.tsx:49`
**SC:** 4.1.2 Name, Role, Value
The active radius preset button is marked only via a background-color class; no `aria-pressed` /
`aria-checked` / `aria-selected` is set, so assistive tech has no way to announce which preset is currently
active.
**Fix direction:** add `aria-pressed={isActive}` to each preset button (same pattern already used for the
"Hier suchen" / parking-toggle buttons in `MapView`, per the existing plan's Phase 4 notes).

### 6. Welcome-screen list/map picker conveyed by color + unlabeled icon — ✅ FIXED (v10.30)
**File:** `components/mobile/MobileLayout.tsx:374`
**SC:** 4.1.2 Name, Role, Value
The default-view picker (list vs. map, shown once on first visit) exposes the selected option only via
border color plus a `CheckCircle2` icon with no accessible name — no `role`/`aria-pressed` on the option
buttons.
**Fix direction:** same `aria-pressed` treatment as #5; ensure the check icon is `aria-hidden` (decorative,
state already conveyed by the button's `aria-pressed`).

### 7. "Report weak parking spot" outcome not announced — ✅ FIXED (v10.30)
**File:** `components/results/AmenityCard.tsx:90`, mirrored in `components/map/MapView.tsx:936-944`
**SC:** 4.1.3 Status Messages
After the report-parking fetch resolves, only the button's visible text changes (e.g. to a success/failure
state) — there's no `aria-live` region announcing the outcome, so screen-reader users get no confirmation
the report succeeded or failed unless they happen to have focus on the button and it's read on focus (it
generally won't re-announce on a passive text swap without a live region).
**Fix direction:** wrap the status text in a small `aria-live="polite"` region, consistent with the pattern
`ResultsList` already uses for search-progress announcements.

## Minor

### 8. Hardcoded English `title` in an otherwise German UI
**File:** `components/mobile/MobileLayout.tsx:279`
**SC:** 3.1.2 Language of Parts
The header reset button's `title="Reset"` is hardcoded English text inside the DE-locale mobile shell, not
routed through `lib/i18n` and not marked `lang="en"`. Low-severity (tooltip text, not a primary label) but
violates the project's own stated i18n invariant ("every visible and assistive string goes through
lib/i18n") in addition to 3.1.2.
**Fix direction:** move to `lib/i18n` (`common.reset` or similar) like every other UI string in the app.

---

## Suggested priority order
1. **#1 search input label** — highest reach (every search), cheapest fix (one `aria-label`).
2. **#2 PlaceDebugSheet headings** — affects every place-detail view, the app's second most-used surface.
3. **#5, #6, #7** — small, mechanical `aria-pressed`/`aria-live` additions, same pattern as existing code.
4. **#3, #4** — map-specific, lower reach than search/detail but still core flows.
5. **#8** — cosmetic i18n cleanup, no rush.

## Not re-flagged (already known/accepted per `docs/wcag-accessibility-plan.md`)
Leaflet markers not individually keyboard-focusable (deliberate equivalent-alternative design via
ResultsList); iOS WKWebView Dynamic Type; composited contrast on map tiles/photos (not statically
checkable); `border` token contrast (decorative, review-only); outstanding human screen-reader/keyboard/
400%-zoom passes (never claimed complete — still open work, not a new defect).
