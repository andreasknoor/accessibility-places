// @vitest-environment node
/**
 * End-to-end test for name-based search.
 *
 * Verifies the full pipeline for "et cetera in Potsdam":
 *   1. LLM extracts nameHint from natural-language query
 *   2. OSM returns places near Potsdam
 *   3. filterByNameHint narrows results to the café
 *
 * Requires a live network connection (Overpass + Nominatim + Anthropic).
 * The test is skipped automatically when ANTHROPIC_API_KEY is absent.
 */

import { readFileSync } from "fs"
import { resolve }      from "path"
import { describe, it, expect, beforeAll } from "vitest"

beforeAll(() => {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8")
    for (const line of raw.split("\n")) {
      const t  = line.trim()
      if (!t || t.startsWith("#")) continue
      const eq = t.indexOf("=")
      if (eq < 0) continue
      const k  = t.slice(0, eq).trim()
      const v  = t.slice(eq + 1).trim()
      if (k && !(k in process.env)) process.env[k] = v
    }
  } catch { /* env set in shell */ }
})

import { parseQuery }      from "@/lib/llm"
import { fetchOsm }        from "@/lib/adapters/osm"
import { filterByNameHint } from "@/lib/matching/match"
import { NOMINATIM_ENDPOINT } from "@/lib/config"
import type { SearchParams } from "@/lib/types"

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function geocode(q: string): Promise<{ lat: number; lon: number } | null> {
  const url = `${NOMINATIM_ENDPOINT}/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=de,at,ch`
  const res  = await fetch(url, {
    headers: { "User-Agent": "AccessibleSpaces/1.0 test" },
    signal:  AbortSignal.timeout(8_000),
  })
  if (!res.ok) return null
  const data = await res.json()
  if (!data[0]) return null
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) }
}

// ─── Suite 1: LLM query parsing ───────────────────────────────────────────────

describe("parseQuery – Namensextraktion", () => {
  it('extrahiert nameHint "et cetera" aus "et cetera in Potsdam"', { timeout: 20_000 }, async () => {
    if (!process.env.ANTHROPIC_API_KEY?.startsWith("sk-")) {
      console.log("[skip] ANTHROPIC_API_KEY not configured"); return
    }

    const parsed = await parseQuery("et cetera in Potsdam")
    console.log("  ↳ parseQuery:", JSON.stringify(parsed))

    expect(parsed.locationQuery.toLowerCase()).toContain("potsdam")
    expect(parsed.nameHint.toLowerCase()).toContain("et cetera")
    expect(parsed.categories.length).toBeGreaterThan(0)
  })

  it('extrahiert nameHint aus eindeutigem Namen "Brauhaus Georgbräu Berlin"', { timeout: 20_000 }, async () => {
    if (!process.env.ANTHROPIC_API_KEY?.startsWith("sk-")) {
      console.log("[skip] ANTHROPIC_API_KEY not configured"); return
    }

    const parsed = await parseQuery("Brauhaus Georgbräu Berlin")
    console.log("  ↳ parseQuery:", JSON.stringify(parsed))

    expect(parsed.locationQuery.toLowerCase()).toContain("berlin")
    expect(parsed.nameHint.toLowerCase()).toContain("georg")
  })

  it('setzt leeren nameHint für Kategoriensuche "Cafés in Berlin Mitte"', { timeout: 20_000 }, async () => {
    if (!process.env.ANTHROPIC_API_KEY?.startsWith("sk-")) {
      console.log("[skip] ANTHROPIC_API_KEY not configured"); return
    }

    const parsed = await parseQuery("Rollstuhlgerechte Cafés in Berlin Mitte")
    console.log("  ↳ parseQuery:", JSON.stringify(parsed))

    expect(parsed.locationQuery.toLowerCase()).toContain("berlin")
    expect(parsed.nameHint).toBe("")
    expect(parsed.categories).toContain("cafe")
  })
})

// ─── Suite 2: filterByNameHint (unit) ─────────────────────────────────────────

describe("filterByNameHint – Name-Filter-Logik", () => {
  const makeName = (name: string) => ({
    id: name, name, category: "cafe" as const,
    address: { street: "", houseNumber: "", postalCode: "", city: "Potsdam", country: "DE" as const },
    coordinates: { lat: 52.4, lon: 13.06 },
    accessibility: { entrance: { value: "unknown" as const, confidence: 0, conflict: false, sources: [], details: {} }, toilet: { value: "unknown" as const, confidence: 0, conflict: false, sources: [], details: {} }, parking: { value: "unknown" as const, confidence: 0, conflict: false, sources: [], details: {} } },
    overallConfidence: 0, primarySource: "osm" as const, sourceRecords: [],
  })

  const places = [
    makeName("Café et cetera"),
    makeName("et cetera"),
    makeName("Bäckerei Schmidt"),
    makeName("Restaurant Zur Eiche"),
    makeName("Et-Cetera Bistro"),
  ]

  it("findet exakten Treffer (Substring)", () => {
    const result = filterByNameHint(places, "et cetera")
    const names  = result.map((p) => p.name)
    expect(names).toContain("Café et cetera")
    expect(names).toContain("et cetera")
    expect(names).not.toContain("Bäckerei Schmidt")
  })

  it("findet Treffer mit Diakritika-Normalisierung (Café → cafe)", () => {
    const result = filterByNameHint(places, "Café et cetera")
    expect(result.map((p) => p.name)).toContain("Café et cetera")
  })

  it("gibt alle Orte zurück wenn nameHint leer", () => {
    expect(filterByNameHint(places, "")).toHaveLength(places.length)
  })

  it("liefert leere Liste wenn kein Treffer", () => {
    expect(filterByNameHint(places, "Wirtshaus Zum Goldenen Hirsch")).toHaveLength(0)
  })

  it("findet per Trigram-Ähnlichkeit (Tippfehler: 'georgbrau' findet 'Brauhaus Georgbräu')", () => {
    const p2 = [makeName("Brauhaus Georgbräu"), makeName("Café Müller")]
    const result = filterByNameHint(p2, "georgbrau")
    expect(result.map((r) => r.name)).toContain("Brauhaus Georgbräu")
  })
})

// ─── Suite 3: vollständiger E2E-Flow ─────────────────────────────────────────

describe('Namenssuche E2E – "et cetera in Potsdam"', () => {
  it("findet das Café et cetera via OSM + Name-Filter", { timeout: 60_000 }, async () => {
    if (!process.env.ANTHROPIC_API_KEY?.startsWith("sk-")) {
      console.log("[skip] ANTHROPIC_API_KEY not configured"); return
    }

    // 1. LLM parst Query
    const parsed = await parseQuery("et cetera in Potsdam")
    console.log("  ↳ parseQuery:", JSON.stringify(parsed))

    expect(parsed.nameHint.toLowerCase(), "LLM muss 'et cetera' als nameHint erkennen")
      .toContain("et cetera")
    expect(parsed.locationQuery.toLowerCase()).toContain("potsdam")

    // 2. Geocoding
    const geo = await geocode(parsed.locationQuery)
    expect(geo, `Geocoding fehlgeschlagen für "${parsed.locationQuery}"`).not.toBeNull()
    console.log(`  ↳ geocode: lat=${geo!.lat}, lon=${geo!.lon}`)

    // 3. OSM-Fetch (alle Kategorien, da Name-Suche keiner Kategorie bedarf)
    const params: SearchParams = {
      query:      "et cetera in Potsdam",
      location:   geo!,
      radiusKm:   5,
      categories: parsed.categories,
      filters:    { entrance: false, toilet: false, parking: false, seating: false, acceptUnknown: true },
      sources:    { accessibility_cloud: false, osm: true, reisen_fuer_alle: false, google_places: false },
    }
    const places = await fetchOsm(params)
    console.log(`  ↳ OSM: ${places.length} Orte gesamt`)
    expect(places.length, "OSM muss Orte in Potsdam liefern").toBeGreaterThan(0)

    // 4. Name-Filter
    const filtered = filterByNameHint(places, parsed.nameHint)
    console.log(`  ↳ nach Name-Filter ("${parsed.nameHint}"): ${filtered.length} Treffer`)
    console.log("  ↳ Treffer:", filtered.map((p) => `"${p.name}"`).join(", ") || "(keine)")

    expect(
      filtered.length,
      `Kein Ort mit Name "${parsed.nameHint}" in OSM-Ergebnissen gefunden.\n` +
      `Alle Orte: ${places.slice(0, 10).map((p) => p.name).join(", ")}`,
    ).toBeGreaterThan(0)

    const match = filtered[0]
    expect(match.address.city?.toLowerCase() ?? match.address.postalCode).toMatch(/potsdam|14/i)
    console.log(`  ✓ Gefunden: "${match.name}", ${match.address.street} ${match.address.houseNumber}, ${match.address.city}`)
  })
})
