import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs"

// Redacts credentials from everything sent to GlitchTip. The fetch
// breadcrumbs record full upstream URLs including query strings, which put
// e.g. the accessibility.cloud `appToken` into every stored event; incoming
// request URLs carry `?token=` for /api/health, /api/stats and /api/v1.
// Headers are not recorded by default, so header-borne keys (Ginto Bearer,
// X-Goog-Api-Key, X-AP-Key) never reach these paths.

const SECRET_PARAM = /^(app_?token|token|access_?token|api_?key|apikey|key|secret|password|signature|sig|uid)$/i
export const REDACTED = "[redacted]"

/** Redact secret-looking query parameters in a URL or bare query string. */
export function scrubQuery(input: string): string {
  return input.replace(/([?&;]|^)([^=&?#;]+)=([^&#;]*)/g, (m, sep: string, name: string) =>
    SECRET_PARAM.test(decodeURIComponentSafe(name)) ? `${sep}${name}=${REDACTED}` : m,
  )
}

function decodeURIComponentSafe(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  if (crumb.message) crumb.message = scrubQuery(crumb.message)
  const data = crumb.data
  if (data) {
    for (const k of ["url", "http.query", "from", "to"]) {
      if (typeof data[k] === "string") data[k] = scrubQuery(data[k] as string)
    }
  }
  return crumb
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const req = event.request
  if (req) {
    if (typeof req.url === "string") req.url = scrubQuery(req.url)
    if (typeof req.query_string === "string") req.query_string = scrubQuery(req.query_string)
    else if (req.query_string && typeof req.query_string === "object") {
      const qs = req.query_string as Record<string, string> | [string, string][]
      if (Array.isArray(qs)) {
        for (const pair of qs) if (SECRET_PARAM.test(pair[0])) pair[1] = REDACTED
      } else {
        for (const k of Object.keys(qs)) if (SECRET_PARAM.test(k)) qs[k] = REDACTED
      }
    }
  }
  for (const crumb of event.breadcrumbs ?? []) scrubBreadcrumb(crumb)
  return event
}
