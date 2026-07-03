// @vitest-environment node
/**
 * Free-text search matrix — LIVE end-to-end against real services (Nominatim
 * geocoding + Overpass), no mocking. Ebene 2 of the free-text test plan; the
 * pure query-construction layer (Ebene 1) lives in __tests__/lib/llm.test.ts.
 *
 * Permutes category terms (real hint / typo / none) × locations (existing /
 * non-existing / ambiguous / containing "in" / doubling as a category word)
 * × query forms ("<kat> in <ort>", "in <ort>", raw, "<kat> <ort>") and
 * asserts the classified reaction of POST /api/search:
 *
 *   ok        — no fatal; geocoded centre inside the expected bounding box
 *   not_found — fatal with code "location_not_found" (never a generic error)
 *   quirk     — documented current behaviour that deviates from the ideal;
 *               asserted as-is so a behaviour CHANGE surfaces as a test diff
 *
 * Runs sequentially with ≥1.2 s pacing (Nominatim fair-use, 1 req/s) — the
 * suite takes several minutes, so it only runs when explicitly requested
 * (same pattern as TEST_LLM_QUALITY in name-search.test.ts):
 *
 *   FREETEXT_MATRIX=1 npx vitest run __tests__/integration/freetext-matrix.test.ts
 *
 * Without the flag (normal `npm test` / pre-commit) the suite is skipped.
 */

import { readFileSync } from "fs"
import { resolve }      from "path"
import { describe, it, expect, beforeAll } from "vitest"
import { NextRequest } from "next/server"

// Load .env.local BEFORE importing the route (lib/config reads
// OVERPASS_ENDPOINTS at module load) — same pattern as name-search.test.ts.
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8")
    for (const line of raw.split("\n")) {
      const t = line.trim()
      if (!t || t.startsWith("#")) continue
      const eq = t.indexOf("=")
      if (eq < 0) continue
      const k = t.slice(0, eq).trim()
      const v = t.slice(eq + 1).trim()
      if (k && !(k in process.env)) process.env[k] = v
    }
  } catch { /* env set in shell */ }
}

type Fired = { fatalCode?: string; fatalError?: string; count: number; center?: { lat: number; lon: number }; label?: string }

let post: ((req: NextRequest) => Promise<Response>) | undefined
let online = false

beforeAll(async () => {
  loadEnv()
  const route = await import("@/app/api/search/route")
  post = route.POST
  try {
    const res = await fetch("https://nominatim.openstreetmap.org/status", { signal: AbortSignal.timeout(5_000) })
    online = res.ok
  } catch { online = false }
}, 20_000)

let caseNo = 0
async function run(query: string): Promise<Fired> {
  // Nominatim fair-use: strictly sequential, ≥1.2 s between requests.
  await new Promise((r) => setTimeout(r, 1_200))
  const req = new NextRequest("http://localhost/api/search", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `matrix-${caseNo++}` },
    body: JSON.stringify({
      userQuery: query,
      radiusKm:  3,
      filters:   { acceptUnknown: true },
      sources:   { osm: true, accessibility_cloud: false, reisen_fuer_alle: false, ginto: false, acceslibre: false, google_places: false },
      locale:    "de",
    }),
  })
  const res  = await post!(req)
  const text = await res.text()
  const events = text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  const fatal  = events.find((e) => e.type === "fatal")
  const result = events.find((e) => e.type === "result")
  return {
    fatalCode:  fatal?.code,
    fatalError: fatal?.error,
    count:      result?.payload?.places?.length ?? 0,
    center:     result?.payload?.location ? { lat: result.payload.location.lat, lon: result.payload.location.lon } : undefined,
    label:      result?.payload?.location?.label,
  }
}

// ─── Expected-location bounding boxes ────────────────────────────────────────

const BBOX = {
  frankenthal: { minLat: 49.45, maxLat: 49.62, minLon: 8.28,  maxLon: 8.45 },
  berlinMitte: { minLat: 52.47, maxLat: 52.58, minLon: 13.30, maxLon: 13.47 },
  weiden:      { minLat: 49.55, maxLat: 49.78, minLon: 12.05, maxLon: 12.30 },
  essen:       { minLat: 51.34, maxLat: 51.54, minLon: 6.89,  maxLon: 7.14 },
  dach:        { minLat: 45.82, maxLat: 55.06, minLon: 5.87,  maxLon: 17.17 },
  // The two Neustadts the PLZ cases must tell apart:
  neustadtWstr: { minLat: 49.28, maxLat: 49.42, minLon: 8.05,  maxLon: 8.25 },  // a.d. Weinstraße (67433)
  neustadtSachs:{ minLat: 50.95, maxLat: 51.10, minLon: 14.10, maxLon: 14.32 }, // in Sachsen (01844)
  zuerich:      { minLat: 47.32, maxLat: 47.44, minLon: 8.45,  maxLon: 8.63 },  // CH, 4-stellige PLZ
  salzburg:     { minLat: 47.75, maxLat: 47.87, minLon: 12.98, maxLon: 13.13 }, // AT, 4-stellige PLZ
} as const

function expectInBbox(fired: Fired, box: { minLat: number; maxLat: number; minLon: number; maxLon: number }, query: string) {
  expect(fired.fatalCode, `${query} → unexpected fatal: ${fired.fatalError}`).toBeUndefined()
  expect(fired.center, `${query} → no location in result`).toBeDefined()
  const { lat, lon } = fired.center!
  expect(lat, `${query} → geocoded to ${fired.label} (${lat},${lon})`).toBeGreaterThanOrEqual(box.minLat)
  expect(lat, `${query} → geocoded to ${fired.label} (${lat},${lon})`).toBeLessThanOrEqual(box.maxLat)
  expect(lon, `${query} → geocoded to ${fired.label} (${lat},${lon})`).toBeGreaterThanOrEqual(box.minLon)
  expect(lon, `${query} → geocoded to ${fired.label} (${lat},${lon})`).toBeLessThanOrEqual(box.maxLon)
}

function expectNotFound(fired: Fired, query: string) {
  expect(fired.fatalCode, `${query} → expected location_not_found, got ${fired.fatalCode ?? `ok (${fired.label})`}`).toBe("location_not_found")
}

// ─── Matrix ──────────────────────────────────────────────────────────────────

interface Case { query: string; expect: (f: Fired) => void; note?: string }

const T = 40_000 // per-case timeout: Nominatim + Overpass + enrichment

describe.skipIf(process.env.FREETEXT_MATRIX !== "1")("free-text matrix (LIVE)", () => {
  // Guard inside tests (skipIf can't await the online probe).
  function requireOnline() {
    if (!online) {
      console.warn("[freetext-matrix] offline — skipping")
      return false
    }
    return true
  }

  const cases: Case[] = [
    // ── Frankenthal (existiert, eindeutig genug) ─────────────────────────────
    { query: "Restaurants in Frankenthal", expect: (f) => expectInBbox(f, BBOX.frankenthal, "Restaurants in Frankenthal") },
    { query: "Arzt in Frankenthal",        expect: (f) => expectInBbox(f, BBOX.frankenthal, "Arzt in Frankenthal") },
    { query: "Artz in Frankenthal",        expect: (f) => expectInBbox(f, BBOX.frankenthal, "Artz in Frankenthal"), note: "Tippfehler-Kategorie → All-Categories statt Fehler" },
    { query: "in Frankenthal",             expect: (f) => expectInBbox(f, BBOX.frankenthal, "in Frankenthal") },
    { query: "Frankenthal",                expect: (f) => expectInBbox(f, BBOX.frankenthal, "Frankenthal") },
    {
      query: "Arzt Frankenthal",
      // Matrix finding 2026-07-03, fixed in v9.33: category words are now
      // stripped from the no-'in' location fallback, so this geocodes
      // "Frankenthal" and searches doctors there.
      expect: (f) => expectInBbox(f, BBOX.frankenthal, "Arzt Frankenthal"),
      note: "ohne 'in' — Kategorienwort wird aus der Ortssuche gestrippt",
    },

    // ── Berlin Mitte (existiert, Stadtteil) ──────────────────────────────────
    { query: "Restaurants in Berlin Mitte", expect: (f) => expectInBbox(f, BBOX.berlinMitte, "Restaurants in Berlin Mitte") },
    { query: "Arzt in Berlin Mitte",        expect: (f) => expectInBbox(f, BBOX.berlinMitte, "Arzt in Berlin Mitte") },
    { query: "Artz in Berlin Mitte",        expect: (f) => expectInBbox(f, BBOX.berlinMitte, "Artz in Berlin Mitte") },
    { query: "in Berlin Mitte",             expect: (f) => expectInBbox(f, BBOX.berlinMitte, "in Berlin Mitte") },
    { query: "Berlin Mitte",                expect: (f) => expectInBbox(f, BBOX.berlinMitte, "Berlin Mitte") },

    // ── Qwxyzhausen (existiert nicht) ────────────────────────────────────────
    { query: "Restaurants in Qwxyzhausen", expect: (f) => expectNotFound(f, "Restaurants in Qwxyzhausen") },
    { query: "Arzt in Qwxyzhausen",        expect: (f) => expectNotFound(f, "Arzt in Qwxyzhausen") },
    { query: "Artz in Qwxyzhausen",        expect: (f) => expectNotFound(f, "Artz in Qwxyzhausen") },
    { query: "in Qwxyzhausen",             expect: (f) => expectNotFound(f, "in Qwxyzhausen") },
    { query: "Qwxyzhausen",                expect: (f) => expectNotFound(f, "Qwxyzhausen") },
    { query: "Arzt Qwxyzhausen",           expect: (f) => expectNotFound(f, "Arzt Qwxyzhausen") },

    // ── Neustadt (mehrfach existent — deterministisch irgendein DACH-Neustadt) ─
    { query: "Restaurants in Neustadt", expect: (f) => expectInBbox(f, BBOX.dach, "Restaurants in Neustadt"), note: "mehrdeutig — limit=1 wählt nach Importance" },
    { query: "Arzt in Neustadt",        expect: (f) => expectInBbox(f, BBOX.dach, "Arzt in Neustadt") },
    { query: "in Neustadt",             expect: (f) => expectInBbox(f, BBOX.dach, "in Neustadt") },
    { query: "Neustadt",                expect: (f) => expectInBbox(f, BBOX.dach, "Neustadt") },

    // ── Weiden in der Oberpfalz (Ort mit "in" im Namen) ──────────────────────
    { query: "Arzt in Weiden in der Oberpfalz", expect: (f) => expectInBbox(f, BBOX.weiden, "Arzt in Weiden in der Oberpfalz") },
    { query: "in Weiden in der Oberpfalz",      expect: (f) => expectInBbox(f, BBOX.weiden, "in Weiden in der Oberpfalz") },
    {
      query: "Weiden in der Oberpfalz",
      // KNOWN QUIRK (see llm.test.ts): the raw form geocodes "der Oberpfalz".
      // Nominatim resolves that to the Oberpfalz region — wrong centre for the
      // town but not an error. Asserted as-is; a change surfaces here.
      expect: (f) => {
        expect(f.fatalCode, "Weiden raw → unexpected fatal").toBeUndefined()
        expect(f.center).toBeDefined()
      },
      note: "QUIRK: Ortsname mit 'in' verliert die Stadt (geocodiert 'der Oberpfalz')",
    },

    // ── Essen (Stadt = Kategorienwort) ───────────────────────────────────────
    { query: "in Essen", expect: (f) => expectInBbox(f, BBOX.essen, "in Essen") },
    {
      query: "Essen",
      // Raw form triggers the restaurant hint (documented; the UI avoids this
      // by sending "in <ort>" for known-pure locations) — but the LOCATION
      // must still resolve to the city.
      expect: (f) => expectInBbox(f, BBOX.essen, "Essen"),
      note: "QUIRK: Kategorie wird restaurant (Hint 'essen'), Ort bleibt korrekt",
    },

    // ── PLZ-Disambiguierung (Doppelnamen per Postleitzahl aufloesen) ─────────
    { query: "67433 Neustadt",                expect: (f) => expectInBbox(f, BBOX.neustadtWstr,  "67433 Neustadt"),  note: "PLZ waehlt Neustadt a.d. Weinstrasse" },
    { query: "in 67433 Neustadt",             expect: (f) => expectInBbox(f, BBOX.neustadtWstr,  "in 67433 Neustadt") },
    { query: "Restaurants in 67433 Neustadt", expect: (f) => expectInBbox(f, BBOX.neustadtWstr,  "Restaurants in 67433 Neustadt") },
    { query: "01844 Neustadt",                expect: (f) => expectInBbox(f, BBOX.neustadtSachs, "01844 Neustadt"),  note: "PLZ waehlt Neustadt in Sachsen — Disambiguierungs-Beweis" },
    { query: "Arzt 67433 Neustadt",           expect: (f) => expectInBbox(f, BBOX.neustadtWstr,  "Arzt 67433 Neustadt"), note: "Kategorie + PLZ ohne 'in'" },
    // 4-stellige PLZ (AT/CH) — das \d{4,5}-Token-Muster deckt beide Formate ab.
    { query: "8004 Zürich",                   expect: (f) => expectInBbox(f, BBOX.zuerich,  "8004 Zürich"),        note: "CH, 4-stellige PLZ" },
    { query: "Arzt in 5020 Salzburg",         expect: (f) => expectInBbox(f, BBOX.salzburg, "Arzt in 5020 Salzburg"), note: "AT, 4-stellige PLZ mit Kategorie" },

    // ── Regressionsformen aus dem Frankenthal-Bug ────────────────────────────
    {
      query: "Arztpraxen in Artz in Frankenthal",
      // Pre-v9.30 buildQuery nesting: the whole tail becomes the location and
      // cannot geocode. The route must fail with the SPECIFIC not-found code
      // (not a generic error) — the client no longer produces this shape.
      expect: (f) => expectNotFound(f, "Arztpraxen in Artz in Frankenthal"),
      note: "Regressionsform (verschachteltes 'in') → sauberes location_not_found",
    },
    {
      query: "in Artz in Frankenthal",
      expect: (f) => expectNotFound(f, "in Artz in Frankenthal"),
      note: "Poisoned-Restore-Form → sauberes location_not_found",
    },
  ]

  for (const c of cases) {
    it(`${c.query}${c.note ? `  [${c.note}]` : ""}`, async () => {
      if (!requireOnline()) return
      const fired = await run(c.query)
      c.expect(fired)
    }, T)
  }
})
