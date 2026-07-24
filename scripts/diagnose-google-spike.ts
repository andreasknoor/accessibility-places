/**
 * READ-ONLY diagnostic for the Google Places cost spike.
 *
 * Pulls the app's own per-hour adapter-call telemetry (Upstash Redis,
 * `stats:h:calls:<source>:YYYY-MM-DDTHH`) and the anonymous top-users ranking
 * (`users:by_searches`) and prints:
 *   1. An hour-by-hour table of adapter CALLS for the last N hours, per source.
 *      NOTE: one `google_places` "call" here = one /api/search run that had
 *      Google enabled. Each such run fans out to UP TO 9 real Google HTTP
 *      requests (3 categories × 3 Text Search pages) — usually 1–3 for a
 *      single-category deep-link. So real Google request count ≈ calls × (1..9).
 *   2. A rough cost estimate at the Enterprise Text Search SKU (~$0.035/req,
 *      because the field mask requests `accessibilityOptions`).
 *   3. The top anonymous users by lifetime search count, flagging any whose
 *      last-seen day falls in the incident window (UI-driven abuse shows here;
 *      headless/direct-to-API abuse does NOT — it has no valid uid — which is
 *      itself a useful signal: google calls >> top user's searches ⇒ headless).
 *
 * Writes nothing. Run:  npx tsx scripts/diagnose-google-spike.ts [hours]
 */
import { existsSync, readFileSync } from "fs"
import { join } from "path"

// ── Load .env.local (same pattern as scripts/check-seo-validity.ts) ──────────
const envPath = join(process.cwd(), ".env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
    if (key && !(key in process.env)) process.env[key] = val
  }
}

const HOURS = Math.max(1, Math.min(24 * 14, Number(process.argv[2]) || 48))

// Sources worth comparing. If google_places spiked but osm_public did NOT rise
// proportionally, the traffic specifically targeted Google-enabled searches
// (deep-links / international mode / direct API), not general search volume.
const SOURCES = [
  "google_places",
  "osm_public",
  "osm_private",
  "accessibility_cloud",
  "ginto",
  "nominatim",
] as const

// Enterprise Text Search SKU ≈ $35 / 1000 requests (accessibilityOptions field).
const USD_PER_REQUEST = 0.035

function hourKey(d: Date): string {
  return d.toISOString().slice(0, 13) // YYYY-MM-DDTHH
}

async function main() {
  const { Redis } = await import("@upstash/redis")
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    console.error("✗ KV_REST_API_URL / KV_REST_API_TOKEN not set (check .env.local). Cannot read telemetry.")
    process.exit(1)
  }
  const redis = new Redis({
    url:   process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  })

  // Build the last HOURS hour-keys, newest first.
  const now = new Date()
  const hours: string[] = []
  for (let i = 0; i < HOURS; i++) {
    hours.push(hourKey(new Date(now.getTime() - i * 3600_000)))
  }

  // Fetch calls + errors per source per hour via mget (one round-trip per source).
  const table: Record<string, Record<string, number>> = {}
  const errTable: Record<string, Record<string, number>> = {}
  for (const src of SOURCES) {
    const callKeys = hours.map((h) => `stats:h:calls:${src}:${h}`)
    const errKeys  = hours.map((h) => `stats:h:errors:${src}:${h}`)
    const calls = await redis.mget<(number | null)[]>(...callKeys)
    const errs  = await redis.mget<(number | null)[]>(...errKeys)
    table[src] = {}
    errTable[src] = {}
    hours.forEach((h, i) => {
      table[src][h] = Number(calls[i]) || 0
      errTable[src][h] = Number(errs[i]) || 0
    })
  }

  // ── 1. Hour-by-hour table ──────────────────────────────────────────────────
  console.log(`\n=== Adapter CALLS per hour (last ${HOURS}h, UTC, newest first) ===`)
  console.log("One google_places call = one search with Google enabled (fans out to up to 9 Google HTTP requests).\n")
  const pad = (s: string, n: number) => s.padStart(n)
  const header = ["hour (UTC)   ", ...SOURCES.map((s) => pad(s.slice(0, 12), 13))].join(" ")
  console.log(header)
  console.log("-".repeat(header.length))
  const totals: Record<string, number> = Object.fromEntries(SOURCES.map((s) => [s, 0]))
  for (const h of hours) {
    const row = [
      h.replace("T", " ") + ":00",
      ...SOURCES.map((s) => {
        const v = table[s][h]
        totals[s] += v
        // Flag notable google_places activity.
        const cell = pad(String(v), 13)
        return s === "google_places" && v > 0 ? `\x1b[33m${cell}\x1b[0m` : cell
      }),
    ].join(" ")
    // Only print hours with any google activity OR any activity at all, but keep
    // it readable: print every hour (window is bounded).
    console.log(row)
  }
  console.log("-".repeat(header.length))
  console.log(["TOTAL        ", ...SOURCES.map((s) => pad(String(totals[s]), 13))].join(" "))

  // ── 2. Cost estimate ───────────────────────────────────────────────────────
  const gpCalls = totals.google_places
  const gpErrs  = Object.values(errTable.google_places).reduce((a, b) => a + b, 0)
  console.log(`\n=== Google Places cost estimate (last ${HOURS}h) ===`)
  console.log(`Searches with Google enabled : ${gpCalls}   (of which errored: ${gpErrs})`)
  console.log(`Google HTTP requests, low  (×1 page, 1 cat) : ${gpCalls} req  ≈ $${(gpCalls * 1 * USD_PER_REQUEST).toFixed(2)}`)
  console.log(`Google HTTP requests, mid  (×3)             : ${gpCalls * 3} req  ≈ $${(gpCalls * 3 * USD_PER_REQUEST).toFixed(2)}`)
  console.log(`Google HTTP requests, high (×9, 3 cat×3 pg) : ${gpCalls * 9} req  ≈ $${(gpCalls * 9 * USD_PER_REQUEST).toFixed(2)}`)
  console.log(`(SKU assumed: Text Search Enterprise ~$${USD_PER_REQUEST}/req — the field mask requests accessibilityOptions.)`)
  console.log(`NOTE: Place Photo API (/api/image/google) bills SEPARATELY and is NOT in this counter.`)

  // ── 3. Top anonymous users (UI traffic only) ───────────────────────────────
  const today = now.toISOString().slice(0, 10)
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)
  console.log(`\n=== Top anonymous users by lifetime searches (UI traffic only) ===`)
  console.log(`Incident window days flagged: ${yesterday} / ${today}\n`)
  const raw = await redis.zrange<(string | number)[]>("users:by_searches", 0, 39, { rev: true, withScores: true })
  if (raw.length === 0) {
    console.log("(no user-search telemetry — either usageStats off for all, or traffic was headless/direct-to-API)")
  } else {
    const rows: { uid: string; searches: number }[] = []
    for (let i = 0; i + 1 < raw.length; i += 2) rows.push({ uid: String(raw[i]), searches: Number(raw[i + 1]) || 0 })
    const hashes = await Promise.all(rows.map((r) => redis.hgetall<Record<string, string>>(`user:${r.uid}`)))
    console.log("searches  lastSeen    firstSeen   platform  uid")
    rows.forEach((r, i) => {
      const h = hashes[i] ?? {}
      const flag = (h.lastSeen === today || h.lastSeen === yesterday) ? " \x1b[31m← in window\x1b[0m" : ""
      console.log(
        `${String(r.searches).padStart(7)}  ${(h.lastSeen ?? "?").padEnd(11)} ${(h.firstSeen ?? "?").padEnd(11)} ${(h.platform ?? "?").padEnd(8)} ${r.uid}${flag}`,
      )
    })
    console.log(
      `\nIf the top user's searches is FAR below the google_places call total above,\n` +
      `the spike was headless / direct-to-/api/search (no valid uid) — not the app UI.`,
    )
  }

  console.log("\nDone. (read-only — nothing was modified)\n")
}

main().catch((e) => { console.error(e); process.exit(1) })
