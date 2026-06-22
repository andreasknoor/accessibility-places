// Per-tab session restore (sessionStorage) so that returning to the home page
// from a static page (FAQ/Impressum → "Zurück", which is a forward <Link href="/">
// that remounts HomeClient) restores the active search mode and re-runs the last
// search, instead of replaying the splash + firing a fresh "nearby" auto-search.
//
// Scope is sessionStorage (per tab, cleared on tab close) on purpose — we restore
// within a browsing session, not stale results days later. All access is guarded
// (SSR has no sessionStorage; private mode / quota can throw).

const K_SESSION   = "ap_home_session"   // set once per tab once HomeClient has mounted
const K_RETURNING = "ap_returning_now"  // ephemeral: "1" when THIS mount is a return
const K_MODE      = "ap_active_mode"    // last active chatMode ("text" | "nearby")
const K_SEARCH    = "ap_last_search_run" // enough to replay handleSearch(...)
const K_SPLASH    = "ap_splash_shown"   // SplashOverlay: shown once per tab session

function ss(): Storage | null {
  try { return typeof window !== "undefined" ? window.sessionStorage : null } catch { return null }
}

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

/** Drops only the replayable last search (keeps the active mode). Used on a mode
 *  switch / results clear, so a later return doesn't replay a now-stale search. */
export function clearSearchRun(): void {
  try { ss()?.removeItem(K_SEARCH) } catch { /* ignore */ }
}

/** Clears the full restorable state (mode + last run). Used on explicit reset. */
export function clearSessionSearch(): void {
  try { const s = ss(); s?.removeItem(K_MODE); s?.removeItem(K_SEARCH) } catch { /* ignore */ }
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
