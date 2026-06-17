# Capacitor iOS App — Implementation & Release Runbook

Native iOS app around the existing web app using
[Capacitor](https://capacitorjs.com), the **same remote-URL approach** as the
Android build (`docs/capacitor-android-setup.md`). Read that first — the core
mechanics (remote WebView, plugin JS shipped from Vercel, web stays native-aware)
are identical. This doc covers only the iOS specifics and the App Store path.

## Status (2026-06-17)

The native shell is **code-complete and device-polished**; what remains is the
App Store distribution path (Phases 6–8). Done so far:

| Area | State |
|---|---|
| iOS platform shell | ✅ `ios/` (Xcode project, Swift Package Manager `CapApp-SPM`), added v8.6 |
| `capacitor.config.ts` iOS block | ✅ `contentInset: "never"`, `scheme`, white background |
| Location permission strings | ✅ `NSLocationWhenInUseUsageDescription` + `…AlwaysAndWhenInUse…` (Info.plist) |
| App icon | ✅ 1024 px on brand-blue (`AppIcon-512@2x.png`), v8.8/8.9 |
| Splash | ✅ `Splash.imageset` (2732²) |
| Privacy manifest | ✅ `PrivacyInfo.xcprivacy` present (Apple requirement since 2024) |
| Signing | ✅ Automatic, `DEVELOPMENT_TEAM = U246MNT992`, bundle `org.accessibleplaces.app` |
| Offline fallback | ✅ `capacitor-shell/index.html` (shared with Android) |
| Device polish | ✅ safe-area insets, single location prompt, WKWebView rubber-band, back button, splash hide (v8.7–v9.1) |
| Native plugins | ✅ Geolocation, Browser (SFSafariViewController), Share, Haptics, Status-Bar |

**Open:** App Store Connect record, screenshots + privacy nutrition labels,
version/build numbering, archive → TestFlight → review → release. No code work is
expected unless App Review requests changes.

### Concrete values

| | |
|---|---|
| `appId` / bundle identifier | **`org.accessibleplaces.app`** (same as Android/Play) |
| App name | **Accessible Places** |
| Apple Developer Team | **`U246MNT992`** |
| Production host | **accessible-places.org** |
| `MARKETING_VERSION` | **1.0** (App Store version string) |
| `CURRENT_PROJECT_VERSION` | **1** (build number — must increase per upload) |

---

## Prerequisites

- **macOS** with **Xcode** (current release), Command Line Tools installed.
- **Apple Developer Program** membership ($99/yr) — the team `U246MNT992` must be
  enrolled and active.
- **CocoaPods is not used** — this project uses Capacitor's **SPM** integration
  (`CapApp-SPM`). Dependencies resolve in Xcode; no `pod install`.
- Node 20+, repo checked out, `npm install` run (the `@capacitor/*` JS must be in
  the Vercel bundle — see the Android runbook's "crux" section).

## The crux (same as Android)

`server.url` loads the **remote** Vercel site in a `WKWebView`; the Capacitor
bridge is injected in-process. Day-to-day web changes deploy via Vercel and appear
in the app **without** an App Store release. Only native-shell changes (plugins,
Info.plist, icon, config) need a new build + review. The same `lib/native/*`
branches (`Capacitor.isNativePlatform()`) already handle iOS — no separate web
code path.

---

## Phase 1 — Sync & open the project

```bash
npx cap sync ios            # copies capacitor.config + plugin JS into ios/
npx cap open ios            # opens ios/App/App.xcworkspace in Xcode
```

> Run `npx cap sync ios` after **any** plugin add/update or `capacitor.config.ts`
> change. The remote web content does NOT need a sync (it's loaded live).

## Phase 2 — Signing & capabilities (verify in Xcode)

In Xcode → target **App** → *Signing & Capabilities*:
- **Automatically manage signing** ✓, Team = `U246MNT992`.
- Bundle identifier = `org.accessibleplaces.app`.
- Xcode provisions the App ID / profile automatically on first build. If it fails,
  register the App ID once in the Apple Developer portal.
- No special entitlements needed (location is plist-driven, foreground-only; no
  background modes, no push).

## Phase 3 — Version & build numbers

Apple separates the **marketing version** (user-visible, e.g. `1.0`) from the
**build number** (must strictly increase for every TestFlight/App Store upload).

In Xcode target → *General*, or via the project settings:
- `MARKETING_VERSION` — the public version (bump for real releases, e.g. `1.0` → `1.1`).
- `CURRENT_PROJECT_VERSION` — **increment on every upload** even within the same
  marketing version (`1` → `2` → …). Reusing a build number is rejected on upload.

> Unlike the web `APP_VERSION` (bumped every commit) these only change for an
> actual store build. Track the build number separately.

## Phase 4 — Privacy manifest & nutrition labels

Two **separate** Apple requirements — do not confuse them:
1. **`PrivacyInfo.xcprivacy`** (in the repo ✅) — declares "required reason" API
   usage and tracking. Verify it lists what the app actually does: location use,
   and `UserDefaults` (the WKWebView's `localStorage`/settings). No IDFA/tracking.
2. **App Privacy "nutrition labels"** in **App Store Connect** (still to fill in) —
   the data-collection questionnaire. Declare at minimum:
   - **Location** — used for app functionality ("find places near me"), not linked
     to identity, not used for tracking.
   - **Usage Data / Analytics** — the site uses Vercel Analytics/Speed Insights
     (no PII; declare as "not linked to you", "analytics" purpose).
   Keep this consistent with `app/datenschutz` and the manifest.

## Phase 5 — Archive & validate

In Xcode:
1. Select destination **Any iOS Device (arm64)** (not a simulator — archives need a
   device target).
2. **Product → Archive**. The Organizer opens on success.
3. **Validate App** in the Organizer first — catches signing/Info.plist/icon issues
   before upload.

CLI alternative (optional, for CI later):
```bash
xcodebuild -workspace ios/App/App.xcworkspace -scheme App \
  -configuration Release -archivePath build/App.xcarchive archive
```

## Phase 6 — TestFlight

1. In the Organizer → **Distribute App → App Store Connect → Upload**.
2. First upload requires the app record to exist in **App Store Connect**
   (create it under the bundle id `org.accessibleplaces.app`, see Phase 7).
3. After processing (a few minutes to ~1 h), the build appears under **TestFlight**.
4. Add **internal testers** (your team) — no review needed for internal testing.
5. External testing requires a lightweight **Beta App Review**.

Verify on a real iPhone (Phase 8 checklist) before promoting.

## Phase 7 — App Store Connect listing

Create/complete the app record at appstoreconnect.apple.com:
- **App record:** name "Accessible Places", bundle `org.accessibleplaces.app`,
  primary language, SKU.
- **Screenshots** — required per device class. At minimum 6.7" iPhone; provide
  6.5"/5.5" if targeting older devices. Capture real screens (search, results, map,
  a place detail sheet).
- **Privacy nutrition labels** (Phase 4) and a link to the privacy policy
  (`https://accessible-places.org/datenschutz`).
- **Description, keywords, support URL, marketing URL, category** (Navigation or
  Travel fits), **age rating** (questionnaire → likely 4+).
- **App Privacy → Data Types** must match the manifest and actual behaviour.

## Phase 8 — Verify on a device (acceptance)

- **Location prompt** appears natively (once, not repeated); "Nearby" uses native
  GPS. Default-search-mode = text must NOT trigger a location prompt on launch.
- **Safe areas:** no white gaps at the notch/Dynamic Island or home indicator;
  header and bottom nav respect insets; no double-inset.
- **No rubber-band** drag exposing header/footer; static-page back button sits
  below the status bar.
- **External links** (Wheelmap, OSM, Google Maps, website) open in
  SFSafariViewController, not in-app.
- **Settings persist** across app restarts (WKWebView `localStorage`): default
  search mode, default category, default view all apply on cold start.
- **Offline:** kill the network → `capacitor-shell` fallback; restore → live site.
- A trivial Vercel web deploy appears in the app **without** an App Store update.

## Phase 9 — Submit for review & release

1. In App Store Connect, attach the TestFlight build to a **version for review**.
2. **Submit for Review.**
3. On approval, release manually or automatically.

---

## Appendix A — App Store Review Guideline 4.2 ("minimum functionality")

The single biggest risk for this app. Apple scrutinises apps that are "just a
website in a wrapper". Mitigations already in place — cite them in the **Review
Notes** if challenged:
- Native **foreground geolocation** (native permission dialog, higher accuracy).
- Native **Share**, **Haptics**, **Status-Bar**, and external links via
  **SFSafariViewController** (`@capacitor/browser`).
- Offline fallback shell; safe-area-aware native chrome.
- A genuine utility (accessibility data aggregation) with no web-only equivalent
  the user is expected to visit instead.

If rejected under 4.2, the lever with the best effort/impact ratio is adding a
clearly native capability (e.g. richer offline support, or Live-Tracking from the
planned `project_issue20_live_tracking`) — not cosmetic changes.

## Appendix B — Gotchas (iOS-specific)

- **SPM, not CocoaPods:** this project integrates Capacitor via Swift Package
  Manager (`CapApp-SPM`). Don't run `pod install`; resolve packages in Xcode. After
  `npx cap sync ios`, let Xcode re-resolve if prompted.
- **Build number must increase** on every upload — the most common upload
  rejection. `CURRENT_PROJECT_VERSION` is the source of truth.
- **`contentInset: "never"`** is intentional (we handle insets via
  `viewport-fit=cover` + `env(safe-area-inset-*)`). Switching to "automatic"
  reintroduces double-inset white gaps — do not change it (see v8.11).
- **Permission strings are localised DE only.** For non-German App Store locales,
  consider an `InfoPlist.strings` localisation; review can flag a missing/locale-
  mismatched purpose string. Low priority, but cheap to add.
- **Privacy manifest drift:** if a future plugin adds a "required reason" API
  (e.g. file timestamps, disk space), `PrivacyInfo.xcprivacy` must be updated or
  the upload warns/fails.
- **Plugin JS must stay in the Vercel bundle** (same as Android): a web deploy that
  drops the `@capacitor/*` imports silently breaks native geolocation in the app.
- **Sessions/`localStorage`** persist in WKWebView, so settings and `ap_visited`
  behave like the website. (Note the historical iOS cold-start localStorage race —
  see the `defaultSearchMode` fixes v8.8/v8.9 and the `#418` pattern.)

## Appendix C — Relation to Android

Same `appId`, same remote `server.url`, same `lib/native/*` code, same offline
shell. The platforms diverge only in the native projects (`android/` vs `ios/`)
and their store pipelines. A native-shell change usually means: edit web/config →
`npx cap sync ios && npx cap sync android` → build/upload both. Web-only changes
need neither.
