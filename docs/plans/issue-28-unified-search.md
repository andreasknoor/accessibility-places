# Issue #28 — Collapse the two search modes into one location-aware field

**Status:** concept (2026-06-26) · **Priority:** high · part of the 3-issue first-time-UX review (with [#29](https://github.com/andreasknoor/accessibility-places/issues/29), and the now-merged #30).

Companion visual prototype: **`docs/prototypes/issue-28-search-concepts.html`** (open in a browser).

---

## 1. Goal & today's state

Today the home search forces an upfront choice between two top-level tabs (`ChatPanel.tsx:736–788`):

- **„Überall" / "Anywhere"** (`mode === "text"`) — a unified field → Nominatim/Photon geocoding.
- **„In der Nähe" / "Nearby"** (`mode === "nearby"`) — GPS via `handleLocate()`.

This exposes an *internal* distinction (geocode vs. GPS) as a *user-facing* mode. It is the reason the Welcome screen has to exist (to explain the two modes), and it is the same anti-pattern #30 just removed for WC/parking.

**Target:** one search field. „Nearby" becomes a **one-tap action inside the field**, not a mode:

- empty query + tap-GPS → radius search at current position;
- typed text / picked suggestion → geocode and go there.

Everything downstream (`mode: "text" | "nearby"` as *internal* state, `nearbyPhase`, `onModeChange`, SEO `initialMode`, session-restore) keeps working — we only remove the **visible tab toggle** and re-route how the two intents are expressed.

### Design principles (mobile-first)

1. **One decision, not two.** No mode pre-selection. The field's content + a location affordance carry the intent.
2. **Location is a state, not a place to navigate to.** Once GPS is active it is shown as a persistent, dismissible token — not a transient phase.
3. **Reuse the freed vertical space deliberately.** Removing the ~56 px tab block lets the chip strip breathe and lets the amenity actions become legible (Main change 2).
4. **No regression to the AT-operable path.** The field stays a single labelled `role="search"`; the chip strip stays a `radiogroup`.

### What explicitly stays (per your direction)

- **Mobile footer tabs** (Ergebnisse / Karte / Filter) — unchanged. No good argument to touch them here; they are orthogonal to the search-mode question and #29 owns the list-vs-map default.
- The `mode` string internally, `onModeChange`, `nearbyPhase` coords, `watchPosition` follow-me, SEO deep-links, `ap_last_search` restore.
- The **chip order invariant** (`CHIPS` / `SETTING_CHIPS` / `SEO_CATEGORY_TO_CHIP_IDX`). Main change 2 only changes **visual grouping**, never array order — amenity chips and „Alle" are already *pseudo-chips* outside `CHIPS`, so regrouping them is layout-only.

---

## 2. Main change 1 — the unified location-aware field

Three concepts. All keep a single text input; they differ in how the GPS/"nearby" action and the active-location state are expressed.

### Concept A1 — Inline GPS button + location token *(recommended)*

- The field gains a **trailing crosshair button** (⌖) that lives next to Send. When the field is empty the crosshair is the primary, tinted affordance; as soon as the user types, Send takes primacy.
- Tapping ⌖ runs the nearby flow (`handleLocate`). While locating, the crosshair shows a spinner.
- Active location renders as a **removable pill below the field**: `📍 Mitte ✕` with the existing green "fix is live" dot. Tapping ✕ clears it back to the neutral state.
- A typed search simply ignores/ု supersedes the token (geocode wins); clearing the field re-reveals the token if a fix is still live.

**Why recommended:** smallest cognitive load, closest to Google/Apple Maps muscle memory, keeps the input a plain single-line field (no fragile in-field token editing), and the persistent location pill answers "where am I searching?" at a glance. Degrades gracefully when GPS is denied (pill never appears; field still works).

### Concept A2 — Location token *inside* the field (recipient-chip style)

- GPS tap inserts a pill **at the left edge of the input** (`📍 Dein Standort`), Gmail-"To:"-style; typing a city replaces it.
- Most compact (no second row at all).
- **Risk:** token-inside-`<input>` requires a faux-input wrapper (a real `<input>` can't hold a chip), which is fiddly on mobile keyboards, caret handling, and screen readers. Higher build risk, weaker a11y story.

### Concept A3 — Field + single dual-state affordance below

- The field sits on top; **one full-width control below** flips between two states:
  - no fix → `⌖ Standort verwenden` (outline button)
  - active → `📍 Mitte · ändern`  with the green dot (tap = re-locate, long-press/✕ = clear)
- One element, two states, zero tabs — very explicit and easy to hit.
- **Cost:** uses a full row of vertical height even when idle; reads slightly more "form-like" than the Maps-style inline pattern.

| | A1 inline + token | A2 in-field token | A3 dual-state row |
|---|---|---|---|
| Familiarity (Maps muscle memory) | ●●● | ●● | ●○ |
| Vertical footprint | small | smallest | medium |
| Build risk / a11y | low | **high** | low |
| "Where am I searching?" clarity | ●●● | ●● | ●●● |

**→ Recommendation: A1.**

---

## 3. Main change 2 — fix the chip strip

Your complaint: the current single row reads as an undifferentiated `[🚻 WC][🅿 Parken][Alle][☕ Cafés]…` — amenities, the "all" pseudo-chip and real categories are visually identical and the ordering is unintuitive. They are three *different kinds* of control jammed into one scroll.

The fix in every concept below: **visually separate the "find an amenity near me" actions from the "filter venues by category" chips.** (Layout only — no `CHIPS` reorder.)

### Concept B1 — Pinned amenity actions + scrolling categories (one row)

- The two amenity chips become **pinned, icon-led, accent-outlined** buttons fixed at the **left**, then a **vertical divider**, then `Alle` + categories scroll horizontally *behind* the divider.
- Pros: one row (compact), clear grouping, amenities always reachable without scrolling.
- Cons: pinned block eats ~120 px of the category scroll width on small phones.

### Concept B2 — Two dedicated rows *(recommended)*

- **Row 1 — categories:** `[Alle] [☕ Cafés] [🍽 Restaurants] …` horizontal scroll. „Alle" leads; this row is *only* venue categories, so it reads cleanly as "what kind of place".
- **Row 2 — amenity quick-actions:** a short muted lead-in label (`In der Nähe:` / `Nearby:`) followed by two visually distinct pills `🅿 Parken` · `🚻 WC` (accent border, filled when active).
- Pros: each row is one *kind* of thing → instantly legible; this is exactly the vertical space the removed tabs free up; amenity actions get a self-describing label so first-timers understand they search *around me*, not filter.
- Cons: +1 row of height (affordable post-tab-removal; still far less than the old tab block + single row).

### Concept B3 — Divider + restyled single row

- Keep one scroll row but: amenity chips become **icon-forward pills with a coloured ring**, then a clear **`|` divider**, then `Alle` + categories. No pinning — everything scrolls, but the divider + distinct styling kills the "all the same" feeling.
- Pros: minimal change, lowest height.
- Cons: on first paint the divider may be just off-screen; weakest grouping of the three.

| | B1 pinned+scroll | B2 two rows | B3 divider row |
|---|---|---|---|
| Group legibility | ●●● | ●●● | ●● |
| Vertical footprint | small | medium | smallest |
| "These search around me" clarity | ●● | ●●● (labelled) | ●○ |
| Category scroll width on small phones | reduced | **full** | full |

**→ Recommendation: B2.** Removing the tabs is precisely what makes a second, clearly-labelled amenity row affordable, and the explicit `In der Nähe:` lead-in is the single biggest comprehension win — it tells a first-timer that 🅿/🚻 are *proximity actions*, not venue filters. (If later telemetry shows the extra row hurts, B1 is the fallback that stays one row.)

---

## 4. Behavioural spec (recommended A1 + B2)

**Launch / first paint**
- One field (placeholder = `unifiedPlaceholder`), the ⌖ GPS button, category row, amenity row. No tabs, no mode.
- `defaultSearchMode` setting is re-interpreted as **"auto-locate on launch?"**: `"nearby"` (or null default) → fire `handleLocate()` once on mount exactly as today (same first-visit / `isReturningNow` / iOS-race guards in the existing effect); `"text"` → start neutral. The setting UI copy changes from "Standard-Suchmodus" to "Beim Start meinen Standort verwenden" (toggle).

**Expressing the two intents**
- Type text or pick an area/venue suggestion → geocode path (`onSearch` / `onPlaceSearch`), internal `mode="text"`.
- Tap ⌖ → `handleLocate()`, internal `mode="nearby"`, location token appears.
- These are no longer mutually-exclusive *modes*: an active location token can coexist with the field; submitting typed text just supersedes it for that search.

**Active-location token**
- Replaces today's `district` label. Shows `📍 {district}` + green live-dot; ✕ clears the fix (stop `watchPosition`, drop coords, internal `mode="text"`).
- Distance sort + the amenity row stay enabled whenever a fix (or any resolved `searchCenter`) exists — already true in code; just gated on location-present instead of mode.

**Welcome screen**
- The two-card explanation is no longer needed. Reduce to a single primary CTA (`📍 In meiner Nähe suchen`) + a secondary "oder Ort eingeben" that just focuses the field. Re-evaluate whether to keep it at all (acceptance criterion in #28).

**Invariants to preserve**
- SEO deep-link `initialMode="text"` → start neutral, no auto-locate (already the override path).
- `isReturningNow()` restore of a prior nearby search → restore the token from `loadNearbyLocation()`, do **not** re-locate (existing logic).
- iOS standalone cold-start race (#418) → keep reading first-visit/mode from `localStorage` ground-truth in the mount effect, not from props.
- Chip order invariant + `SEO_CATEGORY_TO_CHIP_IDX` untouched.

---

## 5. Acceptance criteria (from #28) → how this meets them

- ✅ No top-level text/nearby toggle — replaced by one field + inline ⌖.
- ✅ City **or** nearby from one field with no mode decision — type vs. tap-⌖.
- ✅ Distance sort + amenity actions reachable with an active GPS location — gated on location-present, amenity row always visible.
- ✅ No regression in SEO `initialMode`, session-restore, iOS cold-start — internal `mode` + existing guards retained.

---

## 6. Affected files (implementation sketch)

- **`components/chat/ChatPanel.tsx`** — remove the tab JSX (`:736–788`); add the inline ⌖ button + location-token UI; keep `switchMode` logic but drive it from the ⌖/✕ + typing instead of tab clicks; restructure the chip block (`:984–1049`) into two rows. No change to `selectChip` / `selectAmenity` / `handleLocate` core logic.
- **`lib/i18n/{de,en}.ts` + `types.ts`** — new keys: `useLocationAction`, `locationActiveLabel`, `clearLocation`, `amenityRowLabel` ("In der Nähe:" / "Nearby:"); the `modeText`/`modeNearby`/`*Sub` keys become unused (keep one release, then drop). Settings copy key for the auto-locate toggle.
- **`lib/settings.ts`** — reframe `defaultSearchMode` semantics (no schema change required; `"nearby"|"text"|null` already covers "auto-locate yes/no/default"). Update `SettingsSheet` copy.
- **`app/HomeClient.tsx`** — no structural change; `onModeChange` still consumed. Welcome-screen copy/CTAs simplified.
- **Tests** — `__tests__/components/ChatPanel.test.tsx` (drop tab-click assertions, add ⌖/token assertions), a11y suite (field still `role="search"`, chips still `radiogroup`).

---

## 7. Open questions

1. Keep the Welcome screen at all, or replace with a one-time inline coachmark on the ⌖ button?
2. Auto-locate-on-launch default: keep today's "nearby unless set" behaviour, or flip first-run to *neutral* and let the ⌖ pulse invite the tap? (Privacy-friendlier; testable via the existing first-visit pulse.)
3. Desktop: mirror A1 exactly, or keep a slightly larger affordance given the horizontal room? (Prototype shows the mobile target; desktop can reuse A1 at a larger size.)
