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
    contentInset: "automatic",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: "#ffffff",
      androidScaleType: "CENTER_CROP",
      iosSpinnerStyle: "small",
      showSpinner: false,
    },
  },
}

export default config
