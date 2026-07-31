// Self-hosts the MapLibre GL worker script (public/maplibre-gl-worker.mjs)
// instead of letting MapLibre spawn it from a blob: URL. This is what lets
// the CSP `worker-src` directive stay `'self'` — no `blob:` needed — since
// setWorkerUrl() (called once in lib/map/maplibre-worker.ts) points at this
// same-origin file. Re-run automatically via the "postinstall" script
// whenever maplibre-gl's version changes, so the copy can't silently drift
// out of sync with the installed library.
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")
const srcDir = join(root, "node_modules/maplibre-gl/dist")
const destDir = join(root, "public")

// maplibre-gl-worker.mjs is an ES module that itself imports
// maplibre-gl-shared.mjs (checked via `grep -o 'from"\./[^"]*"'` against both
// files, 2026-07-31 — worker.mjs has exactly this one relative import,
// shared.mjs has none). Copying only the worker file 404s that import inside
// the worker's own module graph, which fails SILENTLY — no console error on
// the main thread, "load" just never fires. Copy both; re-check this list on
// a maplibre-gl version bump (a future release could add more shared chunks).
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]

if (!existsSync(join(srcDir, FILES[0]))) {
  console.warn("[copy-maplibre-worker] maplibre-gl worker not found — skipping (maplibre-gl not installed?)")
  process.exit(0)
}

if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
for (const f of FILES) copyFileSync(join(srcDir, f), join(destDir, f))
console.log(`[copy-maplibre-worker] copied ${FILES.join(", ")} -> public/`)
