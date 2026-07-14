"use client"

// Native-aware "start navigation" helper. Deliberately NOT built on
// openExternalUrl()/NativeLink (lib/native/browser.ts) — that mechanism opens a
// Custom Tab / SFSafariViewController, a browser context the OS's "hand off an
// unrecognised URI scheme to an installed app" behaviour cannot reliably reach
// into. Maps deep-link schemes (`maps://`, `google.navigation:`, `geo:`) need a
// plain WebView navigation (`window.location.href`) instead — the same path any
// other link tap uses to escape the WebView into a native app.
//
// Reduced-scope Variant C (see docs/plans/native-navigate-here.md): iOS ships
// with no in-app chooser — Apple Maps is the only option, identical to plain
// Variant B — because offering "Google Maps" there would need a canOpenURL
// installed-app check, which requires declaring `comgooglemaps` under
// ios/App/App/Info.plist's LSApplicationQueriesSchemes (a native Xcode project
// change) to avoid a silent dead tap when Google Maps isn't installed. Android
// needs no such entitlement (PackageManager queries aren't gated the way iOS 9+
// gates canOpenURL), so it gets a real two-option chooser: Google Maps directly,
// or Android's own OS-level "Open with" picker via the generic `geo:` URI.
import { getPlatform } from "@/lib/analytics"

export interface NavCoords {
  lat: number
  lon: number
}

export type NavApp = "google" | "apple" | "geo"

// Google's own documented cross-platform "directions" URL — works as a plain
// https link everywhere (desktop browser, mobile browser, native WebView via
// Android App Link resolution). This is the universal fallback for every
// context that isn't a native app with a platform-specific scheme available.
export function universalMapsUrl({ lat, lon }: NavCoords): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
}

// Platform-native deep-link URIs. Only meaningful inside the Capacitor native
// shell — navigating a desktop or mobile *browser* tab to `google.navigation:`
// just fails, hence universalMapsUrl() above as the non-native fallback.
export function navAppUrl(app: NavApp, { lat, lon }: NavCoords): string {
  switch (app) {
    // Google's own Android Intent URI — launches Google Maps already in
    // driving-navigation mode (not just a dropped pin).
    case "google": return `google.navigation:q=${lat},${lon}`
    // Apple Maps' own scheme — guaranteed present on every iOS device.
    case "apple":  return `maps://?daddr=${lat},${lon}&dirflg=d`
    // Android OS-standard URI. If more than one navigation-capable app is
    // installed, Android pops its own native "Open with" chooser — this is
    // how a non-Google app (Waze etc.) stays reachable without us needing to
    // enumerate installed apps ourselves.
    case "geo":    return `geo:0,0?q=${lat},${lon}`
  }
}

// Fires a plain WebView navigation to a custom scheme. The OS's default
// "I don't recognise this scheme, hand it to an installed app" behaviour then
// takes over — the same mechanism a tapped link in any other app would use.
// No native plugin call, no Capacitor API — this only works because Capacitor's
// WebView already hands off unrecognised schemes by default (verified: iOS
// WKWebView does this unconditionally; Android's WebView wrapper does too via
// its default shouldOverrideUrlLoading handling — see the concept doc's
// "Technical risk" note on Variant B for the one case this needs revisiting).
function navigateWebViewTo(uri: string): void {
  window.location.href = uri
}

// Starts navigation using the platform's own default maps app — Google Maps
// on Android, Apple Maps on iOS, the universal Google Maps web fallback
// everywhere else (desktop browser, mobile browser, PWA). This is Variant B
// from the concept doc, with Variant A as its non-native fallback.
//
// The window.open() call is expected to work everywhere this branch runs,
// including an installed iOS home-screen PWA (app/manifest.ts's
// display: "standalone") — but WebKit's standalone display mode is known to
// sometimes block/no-op window.open(..., "_blank") even under a synchronous
// user gesture. window.open() returns null (not a thrown error) when
// blocked, so falling back to a same-tab navigation on that signal is a
// low-risk, well-established mitigation — worst case on platforms where the
// popup succeeds, the fallback branch simply never runs.
export function startDefaultNavigation(coords: NavCoords): void {
  const platform = getPlatform()
  if (platform === "android") { navigateWebViewTo(navAppUrl("google", coords)); return }
  if (platform === "ios")     { navigateWebViewTo(navAppUrl("apple",  coords)); return }
  const url = universalMapsUrl(coords)
  const win = window.open(url, "_blank", "noopener,noreferrer")
  if (!win) window.location.href = url
}

// Whether the in-app chooser popover (reduced-scope Variant C, see file
// header) should be offered for the given platform — Android only. Single
// source of truth for "which platform gets a chooser": components/ui/
// navigate-button.tsx reads this instead of re-deriving its own
// `platform === "android"` check, which previously could drift from the
// platform branches in startDefaultNavigation above with nothing to catch it.
export function shouldShowChooser(platform: string = getPlatform()): boolean {
  return platform === "android"
}

// Starts navigation in a specific app, for the Android in-app chooser popover
// (reduced-scope Variant C — see file header). Only ever called with "google"
// or "geo" in practice, since the chooser is Android-only.
export function startNavigationWithApp(app: NavApp, coords: NavCoords): void {
  navigateWebViewTo(navAppUrl(app, coords))
}
