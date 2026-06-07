import type { NextConfig } from "next"
import withSerwistInit from "@serwist/next"

// Serwist is disabled entirely. It was never functional in production anyway —
// the build uses Turbopack (see turbopack:{} below), which Serwist does not
// support, so no SW was generated or registered originally. A brief webpack
// build accidentally generated, committed, and shipped a caching SW that broke
// the deployed map for returning visitors. public/sw.js is now a hand-written
// self-destruct worker that unregisters that SW; keeping Serwist disabled means
// no registration script is injected and the self-destruct file is never
// overwritten by a regenerated caching SW. Re-enable only with an intentional
// PWA rework (and add public/sw.js back to .gitignore as a build artifact).
const withSerwist = withSerwistInit({
  swSrc:  "app/sw.ts",
  swDest: "public/sw.js",
  disable: true,
})

const securityHeaders = [
  { key: "X-Frame-Options",           value: "DENY" },
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=(self)" },
  {
    key:   "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://tally.so https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://*.tile.openstreetmap.org https://maps.gstatic.com https://upload.wikimedia.org https://commons.wikimedia.org https://lh3.googleusercontent.com",
      "connect-src 'self' https://nominatim.openstreetmap.org https://places.googleapis.com https://api.accessibility.cloud https://www.reisefueralle.de https://tally.so https://api.ginto.guide https://overpass.accessible-places.org https://overpass-api.de https://overpass.kumi.systems https://photon.komoot.io https://www.wikidata.org https://lh3.googleusercontent.com https://logs.accessible-places.org",
      "font-src 'self'",
      "frame-src https://tally.so",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; "),
  },
]

const nextConfig: NextConfig = {
  env: {
    BUILD_DATE: new Date().toISOString().split("T")[0], // "YYYY-MM-DD", frozen at build time
  },
  // Next.js 16 defaults to Turbopack for build + dev. Keep it explicit: the
  // production build MUST use Turbopack. Switching to webpack (v3.84) broke the
  // Leaflet map (dynamic CSS imports dropped / intermittent CSS race). This was
  // the last known-good configuration.
  turbopack: {},
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }]
  },
  async redirects() {
    return [
      {
        source:      "/:path*",
        has:         [{ type: "host", value: "www.accessible-places.org" }],
        destination: "https://accessible-places.org/:path*",
        permanent:   true,
      },
      // Localised EN slugs (parity with /en/privacy). Old German-slug URLs may be
      // indexed or bookmarked — 301 them to the new English slugs.
      { source: "/en/ueber-uns", destination: "/en/about",        permanent: true },
      { source: "/en/impressum", destination: "/en/legal-notice", permanent: true },
    ]
  },
}

export default withSerwist(nextConfig)
