import * as maplibregl from "maplibre-gl"

// Points MapLibre at the self-hosted worker copy in public/ (kept in sync via
// the "postinstall" script — see scripts/copy-maplibre-worker.mjs) instead of
// letting it spawn its worker from a blob: URL. This is what lets the CSP
// worker-src directive stay 'self' with no blob: exception (see next.config.ts).
// Must run once, before the first `new maplibregl.Map(...)` — call
// ensureMaplibreWorkerConfigured() at the top of any module that constructs a map.
let configured = false

export function ensureMaplibreWorkerConfigured(): void {
  if (configured) return
  maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs")
  configured = true
}
