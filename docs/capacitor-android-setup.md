# Capacitor Android App — Implementation Runbook

Build a native Android app around the existing web app using
[Capacitor](https://capacitorjs.com), **replacing** the current Bubblewrap TWA.

## Chosen approach (decisions on 2026-06-04)

| Decision | Choice | Consequence |
|---|---|---|
| **Hosting** | **Remote-URL** — the native WebView loads the live site `https://accessible-places.org` | No static export; full SSR/API/ISR support out of the box. Web changes deploy via Vercel and appear in the app instantly (no Play update). Only native-shell/plugin changes need a new release. |
| **Native feature** | **Native foreground geolocation** | Replaces the browser geolocation when running in the app (native permission dialog, higher accuracy). True *background* location is an optional heavy add-on — see Appendix A. |
| **Relation to TWA** | **Replace it** | Same package `org.accessibleplaces.app`, same Play App Signing, reuse the existing keystore, bump versionCode. The Capacitor AAB is uploaded to the *same* Play listing. |
| **Platform** | **Android now, iOS-ready** | Add only the Android platform now; keep `capacitor.config.ts` and the geolocation code platform-neutral so `npx cap add ios` works later (Appendix C). |

### Concrete values (from `android-twa/twa-manifest.json`)

| | |
|---|---|
| `appId` / applicationId | **`org.accessibleplaces.app`** (must match the TWA) |
| App name | **Accessible Places** (launcher: AccessPlaces) |
| Production host | **accessible-places.org** |
| Current uploaded versionCode | **8** → Capacitor starts at **9** (verify the real last value in Play Console) |
| Keystore | `/Users/andreasknoor/accessible-places-keystore/android.keystore`, alias `android` (outside the repo, reuse it) |

---

## The crux: how remote-URL Capacitor works (read first)

With `server.url` set, the native WebView loads the **remote** Vercel site. The
native runtime injects the Capacitor **bridge** (`window.Capacitor`) into that
page. The plugin **JavaScript wrappers** (`@capacitor/core`, `@capacitor/geolocation`)
are thin and must be **part of the page's bundle** — i.e. shipped by the Next.js
app on Vercel. At runtime the web code branches:

```
Capacitor.isNativePlatform()  → true  in the app  → native Geolocation plugin
                              → false in a browser → navigator.geolocation
```

**This means two codebases are touched:**
1. **The native shell** (this repo's new `android/` + `capacitor.config.ts`) — built and shipped to Play.
2. **The web app** (Next.js) — gains `@capacitor/*` deps + a native-aware geolocation path, **deployed to Vercel like any normal change**.

**Big upside:** because the content is remote, day-to-day web changes never need
a Play release — only native-shell changes (plugins, permissions, icon, config)
do. The versionCode only bumps for those.

---

## Prerequisites

- Node 20+, the repo checked out.
- **Android Studio** with SDK Platform 35 + Build-Tools + Platform-Tools, **JDK 17**.
- The signing keystore at `/Users/andreasknoor/accessible-places-keystore/android.keystore` (alias `android`) and its passwords.
- Play Console access to the existing `org.accessibleplaces.app` listing.

## Project layout

Capacitor lives at the **repo root** (idiomatic). The web runtime code and the
native build then share one dependency tree (`package.json`) — important because
the remote page needs the same `@capacitor/*` JS the native build registers.
`npx cap add android` generates `android/` at the root. A tiny `capacitor-shell/`
folder is the offline fallback `webDir`. The old `android-twa/` is retired in
Phase 9 once Capacitor is validated.

`.gitignore` additions (keep source, ignore build output & secrets):
```
/android/.gradle
/android/app/build
/android/build
/android/app/release
/android/local.properties
/android/keystore.properties
*.keystore
*.jks
*.aab
*.apks
*.idsig
```

---

## Phase 1 — Install & initialise

```bash
# Core + CLI + Android platform
npm install @capacitor/core @capacitor/cli @capacitor/android
# Plugins: geolocation (the feature) + shell essentials
npm install @capacitor/geolocation @capacitor/app @capacitor/splash-screen @capacitor/status-bar
# Dev-only: icon/splash generator
npm install -D @capacitor/assets

# Minimal offline fallback shell (shown only if the remote site is unreachable)
mkdir -p capacitor-shell
cat > capacitor-shell/index.html <<'HTML'
<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Accessible Places</title>
<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
<div><h1>Accessible Places</h1><p>Keine Verbindung. Bitte später erneut versuchen.</p></div></body>
HTML

# Initialise (writes capacitor.config.ts)
npx cap init "Accessible Places" "org.accessibleplaces.app" --web-dir=capacitor-shell
```

> `appId` **must** be `org.accessibleplaces.app` — it's how Play knows this is an
> update to the existing app, not a new one.

## Phase 2 — `capacitor.config.ts`

Replace the generated file with:

```ts
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId:   'org.accessibleplaces.app',
  appName: 'Accessible Places',
  webDir:  'capacitor-shell',              // offline fallback only
  server: {
    url:            'https://accessible-places.org',   // remote-URL hosting
    androidScheme:  'https',                           // page origin stays https
    allowNavigation: ['accessible-places.org'],        // in-app nav for our host…
    // …any off-origin link (Wheelmap, OSM, Google Maps) opens in the system
    // browser by default. Add hosts here only if you want them to stay in-app.
  },
  android: { backgroundColor: '#ffffff' },
  plugins: {
    SplashScreen: { launchShowDuration: 600, backgroundColor: '#ffffff', androidScaleType: 'CENTER_CROP' },
  },
}
export default config
```

Notes:
- `androidScheme: 'https'` keeps the page origin `https://accessible-places.org`,
  so cookies/sessions and **the existing CSP both keep working unchanged**.
- No cleartext traffic (all HTTPS) — leave `server.cleartext` off.

## Phase 3 — Add the Android platform

```bash
npx cap add android
```

Then edit the native project:

**`android/app/src/main/AndroidManifest.xml`** — add location permissions (INTERNET is already present):
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

**`android/app/build.gradle`** — set the version (must exceed the last uploaded **8**):
```gradle
android {
  defaultConfig {
    applicationId "org.accessibleplaces.app"
    minSdkVersion 23
    targetSdkVersion 35          // keep within Play's current requirement
    versionCode 9                // > 8 (verify last-uploaded in Play Console)
    versionName "9.0"
  }
}
```

```bash
npx cap sync android            # copies config + plugins into the native project
```

## Phase 4 — Web side: native-aware geolocation (ships to Vercel)

This is a **normal change to the Next.js app**, deployed via Vercel. It makes the
*same* code use native GPS inside the app and the browser API on the web.

1. The `@capacitor/core` + `@capacitor/geolocation` packages are already in
   `package.json` (Phase 1) — the web bundle can import them.

2. Add `lib/native/geolocation.ts`:
   ```ts
   import { Capacitor } from '@capacitor/core'

   export async function getCurrentPosition(
     opts?: { timeout?: number; enableHighAccuracy?: boolean },
   ): Promise<{ lat: number; lon: number }> {
     if (Capacitor.isNativePlatform()) {
       const { Geolocation } = await import('@capacitor/geolocation')   // native only
       let perm = await Geolocation.checkPermissions()
       if (perm.location !== 'granted') perm = await Geolocation.requestPermissions()
       if (perm.location !== 'granted') throw new Error('location-permission-denied')
       const p = await Geolocation.getCurrentPosition({
         enableHighAccuracy: opts?.enableHighAccuracy ?? true,
         timeout: opts?.timeout ?? 10_000,
       })
       return { lat: p.coords.latitude, lon: p.coords.longitude }
     }
     // Web fallback — mirrors the current navigator.geolocation usage
     return new Promise((resolve, reject) => {
       navigator.geolocation.getCurrentPosition(
         (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
         reject,
         { enableHighAccuracy: opts?.enableHighAccuracy ?? false, timeout: opts?.timeout ?? 5_000, maximumAge: 60_000 },
       )
     })
   }
   ```

3. Route the existing GPS calls through it. Today `navigator.geolocation` is used
   in `HomeClient.handlePlaceSearch` (nearby resolution) and the ChatPanel
   "locate" control — replace those direct calls with `getCurrentPosition(...)`.
   The dynamic `import('@capacitor/geolocation')` keeps the native plugin out of
   the web bundle's critical path.

4. **Hardware back button** (WebView UX — back should navigate web history, not
   exit). Add a client-side init that runs once on mount:
   ```ts
   import { Capacitor } from '@capacitor/core'
   if (Capacitor.isNativePlatform()) {
     const { App } = await import('@capacitor/app')
     App.addListener('backButton', () => {
       if (window.history.length > 1) window.history.back()
       else App.exitApp()
     })
   }
   ```
   Put this in a small null-rendering client component mounted in the root
   layout (e.g. `components/CapacitorInit.tsx`).

5. **CSP:** no change needed — the page origin is still `https://accessible-places.org`
   and the Capacitor bridge is injected in-process (no external domain). The
   native geolocation call does not go over the network.

6. Bump `APP_VERSION`, `npm test`, deploy to Vercel. The web is now native-aware
   even before the app ships — harmless in a normal browser (`isNativePlatform()`
   is false).

## Phase 5 — Native shell polish (icon, splash, status bar)

```bash
# Source assets: a 1024×1024 icon and a splash source (reuse the PWA icon)
mkdir -p assets
cp public/icons/icon-512.png assets/icon.png      # ideally supply a 1024px master
npx @capacitor/assets generate --android          # generates launcher icons + splash
npx cap sync android
```

- Splash behaviour is configured in `capacitor.config.ts` (Phase 2).
- Optional: `@capacitor/status-bar` to set the status-bar colour from the web app.
- Offline fallback: the `capacitor-shell/index.html` is shown if the remote site
  cannot load. For richer offline handling use `@capacitor/network` to detect and
  message the user.

## Phase 6 — Signing (reuse the existing keystore)

Create `android/keystore.properties` (git-ignored):
```properties
storeFile=/Users/andreasknoor/accessible-places-keystore/android.keystore
storePassword=********
keyAlias=android
keyPassword=********
```

In `android/app/build.gradle`, load it and add a release `signingConfig`:
```gradle
def ksProps = new Properties()
def ksFile = rootProject.file("keystore.properties")
if (ksFile.exists()) ksProps.load(new FileInputStream(ksFile))

android {
  signingConfigs {
    release {
      storeFile     file(ksProps['storeFile'])
      storePassword ksProps['storePassword']
      keyAlias      ksProps['keyAlias']
      keyPassword   ksProps['keyPassword']
    }
  }
  buildTypes {
    release { signingConfig signingConfigs.release; minifyEnabled false }
  }
}
```

> Because Play App Signing is already enabled for this app, you sign with the
> **upload** key (this keystore) and Google re-signs. Reusing the same upload key
> the TWA used means **no key reset** is needed.

## Phase 7 — Build & upload (replace the TWA)

```bash
npx cap sync android
cd android && ./gradlew bundleRelease        # → android/app/build/outputs/bundle/release/app-release.aab
```

In **Play Console** (same app, `org.accessibleplaces.app`):
1. Upload the AAB to the **same closed-testing track** the TWA used — it replaces
   the TWA build. versionCode **9** must be greater than the last uploaded.
2. **Permissions / Data safety:** the app now requests **location** — update the
   Data safety form and expect a review. Users will see the new permission on
   update.
3. The TWA's `assetlinks.json` (Digital Asset Links) is **no longer required** for
   Capacitor to function. Leave it in place (harmless) or repurpose it later for
   Android App Links (Appendix C).
4. Roll out to closed testing → verify on a real device → promote.

## Phase 8 — Verify on a device

- Location **permission dialog** appears natively; "Nearby" search uses native GPS.
- Hardware **back** navigates web history; exits only at the root.
- External links (Wheelmap, OSM, Google Maps) open in the **system browser**.
- Pull the network → the **offline fallback** shows; restore → site loads.
- Deploy a trivial web change to Vercel → it appears in the app **without** a Play
  update (confirms the remote-URL advantage).

## Phase 9 — Cut over & retire the TWA

Once Capacitor is validated on the closed-testing track:
- `git rm -r android-twa` (the Bubblewrap project is superseded).
- Update `CLAUDE.md` (the "Android" notes) and the `project_android_twa_status`
  memory to reflect the Capacitor cut-over.

---

## Appendix A — True background geolocation (optional, heavy)

`@capacitor/geolocation` covers **foreground** only (`getCurrentPosition`,
`watchPosition` while the app is open). Real background tracking (app
backgrounded/closed) requires:
- a community plugin (e.g. `@capacitor-community/background-geolocation`) + an
  Android **foreground service**,
- the `ACCESS_BACKGROUND_LOCATION` permission,
- a Play Console **"Background location access" declaration** with a justification
  video and a **manual review**, plus a privacy-policy update.

This app's "find accessible places near me" flow is inherently foreground, so
background location is most likely **not needed** and adds significant policy
risk. Only pursue it for a concrete background use case.

## Appendix B — Gotchas

- **Play "minimum functionality" policy:** WebView-wrapper apps get scrutiny.
  Native geolocation + a proper native shell justify it; the TWA was already
  accepted, and Capacitor is more substantial. Still, keep the listing honest.
- **Plugin JS must stay in the Vercel bundle:** if a future web deploy drops the
  `@capacitor/*` imports, native geolocation silently breaks. The deps live in
  the root `package.json`; keep them.
- **versionCode discipline:** every Play upload needs a higher versionCode; web
  changes do **not** (they're remote). Track the native versionCode separately
  from `APP_VERSION`.
- **targetSdk currency:** Play requires a recent `targetSdkVersion` (within ~1
  year). Bump it as Play deadlines move.
- **Sessions/cookies** persist in the WebView, so logins and `localStorage`
  (settings, `ap_visited`, etc.) behave like the website.

## Appendix C — iOS later (kept portable)

Nothing here is Android-only by design. When ready:
```bash
npm install @capacitor/ios
npx cap add ios
```
Then add `NSLocationWhenInUseUsageDescription` to `ios/App/App/Info.plist`, reuse
the same `server.url`, and generate iOS icons via `@capacitor/assets`. Note that
**Apple is stricter** about webview-only apps (App Store Review Guideline 4.2) —
the native geolocation and shell help, but expect more review friction than on
Play.
