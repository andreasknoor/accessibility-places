// Monitors how often base-map (OpenFreeMap) tile loads stall, to get a feel
// for how common the multi-second-to-minutes stalls are in practice — see
// the investigation in docs/architecture/mapview-gl.md's "no CDN in front of
// tiles.openfreemap.org" note. Reports one aggregated GlitchTip event per
// flush window rather than one per slow tile: a single bad connection can
// stall dozens of tiles at once (observed live), and per-tile reporting
// would flood GlitchTip instead of giving a usable signal.
import * as Sentry from "@sentry/nextjs"
import type * as maplibregl from "maplibre-gl"

const SLOW_TILE_THRESHOLD_MS = 30_000
// Catches tiles that never fire a completion event at all (the "hangs
// forever" case) — without this, a request that's still pending when the
// flush fires would simply never be counted.
const SWEEP_INTERVAL_MS = 10_000
const FLUSH_INTERVAL_MS = 60_000

/**
 * Starts tracking tile-load duration via MapLibre's public
 * sourcedataloading/sourcedata/sourcedataabort events (matched by
 * `coord.key`, per the MapSourceDataEvent type). Returns a teardown function
 * that removes the listeners, stops the timers, and flushes any pending
 * summary immediately (so a mount that ends mid-window doesn't lose data).
 */
export function startSlowTileMonitoring(map: maplibregl.Map): () => void {
  const pendingStart = new Map<string, number>()
  // Keys already counted by the sweep, so the eventual sourcedata/abort
  // event for the same tile doesn't double-count it.
  const flaggedSlow = new Set<string>()
  let slowCount = 0
  let trackedCount = 0
  let maxDurationMs = 0

  function flush() {
    if (slowCount > 0) {
      Sentry.captureMessage(
        `Slow map tile loads: ${slowCount} tile(s) exceeded ${SLOW_TILE_THRESHOLD_MS / 1000}s`,
        {
          level: "warning",
          tags:  { area: "map-tile-loading" },
          extra: { slowCount, trackedCount, maxDurationMs, stillPending: pendingStart.size },
        },
      )
    }
    slowCount = 0
    trackedCount = 0
    maxDurationMs = 0
    flaggedSlow.clear()
  }

  function onLoading(e: maplibregl.MapSourceDataEvent) {
    if (!e.coord) return
    pendingStart.set(e.coord.key, Date.now())
  }

  function onSettled(e: maplibregl.MapSourceDataEvent) {
    if (!e.coord) return
    const key = e.coord.key
    const start = pendingStart.get(key)
    pendingStart.delete(key)
    if (start === undefined) return
    if (flaggedSlow.has(key)) { flaggedSlow.delete(key); return }
    trackedCount++
    const duration = Date.now() - start
    if (duration >= SLOW_TILE_THRESHOLD_MS) {
      slowCount++
      maxDurationMs = Math.max(maxDurationMs, duration)
    }
  }

  map.on("sourcedataloading", onLoading)
  map.on("sourcedata", onSettled)
  map.on("sourcedataabort", onSettled)

  const sweepId = setInterval(() => {
    const now = Date.now()
    for (const [key, start] of pendingStart) {
      if (flaggedSlow.has(key)) continue
      if (now - start < SLOW_TILE_THRESHOLD_MS) continue
      flaggedSlow.add(key)
      slowCount++
      trackedCount++
      maxDurationMs = Math.max(maxDurationMs, now - start)
    }
  }, SWEEP_INTERVAL_MS)

  const flushId = setInterval(flush, FLUSH_INTERVAL_MS)

  return () => {
    clearInterval(sweepId)
    clearInterval(flushId)
    map.off("sourcedataloading", onLoading)
    map.off("sourcedata", onSettled)
    map.off("sourcedataabort", onSettled)
    flush()
  }
}
