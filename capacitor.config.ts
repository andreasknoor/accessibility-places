import type { CapacitorConfig } from "@capacitor/cli"

// Remote-URL hosting: the native WebView loads the live Vercel site. No static
// export — full SSR/API/ISR support, and web deploys appear in the app without a
// Play release. Only native-shell/plugin changes need a new versionCode.
//
// Dev note: to test the native app against the `develop` preview instead of
// production, temporarily point `server.url` at the Vercel preview URL (or a
// stable develop alias). The committed value targets production.
const config: CapacitorConfig = {
  appId: "org.accessibleplaces.app",
  appName: "Accessible Places",
  webDir: "capacitor-shell", // offline fallback only — real content is remote
  server: {
    url: "https://accessible-places.org",
    androidScheme: "https", // page origin stays https → cookies, sessions, CSP unchanged
    allowNavigation: ["accessible-places.org"], // our host stays in-app; off-origin links open in the system browser
  },
  android: {
    backgroundColor: "#ffffff",
  },
  ios: {
    backgroundColor: "#ffffff",
    scheme: "Accessible Places",
    // never = the WebView fills the whole screen edge-to-edge; we handle the
    // notch / home-indicator insets ourselves via viewport-fit=cover +
    // env(safe-area-inset-*) padding on the header and bottom nav. With
    // "automatic" WebKit *also* inset the content, leaving white status-bar /
    // home-indicator gaps on top of our own padding (double inset).
    contentInset: "never",
  },
  plugins: {
    SplashScreen: {
      // launchAutoHide:false keeps the NATIVE splash up until the web SplashOverlay
      // has painted and calls SplashScreen.hide() (components/SplashOverlay.tsx, in a
      // post-paint useEffect). This app loads a REMOTE URL, so the WebView load +
      // React mount take longer than the old 600ms launchShowDuration — auto-hiding
      // dropped the native splash before the web overlay was ready, leaving a flicker
      // of bare app content. Manual hide = seamless handoff, no flicker.
      // Note: with launchAutoHide:false, launchShowDuration is inert (no auto-dismiss
      // ceiling); dismissal relies solely on SplashOverlay calling hide().
      launchAutoHide: false,
      launchShowDuration: 600,
      backgroundColor: "#ffffff",
      androidScaleType: "CENTER_CROP",
      iosSpinnerStyle: "small",
      showSpinner: false,
    },
  },
}

export default config
