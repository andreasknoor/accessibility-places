// Client-side error reporting to the self-hosted GlitchTip instance
// (logs.accessible-places.org). GlitchTip speaks the Sentry ingest protocol, so
// we use the official @sentry/nextjs SDK pointed at our own DSN. This file is
// loaded natively by Next.js on the client — no `withSentryConfig` wrapper is
// used, deliberately: the wrapper's build-time features are webpack-bound and
// don't apply under this project's required Turbopack build (see next.config.ts).
//
// GlitchTip is error-only: performance tracing and session replay are off.
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Only report from the deployed app; never from local dev or from a build
  // where the DSN env var is absent.
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.NODE_ENV === "production",
  tracesSampleRate: 0,          // no performance transactions → less volume
  maxBreadcrumbs: 50,           // context depth attached to each error (default 100)
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications.",
    "Non-Error promise rejection captured",
    "AbortError",               // aborted in-flight search/fetch requests
    // Firefox for iOS injects a `__firefox__` content script (reader-mode
    // detection) into every page; on article-like pages such as /faq it throws
    // "Can't find variable: __firefox__" / "window.__firefox__.reader" from the
    // browser's own script, not ours. Pure third-party noise — drop it.
    /__firefox__/,
  ],
})

// Required by Next.js 15.3+ so the SDK can hook client-side navigations.
// A no-op while tracing is disabled, but keeps the SDK from warning.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
