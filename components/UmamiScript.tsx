import Script from "next/script"

// Umami Cloud tracking script, mounted only when NEXT_PUBLIC_UMAMI_WEBSITE_ID is
// set. Runs in parallel with Vercel Analytics for evaluation (see
// docs/analytics-alternatives.md). The script exposes a global `window.umami`
// that lib/analytics.ts dual-emits custom events to; without the env var nothing
// loads and Vercel Analytics remains the only sink.
//
// CSP: cloud.umami.is must be in script-src + connect-src (next.config.ts).
// The host defaults to Umami Cloud but can be overridden for a different region
// or a self-hosted instance via NEXT_PUBLIC_UMAMI_SRC.
export default function UmamiScript() {
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID
  if (!websiteId) return null

  const src = process.env.NEXT_PUBLIC_UMAMI_SRC ?? "https://cloud.umami.is/script.js"

  return (
    <Script
      src={src}
      data-website-id={websiteId}
      strategy="afterInteractive"
    />
  )
}
