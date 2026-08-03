# Reliability tiers — replacing the confidence percentage (v13, feat/reliability-tiers)

Replaces the single `overallConfidence` percentage/traffic-light badge (0.30 →
"Unsicher", red; 0.85 → "Verlässlich", green) with two separately displayed,
orthogonal concepts, driven by user testing feedback that "red" was
universally read as "not accessible" regardless of what the red actually
represented (data quality, not the accessibility judgement).

## The two axes

1. **Judgement** — does this place satisfy the active filter criteria? Binary
   under the hood (`passesFilters` already gates list membership — a place
   that fails is never shown), but the *headline* line surfaces the
   **caveat**: passed outright, passed with a `"limited"` value, or passed
   only because `acceptUnknown` let an unknown value through. Never
   red/green — a caveat is amber/neutral text, never a second traffic light
   next to the first.
2. **Reliability** — a per-criterion (entrance/toilet/parking/seating) tier
   describing how well-corroborated the *known* value is, expressed as a
   plain-language **Nachsatz** under that criterion's own row ("von mehreren
   Quellen bestätigt"), never as a second colour or a percentage on the
   place as a whole.

Both are user-decided (2026-08-01): keep the score, but move it off the
Ampel entirely and stop presenting it as a single number for the whole place.

## The formula (lib/matching/merge.ts)

Per criterion, per candidate value (`yes`/`limited`/`no`), sources are
grouped into **families** (`SOURCE_FAMILY` in `lib/config.ts`) and only the
strongest source *within* a family counts — a family cannot vote twice.
Families are then summed **additively, uncapped**:

```
evidenceSum(value) = Σ family∈distinct-families-agreeing-on-value  max(weight of sources in that family)
```

Families: `rfa`, `ginto`, `acceslibre`, `osm`, `acloud`, `google` — each
source is its own family except within Ginto's two approval levels (still
one family: a single API, self-declared vs. audited is a confidence
refinement, not a second observation).

`accessibility_cloud` is **not** folded into the `osm` family. This was
re-examined explicitly (2026-08-01 follow-up): 83% of A.Cloud's DACH volume
was, pre-v11.10, a Wheelmap mirror of OSM (same node, 95% exact agreement —
not a second observation). That population is **already dropped** by the
v11.10 `infoPageUrl` host filter in `accessibility-cloud.ts` before it ever
reaches `merge.ts`. What survives to the merge step is the ~9-17% of A.Cloud
records that are genuinely independent local surveys (concentrated in rural
AT/CH) — for that surviving population, a dedicated `acloud` family is the
accurate model, not a blanket merge into `osm`. (A per-record `sourceId`-based
family would be more precise still but is redundant work: the adapter-level
filter already achieves the same separation for the population that matters.)

**Tiers** (`CONFIDENCE_THRESHOLDS` in `lib/config.ts`):

| Tier | Threshold | Examples |
|---|---|---|
| `sehr_hoch` | evidence ≥ 1.00 | RfA allein (1.00) · OSM+Google (1.10) · OSM+Ginto (1.65) |
| `gut` | evidence ≥ 0.70 | OSM allein (0.75) · AccèsLibre allein (0.90) · A.Cloud+Google (0.85) |
| `gering` | evidence > 0 and < 0.70 | Google allein (0.35) · A.Cloud allein (0.50) |
| `keine` | no known value for this criterion | — |

**Conflict** (a runner-up value whose evidence exceeds 50% of the winner's,
family-aware, same rule as before): caps the tier at `gut` — it can never
read `sehr_hoch`, but the stored numeric confidence is untouched, and a
conflict below the `gut` threshold still reads `gering`. This is the one
asymmetry decided explicitly: agreement is rewarded additively without a
ceiling, disagreement only pulls a tier down one notch at most, never
turns a good score negative.

The old toilet-specific 0.9 confidence cap (`toiletConfidence`) is removed —
it existed to stop a percentage display from claiming "100%" on thin detail,
which doesn't map onto a tier system built around source corroboration
rather than data completeness. A toilet can now reach `sehr_hoch` like any
other criterion.

## Judgement line copy (Turbo vs. Quickstart)

- **Turbo**: names the active filters and, on a pass, whether it was
  unconditional, "mit Einschränkung bei X", or "keine Angabe zu X" (only
  when `acceptUnknown` is on — otherwise unknown never passes the filter in
  the first place, so the line is close to constant when strict). Never
  claims "barrierefrei" outright — the filters are the user's own choice,
  not a universal fact.
- **Quickstart**: fixed preset, so the absolute wording "Barrierefrei
  nutzbar" is accurate and simpler than mirroring Turbo's filter-relative
  phrasing.
- **SEO landing pages**: no user filters exist at all (`FILTERS_STRICT` is
  hard-coded). Fixed wording "Eingang und WC barrierefrei" — no dynamic
  judgement line, since there's no "your criteria" to reference.

## The red "may not be accessible" warning

`placeMayNotBeAccessible` used to fire on entrance/toilet being `"no"` **or**
`"unknown"`. With a judgement line that now explicitly says "keine Angabe zu
X", firing the same red box for "unknown" is a second, competing statement
about the same fact. Narrowed to actual `"no"` only (2026-08-01 decision).

## Map (MapViewGL, popup-content.ts)

Pin colour now encodes the judgement against the active filters, not the
reliability tier: green = passes, amber = passes with a `"limited"` caveat,
grey = unknown/no active criteria to judge by. A failing place is never on
the map at all (already excluded upstream by `passesFilters`), so red is
retired from the pin/popup vocabulary entirely. Clusters get one fixed
neutral colour rather than inheriting their best child's colour — a single
green pin no longer paints twenty ungraded siblings green.

## Sorting stays on the old axis

Per explicit decision, list ordering keeps using `overallConfidence` /
`computeFilteredConfidence` exactly as before — it is purely an internal
sort key now, shown nowhere. Its inputs (`attr.confidence`) are the new
uncapped evidence sums, so multi-family agreement now sorts higher than it
used to (no more 1.0 ceiling erasing the difference between one and two
corroborating sources).

## Decisions log (2026-08-01)

1. Info-sheet keeps a number: section title shows the tier, the breakdown
   table under it shows the evidence sums (not a percentage average).
2. Conflict caps the tier at `gut`; the underlying sum is untouched.
3. SEO judgement line is fixed wording, no per-visitor filter to reference.
4. Toilet's 0.9 cap removed pre-tier so WCs can reach `sehr_hoch`.
5. Map pin: amber only for an actual `"limited"` value; grey for unknown.
6. Map cluster: fixed neutral colour, not "best child wins".
7. Quickstart headline: absolute "Barrierefrei nutzbar" wording.
8. Verified-on-site date folds into the per-criterion Nachsatz text rather
   than a separate badge.
9. Source families: accessibility_cloud gets its own family (see above) —
   not folded into `osm`, not additive with it beyond the family cap.
10. Red "may not be accessible" warning fires only on actual `"no"` — the
    per-criterion "!" toggle (PlaceCard.tsx) follows the same narrowed rule,
    or it would imply a merely `"unknown"` value is why the warning fired.
11. accessibility_cloud stays classified as a weak (< 0.70) source.

## Implementation note: parkingNearby parity

`evaluatePlaceJudgment` (`lib/reliability.ts`) mirrors `passesFilters`
criterion-by-criterion, including the `parkingNearby` sub-filter: when a
caller's `SearchFilters.parkingNearby` is explicitly `false`, a place whose
parking value exists only via nearby-parking enrichment must judge as
failing on that criterion, exactly like `passesFilters` already does. This
matters almost nowhere in practice — a place reaching the UI already passed
the real filter — except for a deep-linked place, which can bypass
`passesFilters` entirely (see the Quickstart deep-link section of
CLAUDE.md). All four call sites that build a `JudgmentFilters` literal from a
real `SearchFilters` (PlaceCard, PlaceDebugSheet, MapViewGL ×2) pass
`parkingNearby` through; the two fixed-preset literals (Quickstart's
`SIMPLE_MAP_FILTERS`/`quickstartFilters`, SEO's none) don't set the parking
criterion active at all, so it doesn't apply there.

## 2026-08-02 follow-up: the separate warning box is retired (Option 3)

The original design (this doc's decision 10, above) kept a standalone
"Achtung: evtl. nicht barrierefrei" box (`NotAccessibleWarningBox`,
`components/results/NotAccessibleWarning.tsx`) narrowed to fire only on an
actual `"no"`. On review this box was found to duplicate the judgement
line's own headline almost word-for-word, at all three surfaces that had
both (PlaceCard, PlaceDebugSheet, SimpleDetail) — the exact "two signals,
one fact" problem the whole redesign exists to fix, just relocated one
level down. It has been removed entirely, along with `placeMayNotBeAccessible`
(`lib/matching/merge.ts`) and the per-criterion "!" toggle — nothing calls
either anymore.

The one place that genuinely lacked an equivalent was the map popup, which
only had a bare judgement caption ("Passt" / "Passt mit Vorbehalt" / "Ohne
Angabe") with no reasoning. `buildVenuePopupHtml`'s `judgment` option changed
from a bare `JudgmentStatus` to the full `PlaceJudgment` (status +
limited/unknown/failed), so the popup can now name the affected criteria
too — e.g. "Passt mit Vorbehalt (WC)". A new `map.judgmentFail` i18n string
distinguishes a confirmed violation from the generic "no data" caption,
which `pass_limited`/`unverified`/`fail`/`none` used to share.

### The judgement headline now names the count, and links to the filter view

Two usability points raised during review: the headline's "deine Kriterien"
doesn't say *how many*, and in Quickstart it's outright wrong — nothing
there is user-chosen, so the possessive "deine" is misleading. Fixes:

- `results.judgmentPass`/`judgmentFail` changed from plain strings to
  `(n: number) => { pre, criteria, post }` — `n` is the active-criteria
  count ("deine 2 Kriterien" / "dein Kriterium" for exactly one).
  `JudgmentLine.tsx` renders `criteria` as its own span so it can optionally
  become a link.
- `JudgmentLine` gained an `onOpenFilters?: () => void` prop. When given,
  `criteria` renders as a real, focusable `<button>` (stopPropagation'd,
  `aria-label` from `results.judgmentOpenFilters`) that jumps to the filter
  view; when absent, it's plain text. Only `PlaceDebugSheet`'s instance ever
  receives it — the result card's own on-card `JudgmentLine` never does,
  because that headline sits inside the card's single "opens detail sheet"
  tap target (see PlaceCard.tsx's own header-box comment), and nesting a
  second, differently-destined interactive control in there would either
  require restructuring that box or create a confusing nested-button
  situation for keyboard/screen-reader users. The card shows the same count
  as inert text; tapping the card opens the sheet, where the link lives.
- Threaded end-to-end: `HomeClient`/`MobileLayout` → `ResultsList` →
  `PlaceCard` → `PlaceDebugSheet`, and separately `HomeClient`/`MobileLayout`
  → `MapView` (new `onOpenFilters` on `MapViewProps`) → `MapViewGL` → its own
  internal `PlaceDebugSheet`. Desktop opens the collapsible filter rail
  (`setFilterCollapsed(false)`); mobile switches tabs (`setActiveTab("filter")`).
  Deliberately a *separate* prop from `ResultsList`'s existing
  `onAdjustFilters` (the empty-state CTA) rather than reusing it — passing
  the same prop from `HomeClient` too would have silently changed desktop's
  documented empty-state behaviour (text hint → button) as a side effect.
- Quickstart (`SimpleDetail.tsx`) got its own neutral fallback strings
  (`simple.notAccessibleHeadline` / `simple.unverifiedHeadline`) for the
  rare deep-linked place that fails its fixed preset, instead of reusing
  `results.judgmentFail`/`judgmentUnverified` — those say "deine Kriterien",
  which doesn't apply to a preset nobody chose. In practice
  `unverifiedHeadline` is currently unreachable there: Quickstart's preset
  always has `acceptUnknown: false`, and `evaluatePlaceJudgment` only ever
  produces `"unverified"` when `acceptUnknown` is on — kept anyway as
  correct, harmless defensive code in case that preset ever changes.

## 2026-08-02: OSM_ENTRANCE_WEIGHT_FACTOR removed

`OSM_ENTRANCE_WEIGHT_FACTOR = 0.90` used to discount OSM's contribution to
the **entrance** criterion only (not toilet/parking), reasoning that OSM's
`wheelchair=*` tag is a whole-place proxy rather than an entrance-specific
tag. Reviewed on request: the semantic reasoning was sound, but the
magnitude had a side effect nobody intended — a lone OSM entrance value
(0.75 × 0.90 = 0.675) fell below the `gut` tier threshold (0.70) while an
otherwise-identical lone OSM toilet value (0.75) stayed at `gut`, making
OSM's entrance data read as structurally less reliable than its toilet data
with no visible explanation anywhere in the UI. Decision: remove the factor
entirely — OSM's `wheelchair=*` now carries the same 0.75 weight for
entrance as for every other OSM-sourced criterion. `buildAttribute()`
(`lib/matching/merge.ts`) lost its `isOsmOverall` parameter; all callers
(`osm.ts`, `acceslibre.ts`, `ginto.ts`) were updated to the shifted
positional signature (`weightMultiplier` now the 5th argument, not 6th).
