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
const src = join(root, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs")
const destDir = join(root, "public")
const dest = join(destDir, "maplibre-gl-worker.mjs")

if (!existsSync(src)) {
  console.warn("[copy-maplibre-worker] maplibre-gl worker not found — skipping (maplibre-gl not installed?)")
  process.exit(0)
}

if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
copyFileSync(src, dest)
console.log("[copy-maplibre-worker] copied maplibre-gl-worker.mjs -> public/")
