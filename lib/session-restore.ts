// Single owner of BOTH "last search" restore layers — they are related but
// deliberately different, and keeping them in one module is what stops them
// from drifting apart (they used to live in two places and diverged):
//
//  1. INPUT restore (localStorage, `ap_last_search`): the raw text + chip the
//     user last typed/picked. Cross-session, device-wide. Only pre-fills the
//     search UI on the next visit — never executes anything.
//  2. RUN replay (sessionStorage, `ap_last_search_run`): the built query +
//     coords of the last SUCCESSFUL search. Per tab, survives reloads. On a
//     return mount (static page → back, or a reload) HomeClient re-executes it.
//     Persisted only after a search succeeded — a failing query must never
//     enter the replay loop (reload → replay → same error).
//
// The rest is per-tab session restore (sessionStorage) so that returning to the
// home page from a static page (FAQ/Impressum → "Zurück", which is a forward
// <Link href="/"> that remounts HomeClient) restores the active search mode,
// instead of replaying the splash + firing a fresh "nearby" auto-search.
//
// All access is guarded (SSR has no storage; private mode / quota can throw).

const K_SESSION   = "ap_home_session"   // set once per tab once HomeClient has mounted
const K_RETURNING = "ap_returning_now"  // ephemeral: "1" when THIS mount is a return
const K_MODE      = "ap_active_mode"    // last active chatMode ("text" | "nearby")
const K_SEARCH    = "ap_last_search_run" // enough to replay handleSearch(...)
const K_NEARBY    = "ap_nearby_location" // located district + coords (nearby mode UI)
const K_SPLASH    = "ap_splash_shown"   // SplashOverlay: shown once per tab session

const K_INPUT = "ap_last_search" // localStorage: raw input text + chip (layer 1)

function ss(): Storage | null {
  try { return typeof window !== "undefined" ? window.sessionStorage : null } catch { return null }
}

function ls(): Storage | null {
  try { return typeof window !== "undefined" ? window.localStorage : null } catch { return null }
}

// ─── Layer 1: input restore (localStorage) ───────────────────────────────────

// `cat` is the stable Category key of the selected chip (null = "Alle").
// Legacy installs stored a positional `idx` instead — ChatPanel migrates it on
// load via legacyChipIdxToCat, so loadSearchInput returns the raw parsed shape.
export type SearchInput = { cat: string | null; loc: string }

export function saveSearchInput(input: SearchInput): void {
  try { ls()?.setItem(K_INPUT, JSON.stringify(input)) } catch { /* ignore (quota) */ }
}

export function loadSearchInput(): (Partial<SearchInput> & { idx?: number | null }) | null {
  try {
    const raw = ls()?.getItem(K_INPUT)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : null
  } catch { return null }
}

export function clearSearchInput(): void {
  try { ls()?.removeItem(K_INPUT) } catch { /* ignore */ }
}

// ─── Layer 2 + mode/nearby restore (sessionStorage) ──────────────────────────

export type SearchRun = {
  chatMode:    "text" | "nearby"
  query:       string
  coords:      { lat: number; lon: number } | null
  nameHint:    string | null
  placeSearch: boolean
}

/**
 * Called once from HomeClient's mount layout-effect. Returns whether the home page
 * was already mounted earlier in this tab session (i.e. this is a return). Also
 * records that fact in K_RETURNING so ChatPanel's passive auto-locate effect — which
 * runs after this layout-effect — can read it and skip auto-locating on a return.
 */
export function markMountAndIsReturning(): boolean {
  const s = ss()
  if (!s) return false
  let returning = false
  try {
    returning = s.getItem(K_SESSION) != null
    s.setItem(K_SESSION, "1")
    s.setItem(K_RETURNING, returning ? "1" : "0")
  } catch { /* ignore */ }
  return returning
}

/** Read by ChatPanel's auto-locate effect to suppress auto-locate on a return mount. */
export function isReturningNow(): boolean {
  const s = ss()
  try { return s?.getItem(K_RETURNING) === "1" } catch { return false }
}

/** Clears the one-shot return signal once HomeClient's mount has consumed it, so a
 *  later ChatPanel-only remount (reset / mode switch via resetKey, which does NOT
 *  remount HomeClient) isn't wrongly treated as a return. */
export function clearReturningFlag(): void {
  try { ss()?.removeItem(K_RETURNING) } catch { /* ignore */ }
}

export function saveActiveMode(mode: "text" | "nearby"): void {
  try { ss()?.setItem(K_MODE, mode) } catch { /* ignore */ }
}
export function loadActiveMode(): "text" | "nearby" | null {
  try {
    const v = ss()?.getItem(K_MODE)
    return v === "text" || v === "nearby" ? v : null
  } catch { return null }
}

export function saveSearchRun(run: SearchRun): void {
  try { ss()?.setItem(K_SEARCH, JSON.stringify(run)) } catch { /* ignore (quota) */ }
}
export function loadSearchRun(): SearchRun | null {
  try {
    const raw = ss()?.getItem(K_SEARCH)
    if (!raw) return null
    const r = JSON.parse(raw) as SearchRun
    if (r && (r.chatMode === "text" || r.chatMode === "nearby") && typeof r.query === "string") return r
    return null
  } catch { return null }
}

export type NearbyLocation = { district: string; lat: number; lon: number }

/** The located nearby state (district label + coords). Lets a return mount restore
 *  the "located" nearby UI (district label + focus chips, no "locate" button)
 *  instead of dropping back to the idle locate prompt. */
export function saveNearbyLocation(loc: NearbyLocation): void {
  try { ss()?.setItem(K_NEARBY, JSON.stringify(loc)) } catch { /* ignore */ }
}
export function loadNearbyLocation(): NearbyLocation | null {
  try {
    const raw = ss()?.getItem(K_NEARBY)
    if (!raw) return null
    const r = JSON.parse(raw) as NearbyLocation
    if (r && typeof r.lat === "number" && typeof r.lon === "number") {
      return { district: typeof r.district === "string" ? r.district : "", lat: r.lat, lon: r.lon }
    }
    return null
  } catch { return null }
}

/** Drops only the replayable last search (keeps the active mode + nearby location).
 *  Used on a mode switch / results clear, so a later return doesn't replay a stale
 *  search. */
export function clearSearchRun(): void {
  try { ss()?.removeItem(K_SEARCH) } catch { /* ignore */ }
}

/** Clears the full restorable state. Used on explicit reset. */
export function clearSessionSearch(): void {
  try { const s = ss(); s?.removeItem(K_MODE); s?.removeItem(K_SEARCH); s?.removeItem(K_NEARBY) } catch { /* ignore */ }
}

/** SplashOverlay: returns true if the splash was already shown this tab session,
 *  and marks it as shown. So the splash plays once per tab, not on in-app returns. */
export function splashAlreadyShownThisSession(): boolean {
  const s = ss()
  if (!s) return false
  try {
    const shown = s.getItem(K_SPLASH) != null
    s.setItem(K_SPLASH, "1")
    return shown
  } catch { return false }
}
