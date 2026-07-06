# Native Android test updates (3 changes requiring a rebuild)

Status: concept only, not yet implemented (2026-07-06)

Goal: three genuine, independently useful native-Android changes to exercise
the Google Play internal-testing update pipeline 2–3 times with real native
rebuilds — not just the usual remote-URL web deploys, which never touch the
native shell. Scope is Android for this round; see "iOS applicability" per
item — none of the three ports over "for free".

## 1. Android App Links (verified deep links)

Currently a shared place link (`?selectLat=…&selectLon=…&selectName=…&cat=…`,
see `lib/place-link.ts` / the PlaceDebugSheet share button) opens the system
browser on a device with the app installed, at best prompting "Open with
app?". Verified App Links skip that prompt entirely.

**Native changes:**
- `android/app/src/main/AndroidManifest.xml`: add an `<intent-filter
  android:autoVerify="true">` on the main activity for `https://
  accessible-places.org/*` (and the query-param deep-link shape specifically).
- `public/.well-known/assetlinks.json` (placeholder already exists from the
  retired TWA era — verify/replace with the current Capacitor signing key's
  SHA-256 fingerprint from Play Console → Setup → App integrity).
- No `capacitor.config.ts` change needed; `allowNavigation` already covers the
  host.

**Web-side dependency:** none — the existing query-param links already carry
everything `HomeClient`'s `selectLat`/`selectLon`/`selectName`/`cat` restore
path needs (see `PlaceDebugSheet.handleShareLink`).

**iOS applicability:** different mechanism (Universal Links —
`apple-app-site-association` + Associated Domains entitlement, not
`intent-filter`/`assetlinks.json`). Would need its own native iOS change and,
since iOS is already live on the App Store, its own App Store release/review —
not something this Android round produces as a side effect.

**Test risk:** low — purely additive; a verification failure just means links
keep opening in the browser as today (no regression path).

## 2. App Shortcuts (long-press launcher icon quick actions)

Long-pressing the app icon offers e.g. "🅿 Parking nearby", "🚻 Toilet
nearby", "🔍 Start search" — without opening the app first.

**Native changes:**
- `android/app/src/main/res/xml/shortcuts.xml` (new): static shortcut
  definitions (icon, short/long label, target intent extras).
- Reference it from `AndroidManifest.xml`'s main activity
  (`<meta-data android:name="android.app.shortcuts" …>`).
- Each shortcut's intent extra maps to an amenity type / search mode; the
  native side just needs to launch the activity with that extra.

**Web-side dependency:** CLAUDE.md documents `pendingFocusAction` as the
existing "native quick-action path… routes to `handleAmenitySearch`" — verify
during implementation that this ref/mechanism already reads a launch intent
extra, or add the small bridge (native → `window.Capacitor` custom event or a
launch-URL query param → `HomeClient` effect) if it doesn't yet.

**iOS applicability:** different API (`UIApplicationShortcutItems` / Home
Screen Quick Actions) — same concept, separate native iOS implementation and
release, not automatic.

**Test risk:** low.

## 3a. In-app review prompt (Play In-App Review API)

A native, in-app rating dialog (no Play Store redirect) triggered at a
positive moment — proposed: after a search that returns a place with
complete accessibility data (all three criteria known), or after the Nth
successful search in a session. Google's Play Core library rate-limits how
often the dialog can actually show; the app only requests it, Google decides.

**Native changes:**
- Add a Capacitor plugin that wraps both the Android Play Core In-App Review
  API and (for later iOS parity) `SKStoreReviewController` under one JS call
  — e.g. `capacitor-community`/similar in-app-review plugin. Evaluate current
  plugin options for Capacitor 8 compatibility at implementation time.
- No manifest changes expected beyond the plugin's own Gradle dependency.

**Web-side dependency:** a call site in `app/HomeClient.tsx` (or wherever the
search-success path lives) that fires the plugin request, gated by
`Capacitor.isNativePlatform()` (web has no equivalent — no-op there) and a
simple frequency guard (e.g. only once per app version, tracked via
`@capacitor/preferences`, to avoid asking on every qualifying search).

**iOS applicability:** the only one of the three where the JS call is
identical on both platforms — a future iOS build of the same plugin needs no
separate design, just the native iOS half of the same plugin dependency.

**Test risk:** very low — purely additive, invisible on failure (the OS
itself suppresses over-asking; a broken trigger just means the dialog never
appears, no user-visible error path).

## Suggested build order

1. App Shortcuts (2) — smallest, cleanly exercises manifest-only native
   changes.
2. App Links (1) — moderate, builds on the existing `assetlinks.json`
   placeholder from the TWA era.
3. In-app review (3a) — new plugin dependency, still low risk.

## Explicitly out of scope for this round

- Push notifications (Firebase/FCM) — evaluated and deferred: needs a Firebase
  project, `google-services.json`, a server-side send mechanism, and runtime
  permission handling (Android 13+). Real product value (e.g. notifying about
  a reported data error nearby, or reaching top-users for the planned
  questionnaire — see `project_top_users_stats_plan` memory) but too much
  scope for a quick pipeline-exercise round.
- Home-screen widget — evaluated and deferred: native `AppWidgetProvider` +
  RemoteViews layout is a bigger standalone native UI project (and would need
  a completely separate WidgetKit/Swift implementation for iOS parity), better
  suited to its own dedicated effort than a third quick test round.
