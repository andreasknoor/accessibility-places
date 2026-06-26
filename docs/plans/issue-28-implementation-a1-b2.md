# Issue #28 — Implementation concept (A1 + B2)

**Status:** implementation plan (2026-06-26). Builds on the concept in [`issue-28-unified-search.md`](issue-28-unified-search.md) and the prototype in [`../prototypes/issue-28-search-concepts.html`](../prototypes/issue-28-search-concepts.html).

Chosen design: **A1** (one field + inline ⌖ GPS button + dismissible location token) and **B2** (two chip rows: categories on top, a labelled amenity-action row below). Plus a naming/behaviour change discussed in §2: the amenity row label becomes **„Schnellsuche" / "Quick find"** and amenity chips honour a typed location.

---

## 1. Principle: remove the *visible* mode, keep the *internal* mode

`mode: "text" | "nearby"` stays as internal state — it still gates:
- the auto-locate-on-launch effect (`ChatPanel.tsx:284`),
- `onModeChange` → `HomeClient.chatMode`, which gates the distance display in `ResultsList` (distance shown only when `chatMode === "nearby"`),
- session-restore (`isReturningNow` / `loadActiveMode`) and SEO `initialMode`.

What disappears is only the **tab toggle JSX** (`:736–788`). The two intents are now expressed *inside* one always-visible field:

| User does | Internal effect |
|---|---|
| types text / picks a suggestion + submits | `mode="text"`, `onModeChange("text")`, geocode |
| taps the inline ⌖ button | `mode="nearby"`, `onModeChange("nearby")`, `handleLocate()` |
| taps ✕ on the location token | stop `watchPosition`, drop fix, `mode="text"` |

`switchMode()` is retained but is no longer called from tab clicks — its body is split between the ⌖ handler (`switchMode("nearby")` semantics: clear pick state, fetch fresh fix) and submit/clear paths.

---

## 2. The „Schnellsuche" change — evaluation & spec

### Your proposal
Rename the amenity row label from **„In der Nähe"** to **„Schnellsuche"**, because amenities should be findable *anywhere*, not just near me — e.g. type „Hamburg", tap „Parken" → parking in Hamburg.

### Evaluation
**The underlying intent is right and worth doing.** Anchoring 🅿/🚻 to GPS-only is an artificial limit that came from the old hidden focus mode; the amenity search already accepts arbitrary coordinates (`onAmenitySearch(type, coords)` → `/api/nearby-parking?lat=&lon=`), so "anywhere" is a small, natural extension. „In der Nähe" would actively *mislead* once a typed location works.

**On the word „Schnellsuche" specifically — good, with one caveat.** It accurately frames the chips as *one-tap instant searches* and drops the false "nearby-only" promise. The caveat: it describes *speed*, not *content/behaviour* — slightly generic next to the very concrete category row. It still works because the chips themselves are self-describing (🅿 Parken / 🚻 WC). Alternatives considered:

| Label (DE / EN) | Verdict |
|---|---|
| **Schnellsuche / Quick find** | ✅ your pick — accurate scope, friendly, location-neutral |
| Finden / Find | shorter, even more neutral; loses the "instant" nuance |
| Einrichtungen / Facilities | most precise about *content*, but formal and longer |
| In der Nähe / Nearby | ❌ now wrong once typed-location works |

**Recommendation: go with „Schnellsuche" / "Quick find".** It best matches the new behaviour and your stated mental model. (If you ever want to lean more on *content*, „Finden:" is the lighter fallback.)

### Is your example conform to the plan? → Not yet; this adds it.
Today `selectAmenity` never geocodes the field text, so „Hamburg" + „Parken" runs at GPS, not Hamburg. The rename therefore **requires** the behaviour change below to be truthful.

### New `selectAmenity` resolution order
```
selectAmenity(type):
  clear suggestions / amenity error
  typed = locationPart(location)                       // strip quotes + leading "in "
  isUserTyped = location && location !== programmaticLocRef.current && typed
  // 1. Explicit typed place wins — "Hamburg" + Parken → geocode Hamburg, search there
  if (isUserTyped):
      setAmenityLocating(type)
      geocode(typed)                                   // GET /api/geocode?q= (+ intl flag)
        .then(coords => { onAmenitySearch(type, coords); rememberCenter(coords) })
        .catch(() => setAmenityLocateError(...))
      return
  // 2. A nearby locate is mid-flight → park it (existing pendingAmenityTypeRef path)
  if (nearbyPhase === "locating"): pendingAmenityTypeRef.current = type; setAmenityLocating(type); return
  // 3. Live GPS fix
  if (nearbyPhase is object): onAmenitySearch(type, fix); return
  // 4. Resolved centre of a prior search
  known = searchCenter ?? activeSearchCoords
  if (known): onAmenitySearch(type, known); return
  // 5. No location anywhere → acquire GPS (existing)
  getCurrentPosition() ...
```

**Precedence rationale:** a *user-typed, not-yet-searched* location is the most explicit signal, so it outranks even a live GPS fix (you typed „Hamburg" *while* standing in Berlin → you want Hamburg). A picked area/venue (which already ran a search) is covered by step 4 via `searchCenter`, so it needs no geocode. `programmaticLocRef` is the existing discriminator between "user typed this" and "we set this".

**Reuse the centre:** after an amenity search resolves, store its centre so toggling 🅿↔🚻 at the same place doesn't re-geocode (feed it into `searchCenter`/`activeSearchCoords` as today's coordinate searches do).

**`/api/geocode` note:** the route is DACH-restricted via `countryCodesParam`; pass the `international` flag through (add `&intl=1`) so a typed „Paris" works when international mode is on, matching `unified-suggest`.

---

## 3. ChatPanel layout (A1 + B2)

### 3a. Field row (always visible — replaces the tab + conditional blocks)
```
<div className="flex gap-2 items-center">
  <div className="relative flex-1"> {/* existing input, pulse, venue-pin, clear-X, dropdown */} </div>
  <button aria-label={t.chat.useLocation}            // inline ⌖
          onClick={onLocateTap} aria-busy={locating}
          className={cn("iconbtn", !location.trim() && "primary")}>
     {locating ? <Loader2 spin/> : <LocateFixed/>}
  </button>
  <Button onClick={submit} disabled={isLoading || !location.trim()}> {send} </Button>
</div>
```
- `onLocateTap` = `switchMode("nearby")`-equivalent: `clearPickState()`, `onModeChange("nearby")`, `handleLocate()`.
- ⌖ is the primary (tinted) control while the field is empty; Send takes primacy once the user types (style swap on `location.trim()`), per A1.

### 3b. Location token (replaces the nearby district label / locate button / error)
Rendered from `nearbyPhase`, independent of any tab:
- `"locating"` → ⌖ spins; optional inline „Standort…" hint.
- object → `📍 {district}` pill + green live-dot + ✕ (clear → stop watch, `nearbyPhase="idle"`, `onModeChange("text")`).
- `"error"` → small inline `role="alert"` + retry (re-tap ⌖).

### 3c. Two chip rows (B2)
Row 1 — categories (`role="radiogroup"`, label „Kategorie"): `Alle` then `CHIPS`.
Row 2 — amenity actions (`role="radiogroup"`, label „Schnellsuche"): a muted lead-in `t.chat.amenityRowLabel` then the two amenity chips, accent-bordered, filled when active.

> **Invariant:** this is layout only. `CHIPS` / `SETTING_CHIPS` / `SEO_CATEGORY_TO_CHIP_IDX` order is untouched; amenity chips and „Alle" remain pseudo-chips outside `CHIPS`. Keep the existing `aria-checked` single-select semantics per row.

---

## 4. i18n (DE + EN)

Add:
- `useLocation` — ⌖ button aria-label ("Standort verwenden" / "Use my location")
- `locationActive(district)` — token label / aria ("Suche um {district}" / "Searching around {district}")
- `clearLocation` — ✕ aria ("Standort entfernen" / "Clear location")
- `amenityRowLabel` — **"Schnellsuche" / "Quick find"**
- `categoryRowLabel` — "Kategorie" / "Category" (reuse `chipsGroupLabel` if preferred)
- settings: `autoLocateOnStart` label + hint

Mark unused after one release: `modeText`, `modeNearby`, `modeTextSub`, `modeNearbySub` (drop in a follow-up, keep first to avoid type churn mid-PR).

---

## 5. Settings & Welcome

- **Settings:** reframe `defaultSearchMode` UI from "Standard-Suchmodus" to a toggle **„Beim Start meinen Standort verwenden"** (on = `"nearby"`, off = `"text"`). No schema change (`"nearby"|"text"|null` already encodes it); `HomeClient`/`loadSettings` logic unchanged. Update `SettingsSheet` copy only.
- **Welcome:** collapse the two-card mode explainer to one primary CTA „📍 In meiner Nähe suchen" + secondary „oder Ort eingeben" (focuses the field). Decision on keeping it at all is an acceptance criterion — defer to a short A/B or just ship the simplified version.

---

## 6. Invariants & guards to preserve (regression checklist)

- SEO deep-link `initialMode="text"` → start neutral, **no** auto-locate (existing override branch).
- `isReturningNow()` nearby restore → rebuild the token from `loadNearbyLocation()`, do **not** re-locate.
- iOS standalone cold-start (#418) → keep reading first-visit/mode from `localStorage` ground-truth in the mount effect, not props.
- `watchPosition` follow-me lifecycle (start on fix, clear on ✕/unmount).
- Distance display still gated on `chatMode === "nearby"` via `onModeChange`.
- Chip order invariant + `SEO_CATEGORY_TO_CHIP_IDX`.

---

## 7. Phasing (one commit each, version-bumped)

1. **Layout — A1 + B2 shell.** Remove tabs; always-visible field + inline ⌖ + Send; location token; two chip rows. Wire `onModeChange` into ⌖/submit/clear. No amenity-geocode yet. Update `ChatPanel.test.tsx` (drop tab assertions, add ⌖/token).
2. **Schnellsuche behaviour.** Rename label; extend `selectAmenity` with the typed-location geocode path (§2); reuse resolved centre. Add geocode-path test + i18n keys.
3. **Settings + Welcome.** Auto-locate toggle copy; simplified welcome CTAs.
4. **Cleanup.** Remove now-dead `mode*` i18n keys and any unused branches; a11y suite check (`role="search"`, two `radiogroup`s).

---

## 8. Affected files

- `components/chat/ChatPanel.tsx` — main change (tabs out; field/⌖/token; two rows; `selectAmenity` geocode).
- `lib/i18n/{de,en}.ts`, `lib/i18n/types.ts` — new keys; mark old mode keys unused.
- `lib/settings.ts` / `components/settings/SettingsSheet.tsx` — auto-locate toggle copy.
- `app/HomeClient.tsx` — welcome CTAs; no structural change (still consumes `onModeChange`).
- `__tests__/components/ChatPanel.test.tsx`, `__tests__/a11y/*` — updated assertions.

---

## 9. Open questions

1. Welcome screen: keep simplified, or replace with a one-time coachmark pulsing the ⌖ button?
2. Auto-locate-on-launch default for first-run: keep today's "nearby unless set", or start neutral and let ⌖ pulse invite the tap (privacy-friendlier)?
3. When a typed-location amenity search runs, should the category row reset to „Alle" (it's now an amenity result set), or stay visually as-is? (Leaning: keep „Alle" highlighted, since the amenity chip is the active selection across both rows is *not* true — they're independent single-selects; confirm the cross-row active-state story in the build.)
