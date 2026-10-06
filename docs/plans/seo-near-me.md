# Plan: Capture "barrierefreies <Kategorie> in der Nähe" search traffic

Status: **planned, not implemented** (2026-10-06). Decisions D1–D3 made
2026-10-06 (see "Decisions").

## Goal

Web statistics show users search Google with near-me phrasing —
"barrierefreies Café in der Nähe", "rollstuhlgerechtes Restaurant in der Nähe",
EN "wheelchair accessible cafe near me". Win more of that traffic.

## Current state (verified in code)

- **SEO pages are city × category only**: `/[city]/[category]` and
  `/en/[city]/[category]`, 32 cities × 10 categories (`lib/cities.ts`).
  There is no page per category without a city.
- **Keyword mismatch**: title, H1 and meta description say
  "**Rollstuhlgerechte** Cafés in Berlin" (`app/[city]/[category]/page.tsx:34`,
  `components/seo/SeoPageContent.tsx:414`). The searched term
  "**barrierefrei**" only appears in body text and the FAQ heading. Singular
  forms ("barrierefreies Café") and the spelling "Cafe" never appear in
  title/H1.
- **Coverage is far lower than the route count suggests.**
  `lib/generated/seo-validity.json` marks only 93 of 320 DE combos as valid
  (and only those are in the sitemap). Per category:

  | Category | Valid cities |
  |---|---|
  | cafe | **3/32** |
  | pub | 1/32 |
  | biergarten | 3/32 |
  | bar | 5/32 |
  | cinema | 9/32 |
  | attraction | 10/32 |
  | theater | 11/32 |
  | museum | 13/32 |
  | restaurant | 17/32 |
  | hotel | 21/32 |

  Cause: `FILTERS_STRICT` in `lib/seo-search.ts` requires entrance **and**
  toilet = yes/limited with `acceptUnknown: false`; most cafés/bars have no
  toilet tag in OSM. So for the exact example query ("barrierefreies Café")
  the site has almost no landing pages.
- `revalidate = 2592000` (30 days) on the DE route; docs say 5 days (stale).
- No Google Search Console verification found in the code (may be done via
  DNS — to be checked).

## How Google treats "in der Nähe" (rationale)

- "in der Nähe" / "near me" is read as **implicit local intent**: Google drops
  the literal phrase and substitutes the searcher's location. A Berlin user
  searching "barrierefreies Café in der Nähe" is effectively served results
  for "barrierefreies Café Berlin".
- Above the organic results sits the **Local Pack** (Google Maps business
  profiles). That slot is reserved for businesses; Accessible Places cannot
  enter it. The realistic targets are the organic results below it.
- Consequences:
  1. The existing city × category pages **are** the right vehicle for
     near-me queries in covered cities — if they use the searched wording and
     if they exist (coverage).
  2. A category page without a city ("Barrierefreie Cafés in der Nähe
     finden") can rank for the non-localised part of the query and for users
     in places with no city page, and should lead the user directly into a
     GPS nearby search.
  3. Creating city × "in der Nähe" pages or literal "…-in-der-naehe" URL
     variants per city would be **doorway pages** (Google spam policy) and
     must not be done.

## Phases

### Phase 0 — Baseline and measurement (no change)

1. Verify / set up Google Search Console for `accessible-places.org`
   (DNS TXT or `metadata.verification` in `app/layout.tsx`). Submit the
   sitemap.
2. Export a 3-month baseline: queries, impressions, CTR, average position per
   SEO page; specifically queries containing "in der nähe", "near me",
   "barrierefrei", "rollstuhlgerecht", singular vs plural.
3. The baseline is used to evaluate Phase 1 and 2 later (the wording itself
   is already decided, D1).

**Risk:** none. Without this baseline no later change can be evaluated, since
SEO effects are slow and noisy (weeks).

### Phase 1 — Wording of existing city pages (small, high leverage)

Change in `generateMetadata` (DE + EN route) and the H1 in
`SeoPageContent.tsx`:

- Title (≤ ~60 chars): lead with the searched term, keep the synonym, e.g.
  `Barrierefreie Cafés in Berlin – rollstuhlgerecht mit WC`.
- H1: `Barrierefreie Cafés in Berlin`; intro sentence carrying singular
  and synonyms naturally ("Du suchst ein barrierefreies Café in der Nähe?
  Hier findest du rollstuhlgerechte Cafés in Berlin …").
- Meta description: include "in der Nähe" once, naturally, plus the concrete
  value (entrance, WC, parking info, count of places).
- FAQ (already rendered as `FAQPage` JSON-LD): add one item answering
  "Wie finde ich ein barrierefreies Café in der Nähe?" pointing to the nearby
  search.
- EN: "Wheelchair-accessible cafés in Berlin" → keep, add "accessible" /
  "near me" phrasing in intro and FAQ.
- Category wording per slug moves into `lib/cities.ts` (one table: plural,
  singular with article/gender, e.g. "barrierefreies Café",
  "barrierefreie Kneipe", "barrierefreier Biergarten"), because German
  adjective endings depend on gender — no string concatenation guesswork.

| Risk | Mitigation |
|------|-----------|
| Rankings temporarily fluctuate after title changes | Change wording only, keep URLs/canonicals unchanged; roll out to all pages at once and compare 4–6 weeks against the Phase 0 baseline. |
| Keyword stuffing (repeating "in der Nähe" everywhere) | At most once in description, once in intro, once in FAQ; written for humans. |
| Grammar errors from templating (gender/case) | Explicit per-category table incl. singular form; unit test rendering all 10 × 2 locales and snapshotting title/H1/description. |
| Title too long → truncated in SERPs | Unit test: title ≤ 60 chars for every city/category (longest city name included). |
| `SeoPageContent.test.tsx` breaks on new strings | Update tests in the same commit. |

### Phase 2 — Category hub pages "… in der Nähe" (new asset)

One page per SEO category and locale, without a city: 10 × 2 = 20 pages.

- **Content:**
  - H1 "Barrierefreie Cafés in der Nähe finden" / "Wheelchair-accessible
    cafés near you".
  - Primary CTA "In meiner Nähe suchen" → deep link into the app that starts a
    GPS nearby search with this category chip (new deep-link shape, see
    below).
  - Short, genuinely useful text: what "barrierefrei" means here (entrance,
    WC, parking), data sources, how reliability works.
  - **Hub links to every valid city page of the category** (internal linking:
    strengthens the city pages too) plus an alphabetical list of the cities.
  - FAQ with `FAQPage` JSON-LD; `BreadcrumbList`.
- **Rendering:** fully static (no data fetch — content does not depend on
  live adapter results). No Fluid CPU cost, consistent with
  `docs/plans/fluid-cpu-reduction.md`.
- **URLs (decided, D2):** keyword slugs, e.g. `/barrierefreie-cafes`,
  `/barrierefreie-restaurants`, …; EN counterparts e.g.
  `/en/wheelchair-accessible-cafes`. Implementation: a new
  `app/[city]/page.tsx` (and `app/en/[city]/page.tsx`) that resolves the
  single segment against a hub-slug table and 404s otherwise (city slugs and
  hub slugs are disjoint; static routes like `/faq` take precedence anyway).
  The per-category slug table (DE + EN) lives in `lib/cities.ts` next to the
  other SEO tables.
- **Deep link for the CTA:** e.g. `/?nearby=1&cat=cafe`. `HomeClient` has no
  such parameter today; it must start the same flow as the search-row nearby
  button (`ChatPanel.handleLocate`) with the category preselected, and follow
  the Quickstart/Expert deep-link rules (`docs/plans/quickstart-mode-default.md`):
  categories in `SIMPLE_CATEGORIES` stay in Quickstart, others force Expert for
  that mount only.
- **Discoverability:** sitemap entries (priority above city pages), links
  from the home page footer, FAQ and each city page ("Alle barrierefreien
  Cafés in der Nähe").

| Risk | Mitigation |
|------|-----------|
| Thin content / doorway classification | Only 20 pages, each with unique explanatory text, real hub function (links to city pages) and a working tool; no per-city near-me variants. |
| Route collision (`app/[city]/page.tsx` vs future city overview pages) | Hub-slug table and `CITY_MAP` asserted disjoint in a unit test; or use explicit folders. |
| New `nearby` deep link breaks the boot sequence (auto-locate, welcome screen, session restore, native deep-link timing — see #418 and v10.31–v10.37) | Reuse the existing nearby code path rather than a new one; treat `nearby=1` like other deep links in the session-restore gates; manual matrix (first visit, returning visit, Quickstart/Expert, iOS/Android, permission denied). |
| GPS permission denied / unavailable → dead end | Fallback: show the location input with the chip preselected, plus the city list on the hub page itself. |
| Conflict with the Fluid CPU plan's Phase 2 (static home + rewrite for deep-link params) | `nearby` must be added to the rewrite parameter list (and its coverage test) if that plan is implemented first, or vice versa. |
| Hub pages compete with city pages for the same query (cannibalisation) | Distinct intent: hub = "in der Nähe"/no city; city page = city name in title/H1. Canonicals stay self-referencing. |
| i18n invariant | All strings DE+EN; hub pages follow the existing inline-bilingual pattern of SEO pages. |
| a11y | Add hub page to `__tests__/a11y/`; CTA is a real button/link with accessible name. |

### Phase 3 — Coverage of city pages — **dropped (D3)**

Decision: the criteria are **not** relaxed. A city page exists only when
places with confirmed accessible entrance **and** toilet exist; where the data
is missing, there is no page. Café/bar/pub coverage therefore stays low and
the hub pages (Phase 2) carry those categories. Coverage grows only through
better source data (validity cron picks it up automatically) or more cities
(Phase 4).

The options considered, kept for reference:

- **A — Keep strict criteria** (honest, but cafés stay at 3/32).
- **B — Category-specific criteria**: require toilet only where it is
  essential for the visit (as Quickstart does for cafe/restaurant/hotel) — or
  drop it for bar/pub/biergarten/cinema/theater/museum/attraction.
- **C — Two-tier list**: page exists when places have a confirmed accessible
  entrance; places with confirmed WC are ranked first and clearly labelled,
  the others show "WC: keine Angabe". Title/H1 wording must then not promise
  "mit WC".

| Risk | Mitigation |
|------|-----------|
| Pages promise more than the data supports (trust problem for an accessibility product) | Wording reflects the criteria actually applied; per-place WC status always visible; FAQ explains criteria. |
| More pages with few entries → thin content | Minimum entry count per page (e.g. ≥ 3) before it goes into the sitemap; validity script enforces it. |
| More ISR renders + Overpass load (validity cron, revalidation) | 30-day revalidate keeps CPU low; validity cron already exists; monitor Fluid CPU after rollout. |
| Diverging criteria between app (Quickstart) and SEO pages confuse users | Align with `SIMPLE_TOILET_REQUIRED_CATEGORIES` or document the difference. |
| `check-seo-validity.ts` and `SeoPageContent` tests need changes | Update in the same commit; dry-run the validity script locally and diff the resulting JSON before committing. |

### Phase 4 — More cities (optional, later)

Near-me searches come from everywhere; 32 cities leave mid-sized towns
uncovered (those users only get the hub page). Extend `CITIES` stepwise
(e.g. all DACH cities > 100k inhabitants), driven by Search Console
impressions from Phase 0/1.

| Risk | Mitigation |
|------|-----------|
| Many near-empty pages | Strict criteria unchanged (D3); only valid combos enter the sitemap. Optionally a minimum entry count (e.g. ≥ 3) in the validity script. |
| Fluid CPU / Overpass load | Lazy ISR, 30-day revalidate, add cities in batches, watch Usage. |
| Validity cron duration grows | Measure runtime; split or throttle if needed. |

### Phase 5 — Structured data refinement (optional, low impact)

- Make `ItemList` entries typed places (`CafeOrCoffeeShop`, `Restaurant`,
  `Hotel`, … with `geo` and `address`) and add accessibility via
  `amenityFeature` (`LocationFeatureSpecification`, e.g. "Rollstuhlgerechter
  Eingang"). No guaranteed rich result, but clearer semantics.
- Validate with Google's Rich Results Test; JSON-LD unit test for schema
  shape.

## Verification approach (all phases)

- Unit tests: title/H1/description per city × category × locale (length,
  grammar table, no "undefined"), hub-slug/city-slug disjointness, sitemap
  contains hubs, JSON-LD validity.
- `npm test`, `npx tsc --noEmit`, `npm run test:a11y`, `npm run lint`.
- Preview deployment: Rich Results Test on one city page and one hub page;
  Lighthouse SEO audit; manual deep-link matrix for the hub CTA (browser,
  iOS, Android).
- After production: Search Console URL inspection + "request indexing" for
  hubs; compare queries/impressions/CTR with the Phase 0 baseline after 4–6
  weeks. Changes are attributed per phase (one phase per deploy window).

## Decisions

- **D1 (decided):** "barrierefrei" is the primary term in title and H1;
  "rollstuhlgerecht" is secondary (subtitle/intro/description).
- **D2 (decided):** hub URLs are keyword slugs like `/barrierefreie-cafes`.
- **D3 (decided):** SEO criteria are not relaxed — no data, no page.
  Phase 3 dropped.
- **D4 (open):** Phase 4 scope — which and how many additional cities.

## Recommended order

Phase 0 → Phase 1 → Phase 2 → Phase 4/5 as data justifies.

## Docs to update when implemented

- `docs/architecture/seo-pages.md` and the SEO section of `CLAUDE.md`:
  hub pages, wording table, `nearby` deep link; fix the
  stale revalidate value (30 days, not 5).
- `CHANGELOG.md`: hub pages are a new user-facing feature.
