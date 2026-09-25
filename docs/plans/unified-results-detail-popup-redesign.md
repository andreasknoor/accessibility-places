# Unified results list, detail view and map popups (Quickstart + Expert)

Status: **implemented** (2026-09-25, v12.31–v12.35, branch `feat/unified-place-ui`)

## Goal

Quickstart and Expert Mode currently render the same place in three
unrelated visual languages (result card, detail view, map popup) — "like two
different apps". This redesign gives all three surfaces, in both modes, one
shared vocabulary of symbols, status icons, verdict wording, card styling and
buttons, while keeping functionality unchanged except where explicitly listed
below.

Mobile first. Light theme only (the app has no dark theme).

## Decisions (agreed with the product owner, 2026-09-25)

Prototypes (temporary, not in the repo) compared "today" against several
variants per surface. Chosen:

| Surface | Chosen variant |
|---|---|
| Result list | **V1+** — V1 structure and density (name, meta line, verdict, criteria, actions), V2 styling (soft-shadow 16 px cards on a tinted background, criterion glyphs with status badge, V2 buttons) |
| Detail view | **V2** — one shared layout for both modes: hero (photo or tinted category tile), title block, verdict card, action bar, criteria card; Expert appends grouped cards (contact & hours, offer, sources & links, technical details) |
| Map popups | **Optimised** — single state (no more/less toggle), same symbols/wording/buttons as list and detail |

Detail decisions:

- **Toilet symbol:** the man | woman pictogram — exactly `RESTROOM_GLYPH` from
  `lib/amenities/badge-scene.ts` (already the WC map-marker artwork since
  v12.26). Replaces the text glyph "WC", which only works in German.
- **Criterion label (B2):** glyph + criterion name ("Toilette" / "Toilet") with
  the value as a coloured word below ("Ja", "Eingeschränkt", "In der Nähe",
  "Keine Angabe"). Removes the "WC = WC" duplication and makes the result
  readable without relying on the 14 px status badge (WCAG 1.4.1). In the map
  popup, where space is tight, glyph + name only (B1).
- **Clickability (C2):** a labelled "Details" button in the card's action
  row. The whole card stays tappable (stretched-link pattern).
- **Default (primary, blue) CTAs.** "Route" (start navigation) leaves the app
  and is therefore never the default, with two deliberate exceptions:

  | Surface | Primary | Other actions |
  |---|---|---|
  | Result card | **Zur Karte** | Details · Route ↗ (all three labelled, equal width) |
  | Detail view | none — all actions equal | Route ↗ · Anrufen · Website · Teilen |
  | Popup: place | **Details** | Route ↗ · show-in-list icon |
  | Popup: parking | **Route ↗** (exception) | show-in-list icon, report link (weak tier) |
  | Popup: WC | **Route ↗** (exception) | Wheelmap · show-in-list icon |
  | Amenity result card (`AmenityCard`) | **Route ↗** stays default | unchanged |

- **External-app indicator:** every "Route" / "Navigation starten" trigger
  gets a small ↗ (lucide `ArrowUpRight`) after the label, plus an accessible
  hint that it opens another app. Applies everywhere, including `AmenityCard`
  and the Android chooser trigger.

## Functional changes (explicitly approved, with rationale)

1. **Whole result card opens the detail view**, not just the inner framed
   box. Implemented as a stretched link (the name is the real button, its
   `::after` covers the card; the action row sits above it with `z-index`),
   so there are still no nested interactive elements.
2. **Expert result card moves content into the detail view:** "best source"
   row, dogs/vegetarian/vegan badges, the link icons (website, phone,
   Wheelmap, Google Maps, Ginto) and the in-card "Details" expand toggle. All
   of it already exists in the detail view.
3. **Expert result card shows the address only when no distance is known**
   (text/city search). Nearby searches show the distance instead.
4. **Per-criterion reliability sentence on the card** is replaced by an
   exception marker: only a "gering" tier is shown (●○○ gering). The full
   tier stays in the detail view.
5. **Judgement note under the verdict** is only shown for pass-with-caveat,
   unverified and fail ("Alle geprüften Kriterien uneingeschränkt" only
   repeated the verdict).
6. **Detail view (Expert, mobile):** "‹ Zurück" top-left replaces the "✕"
   plus the footer "Schließen" button. Escape and backdrop tap still close.
   Desktop keeps the 520 px side panel with "✕" (a side panel has no "back").
7. **Detail view:** per-criterion sub-details are collapsed by default
   ("4 Details ▾"); the 5-column reliability table becomes a list (no
   horizontal scrolling at large font sizes).
8. **Quickstart detail gains a hero photo and a "Teilen" action** (same
   photo chain and share logic Expert already uses — no new data source).
9. **Expert detail gains phone/website as action-bar tiles** (links stay in
   the contact card too).
10. **Map popups lose the "Mehr/Weniger" toggle** — everything visible at
    once. Today "Navigation" needs three taps (marker → Mehr → Navigation);
    the new popup is only ~40 px taller than today's collapsed one because the
    address and the duplicated quick summary are dropped.
11. **Popup: address removed**, tapping the header tile/name also opens the
    details.
12. **Popup verdict wording** follows the active mode's list/detail wording
    ("Barrierefrei nutzbar" / "Erfüllt deine 2 Kriterien" / "Nicht
    gesichert") instead of the map-only words "Passt / Passt mit Vorbehalt /
    Ohne Angabe".
13. **Weak-parking popup link** reads "Als Behindertenparkplatz melden"
    (existing `t.map.parkingReportButton`) instead of "Fehler melden".

Everything else — search, filters, judgement logic (`evaluatePlaceJudgment`),
reliability computation, data, deep links, analytics events — is unchanged.

## Phases

One branch (`feat/unified-place-ui`), one commit per phase (version bump per
commit, `npm test` + `npx tsc --noEmit` before each). Each phase is
shippable on its own; phase 0 has no visible effect.

### Phase 0 — Shared building blocks (no visible change)

- `components/place/CriterionGlyph.tsx` — renders the four criterion glyphs
  (door, restroom pictogram, "P", seat) at two sizes, with an optional status
  badge. The restroom glyph is rendered from `RESTROOM_GLYPH` (`GlyphSpec` →
  inline SVG helper next to the canvas renderer in `lib/amenities/`), so map
  marker and UI share one definition. Status badge reuses `CriterionIcon`'s
  shapes (✓ ! ✕ ?).
- `components/place/CriterionItem.tsx` — B2 layout (glyph + name + coloured
  value word), `aria-label` "Toilette: Ja". Variants: `compact` (list grid),
  `row` (detail list with reliability + sources + collapsible details),
  `sentence` (Quickstart: glyph + `criterionSentence`).
- `components/place/Verdict.tsx` — one component for the verdict in both
  modes: Quickstart wording (`t.simple.*Headline`) or Expert wording
  (`JudgmentLine` logic incl. the criteria popover), `line` / `card`
  presentation. `JudgmentLine` becomes a thin wrapper or is replaced.
- `components/place/ActionButton.tsx` — primary / secondary / tile styles.
- `NavigateButton` (`components/ui/navigate-button.tsx`): new `emphasis:
  "primary" | "secondary"` (default secondary), ↗ indicator on every variant,
  new `"tile"` variant for the detail action bar; Android chooser popover
  unchanged.
- Design tokens in `app/globals.css`: card shadow, 16 px radius, tinted list
  background, soft status backgrounds (green/amber/red). Run
  `npm run check:contrast` for every new text/background pair.
- i18n (DE + EN): external-app hint (e.g. "öffnet Karten-App" / "opens maps
  app"), "gering"-marker text, "N Details" disclosure, section titles for the
  new detail cards. Reuse existing strings wherever they exist
  (`t.results.showOnMap`, `t.map.popupChipDetails`, `t.criteria.*`, `t.a11y.*`).
- Tests: unit tests for the new components; append them to
  `__tests__/a11y/components.a11y.test.tsx`.

### Phase 1 — Result list (V1+)

- `components/simple/SimplePlaceCard.tsx` — V1+ layout: name, meta line
  (category · distance), `CriterionItem variant="sentence"` for entrance
  (+ toilet for `SIMPLE_TOILET_REQUIRED_CATEGORIES`), action row
  Zur Karte (primary) · Details · Route ↗. Stretched link.
- `components/results/PlaceCard.tsx` — V1+ layout: name, meta line
  (category · opening status · distance, address only without distance),
  `Verdict line`, `CriterionItem compact` grid (entrance, toilet, parking,
  seating), same action row. Remove source row, diet/dog badges, link icons,
  in-card expand (functional changes 2–5). `PlaceDebugSheet` is still opened
  from here.
- `ResultsList` / `SimpleLayout`: tinted list background; header unchanged.
- `A11yAttribute` / `CriterionBox`: still used by `AmenityCard`; keep, do not
  touch in this phase.
- Tests: rewrite `PlaceCard.test.tsx` and `SimplePlaceCard.test.tsx`
  assertions (removed elements, new buttons, stretched-link target),
  `SimpleLayout.test.tsx` where it queries card content.

### Phase 2 — Detail view (V2)

- New `components/place/PlaceDetailView.tsx` — the shared layout: hero
  (photo, else tinted category tile), title block, `Verdict card`, action bar
  (4 equal tiles, no primary), criteria card (`CriterionItem row`). Expert
  mode appends: report button, contact & hours card (address with copy,
  phone, website, e-mail, opening hours), offer card, sources & platforms
  card (OSM id with copy, Wheelmap, Ginto, AccèsLibre, RfA, Google Maps),
  collapsed technical details (raw data, lazy `/api/raw` fetch unchanged).
- Extract from `PlaceDebugSheet`: photo resolution (→ `usePlaceImage` hook),
  share (`shareOrCopy` + feedback), reverse-geocoded address fallback, report
  button mode logic. Reused by both modes.
- `components/simple/SimpleDetail.tsx` → wraps `PlaceDetailView mode="quickstart"`
  inside its existing full screen (keeps `ModeSwitcher` + settings in the
  top bar).
- `components/results/PlaceDebugSheet.tsx` → wraps `PlaceDetailView
  mode="expert"`; mobile: full screen with "‹ Zurück", no footer; desktop:
  520 px side panel with "✕". `useFocusTrap`, `role="dialog"`,
  `aria-labelledby` unchanged.
- Tests: `SimpleDetail.test.tsx`, `PlaceDebugSheet.test.tsx` (table
  assertions → list assertions, collapsed sub-details, close via back
  button/Escape), a11y suite.

### Phase 3 — Map popups

- `lib/map/popup-content.ts` — new templates for place / parking / WC per the
  decisions table; app palette instead of the beige tones; restroom
  pictogram and criterion glyphs as inline SVG; name clamped to two lines via
  CSS instead of the 24-character cut; verdict wording per mode (new
  `mode: "quickstart" | "expert"` option, passed down from `MapView`).
  **Every OSM-sourced string still goes through `esc()`.**
- `components/map/MapViewGL.tsx` — drop the toggle part of
  `wirePopupToggle` (keep its reposition-into-view logic), update
  `estimatedHeightPx`/`maxWidthPx`, wire the header tap to the existing
  `data-show-details` handler.
- `app/globals.css` — remove the quick/full accordion rules, keep the close
  button rules.
- Tests: `__tests__/lib/map/popup-content.test.ts` (new markup, escaping,
  primary CTA per popup type, mode wording).
- Cross-check against issue #43 (popup overflow at large font scaling): the
  new popup must not exceed today's expanded height; the planned max-height
  cap stays useful and can land independently.

### Phase 4 — Amenity cards and clean-up

- `components/results/AmenityCard.tsx` — ↗ on the Route button (stays
  primary); no other change.
- Remove code that became unused (old popup shell, `ConfidenceBadge` bits if
  orphaned, `A11yAttribute` only if `AmenityCard` no longer needs it).
- Docs: update `CLAUDE.md` sections "PlaceCard interaction", "PlaceDebugSheet
  detail rows", "Navigate here" (variants, emphasis, ↗) and the popup
  description; add a `CHANGELOG.md` row for the unified place UI.

## Verification

- `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run test:a11y`,
  `npm run check:contrast` per phase.
- Manual check on the dev server per phase, both modes, DE + EN, at phone
  width and with a large system font (200 %): three sample places (pass,
  pass with caveat, unverified), a parking spot (strong + weak), a WC
  (standalone + venue-hosted).
- Screen reader spot check (VoiceOver): card announces name + verdict,
  criteria read as "Toilette: Ja", Route announces that it opens another app.

## Out of scope

- Map markers / pin colours (colour concept E stays).
- Search, filters, sorting, list header.
- SEO landing pages (`components/seo/SeoPageContent.tsx` has its own markup).
- Dark theme.
