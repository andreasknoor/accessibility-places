// Umami Cloud tracking script, mounted only when NEXT_PUBLIC_UMAMI_WEBSITE_ID is
// set. Runs in parallel with Vercel Analytics for evaluation (see
// docs/analytics-alternatives.md). The script exposes a global `window.umami`
// that lib/analytics.ts dual-emits custom events to; without the env var nothing
// loads and Vercel Analytics remains the only sink.
//
// IMPORTANT — render a plain <script> tag, NOT next/script. Umami's tracker reads
// its config (data-website-id, data-host-url) via `document.currentScript`, which
// is null for scripts inserted dynamically by JS. next/script (afterInteractive)
// injects the tag client-side, so currentScript is null and Umami silently sends
// nothing. A markup-parsed <script> (this Server Component emits it into the HTML)
// sets document.currentScript correctly. This matches Umami's documented snippet.
//
// CSP: cloud.umami.is must be in script-src + connect-src (next.config.ts).
// The host defaults to Umami Cloud but can be overridden for a different region
// or a self-hosted instance via NEXT_PUBLIC_UMAMI_SRC.
export default function UmamiScript() {
  const websiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID
  if (!websiteId) return null

  const src = process.env.NEXT_PUBLIC_UMAMI_SRC ?? "https://cloud.umami.is/script.js"

  return <script defer src={src} data-website-id={websiteId} />
}
