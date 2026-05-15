/**
 * Warms the Vercel ISR cache for all valid SEO pages by sending sequential
 * GET requests. Run manually after a deploy when cold starts are unacceptable.
 *
 * Usage:
 *   npm run warm:seo                          # production (accessible-places.org)
 *   BASE_URL=https://my-preview.vercel.app npm run warm:seo
 *
 * Each page is fetched once — Vercel renders and caches it. Subsequent visitors
 * get the cached version for up to 5 days (DE) / 5.5 days (EN).
 */

import { readFileSync } from "fs"
import { join }         from "path"

const BASE_URL   = process.env.BASE_URL ?? "https://accessible-places.org"
const DELAY_MS   = 300   // ms between requests — gentle on Vercel's concurrency limits
const TIMEOUT_MS = 30_000

const validity = JSON.parse(
  readFileSync(join(process.cwd(), "lib/generated/seo-validity.json"), "utf-8"),
) as Record<string, boolean>

const validPaths = Object.entries(validity)
  .filter(([, v]) => v)
  .map(([k]) => k)

// DE + EN for each valid path
const urls = validPaths.flatMap((path) => [
  `${BASE_URL}/${path}`,
  `${BASE_URL}/en/${path}`,
])

console.log(`\n🔥 Warming ${urls.length} SEO pages (${validPaths.length} paths × 2 locales)`)
console.log(`   Target: ${BASE_URL}\n`)

let ok = 0
let failed = 0

for (let i = 0; i < urls.length; i++) {
  const url = urls[i]
  const t0  = Date.now()

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "accessible-places-warmer/1.0" },
    })
    const ms = Date.now() - t0

    if (res.ok) {
      const cached = res.headers.get("x-vercel-cache") ?? "?"
      console.log(`  ✓ [${i + 1}/${urls.length}] ${ms}ms  ${cached.padEnd(7)}  ${url.replace(BASE_URL, "")}`)
      ok++
    } else {
      console.warn(`  ✗ [${i + 1}/${urls.length}] HTTP ${res.status}  ${url.replace(BASE_URL, "")}`)
      failed++
    }
  } catch (err) {
    const ms = Date.now() - t0
    console.warn(`  ✗ [${i + 1}/${urls.length}] ${ms}ms  ERROR  ${url.replace(BASE_URL, "")} — ${err}`)
    failed++
  }

  if (i < urls.length - 1) {
    await new Promise((r) => setTimeout(r, DELAY_MS))
  }
}

console.log(`\n✅ Done — ${ok} warmed, ${failed} failed`)
