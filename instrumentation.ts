// Server- and edge-side error reporting to the self-hosted GlitchTip instance.
// Counterpart to instrumentation-client.ts (client). `register()` runs once when
// the server (or an edge runtime) boots; `onRequestError` forwards errors thrown
// in Server Components, route handlers, and middleware to GlitchTip.
//
// Sentry.init is isomorphic, so a single init covers both the Node.js and Edge
// runtimes here — we keep no runtime-specific integrations. See
// instrumentation-client.ts for why no `withSentryConfig` wrapper is used.
import * as Sentry from "@sentry/nextjs"

export async function register() {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.NODE_ENV === "production",
    tracesSampleRate: 0,
    maxBreadcrumbs: 50,
  })
}

export const onRequestError = Sentry.captureRequestError
