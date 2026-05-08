import type { NextConfig } from "next"
import withSerwistInit from "@serwist/next"

const withSerwist = withSerwistInit({
  swSrc:  "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://tally.so",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://*.tile.openstreetmap.org https://maps.gstatic.com",
      "connect-src 'self' https://nominatim.openstreetmap.org https://places.googleapis.com https://api.accessibility.cloud https://www.reisefueralle.de https://tally.so",
      "font-src 'self'",
      "frame-src https://tally.so",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; "),
  },
]

const nextConfig: NextConfig = {
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
    ]
  },
}

export default withSerwist(nextConfig)
