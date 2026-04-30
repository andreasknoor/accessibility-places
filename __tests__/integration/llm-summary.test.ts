// @vitest-environment node
/**
 * Integration tests: verify that the summary prompt produces a factual summary
 * WITHOUT using the "no questions" guard instruction.
 *
 * Two suites:
 *  1. Static test data  — fast, deterministic place list
 *  2. Full E2E pipeline — real query → geocode → fetch → merge → summary
 *
 * If the LLM responds with clarifying questions the test fails and logs a
 * detailed analysis: which patterns triggered, the full response, and the
 * prompt — so the root cause (bad prompt or bad data) can be diagnosed.
 */

import { readFileSync } from "fs"
import { resolve }      from "path"
import { describe, it, expect, beforeAll } from "vitest"

beforeAll(() => {
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
  } catch { /* env already set in shell */ }
})

import Anthropic              from "@anthropic-ai/sdk"
import { buildSummaryPrompt, parseQuery } from "@/lib/llm"
import { fetchAllSources }    from "@/lib/adapters"
import { findMatch }          from "@/lib/matching/match"
import { mergePlaces, passesFilters, buildAttribute, emptyAttribute } from "@/lib/matching/merge"
import { NOMINATIM_ENDPOINT } from "@/lib/config"
import type { Place, SearchParams } from "@/lib/types"

// ─── Question-pattern detector ────────────────────────────────────────────────

const QUESTION_PATTERNS: Array<{ label: string; test: (t: string) => boolean }> = [
  { label: "Fragezeichen",                test: (t) => t.includes("?") },
  { label: "Bitte-Aufforderung (DE)",     test: (t) => /bitte\s+(teile|gib|nenn|schick|füg)/i.test(t) },
  { label: "Könnten/Können Sie (DE)",     test: (t) => /könnten?\s+sie|können\s+sie/i.test(t) },
  { label: "Welche/Was sind (DE)",        test: (t) => /\b(welche|welcher|welches)\b|\bwas\s+sind\b/i.test(t) },
  { label: "Fehlende Informationen (DE)", test: (t) => /fehlen|nicht\s+(?:vor|genug)|keine\s+(?:details|info)/i.test(t) },
  { label: "Please share/provide (EN)",   test: (t) => /please\s+(share|provide|give|tell|send)/i.test(t) },
  { label: "Could/Can you (EN)",          test: (t) => /could\s+you|can\s+you/i.test(t) },
  { label: "What are / Which (EN)",       test: (t) => /what\s+are\s+the|which\s+places/i.test(t) },
  { label: "Missing information (EN)",    test: (t) => /missing|lack\s+(?:the\s+)?(?:details|info)/i.test(t) },
]

function detectQuestions(text: string): string[] {
  const lower = text.toLowerCase()
  return QUESTION_PATTERNS.filter((p) => p.test(lower)).map((p) => p.label)
}

function assertNoQuestions(response: string, prompt: string, context: string) {
  const triggered = detectQuestions(response)
  if (triggered.length > 0) {
    console.error(`\n─── Rückfragen erkannt (${context}) ────────────────────────────────`)
    console.error("LLM-Antwort:\n", response)
    console.error("\nAusgelöste Muster:")
    triggered.forEach((l) => console.error(`  ✗ ${l}`))
    console.error("\nVerwendeter Prompt:\n", prompt)
    console.error(
      "\nAnalyse: Das Prompt liefert dem LLM nicht genug Kontext oder ist zu offen\n" +
      "formuliert. Prüfe ob Ortsnamen, Kategorien und Bewertungen ausreichend\n" +
      "konkret sind, damit das Modell direkt zusammenfassen kann.",
    )
    console.error("──────────────────────────────────────────────────────────────────\n")
  }
  expect(
    triggered,
    `LLM stellte Rückfragen (Muster: ${triggered.join(", ")})\nAntwort: "${response}"`,
  ).toHaveLength(0)
  expect(response.length).toBeGreaterThan(20)
}

// ─── Helper: call LLM with prompt (no guard) ─────────────────────────────────

async function callLlm(prompt: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 350,
    messages:   [{ role: "user", content: prompt }],
  })
  return msg.content[0].type === "text" ? msg.content[0].text.trim() : ""
}

// ─── Helper: geocode via Nominatim (mirrors app/api/search/route.ts) ─────────

async function geocode(q: string) {
  const url = `${NOMINATIM_ENDPOINT}/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=de,at,ch`
  const res = await fetch(url, {
    headers: { "User-Agent": "AccessibleSpaces/1.0 test" },
    signal:  AbortSignal.timeout(8_000),
  })
  if (!res.ok) return null
  const data = await res.json()
  if (!data[0]) return null
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) }
}

// ─── Suite 1: static test data ────────────────────────────────────────────────

function makeFakePlace(name: string, city: string, confidence: number): Place {
  return {
    id: name,
    name,
    category: "restaurant",
    address:  { street: "Unter den Linden", houseNumber: "1", postalCode: "10117", city, country: "DE" },
    coordinates: { lat: 52.517, lon: 13.388 },
    accessibility: {
      entrance: buildAttribute("osm", "yes",     "yes",     {}),
      toilet:   buildAttribute("osm", "limited", "limited", {}),
      parking:  emptyAttribute(),
    },
    overallConfidence: confidence,
    primarySource:     "osm",
    sourceRecords: [{ sourceId: "osm", externalId: "1", fetchedAt: "", raw: {} }],
  }
}

const STATIC_PLACES: Place[] = [
  makeFakePlace("Restaurant Zur alten Mitte",  "Berlin", 0.82),
  makeFakePlace("Café am Gendarmenmarkt",      "Berlin", 0.75),
  makeFakePlace("Bistro Spreeblick",           "Berlin", 0.61),
  makeFakePlace("Wirtshaus Nikolaiviertel",    "Berlin", 0.78),
  makeFakePlace("Ristorante Bella Berlin",     "Berlin", 0.55),
  makeFakePlace("Thai Garden Mitte",           "Berlin", 0.40),
]

describe("Summary-Prompt mit statischen Testdaten (kein Guard)", () => {
  it("liefert Zusammenfassung ohne Rückfragen", { timeout: 20_000 }, async () => {
    if (!process.env.ANTHROPIC_API_KEY?.startsWith("sk-")) {
      console.log("[skip] ANTHROPIC_API_KEY not configured"); return
    }
    const prompt   = buildSummaryPrompt(STATIC_PLACES, "de")
    const response = await callLlm(prompt)
    assertNoQuestions(response, prompt, "statische Daten")
  })
})

// ─── Suite 2: vollständiger E2E-Flow ─────────────────────────────────────────

const E2E_QUERY = "Rollstuhlgerechte Restaurants in Berlin Mitte"

describe(`Summary-Prompt mit echten Suchergebnissen (kein Guard) — Query: "${E2E_QUERY}"`, () => {
  it("liefert Zusammenfassung ohne Rückfragen nach echtem Such-Flow", { timeout: 90_000 }, async () => {
    if (!process.env.ANTHROPIC_API_KEY?.startsWith("sk-")) {
      console.log("[skip] ANTHROPIC_API_KEY not configured"); return
    }

    // 1. LLM parst Query → extrahiert Ort + Kategorien
    const parsed = await parseQuery(E2E_QUERY)
    console.log(`  ↳ parseQuery: locationQuery="${parsed.locationQuery}", categories=${parsed.categories.join(",")}`)

    // 2. Geocoding
    const geo = await geocode(parsed.locationQuery)
    expect(geo, `Geocoding fehlgeschlagen für "${parsed.locationQuery}"`).not.toBeNull()
    console.log(`  ↳ geocode: lat=${geo!.lat}, lon=${geo!.lon}`)

    // 3. Quellen fetchen
    const params: SearchParams = {
      query:      E2E_QUERY,
      location:   geo!,
      radiusKm:   2,
      categories: parsed.categories,
      filters:    { entrance: true, toilet: true, parking: false, seating: false, onlyVerified: false, acceptUnknown: false },
      sources:    { accessibility_cloud: true, osm: true, reisen_fuer_alle: true, google_places: true },
    }
    const adapterResults = await fetchAllSources(params)
    for (const r of adapterResults) {
      console.log(`  ↳ ${r.sourceId}: ${r.places.length} Orte${r.error ? ` (Fehler: ${r.error})` : ""}`)
    }

    // 4. Match + Merge
    const canonical: Place[] = []
    for (const r of adapterResults) {
      for (const incoming of r.places) {
        const idx = findMatch(canonical, incoming)
        if (idx >= 0) canonical[idx] = mergePlaces(canonical[idx], incoming)
        else          canonical.push(incoming)
      }
    }

    // 5. Filter + Sort
    const filtered = canonical
      .filter((p) => passesFilters(p, params.filters))
      .sort((a, b) => b.overallConfidence - a.overallConfidence)
    console.log(`  ↳ nach Merge+Filter: ${filtered.length} Orte`)

    expect(
      filtered.length,
      `Keine Ergebnisse nach Merge+Filter — prüfe Adapter-Logs oben`,
    ).toBeGreaterThan(0)

    // 6. Prompt bauen (OHNE Guard) und LLM aufrufen
    const prompt   = buildSummaryPrompt(filtered, "de")
    const response = await callLlm(prompt)
    console.log(`  ↳ LLM-Antwort: "${response.slice(0, 120)}${response.length > 120 ? "…" : ""}"`)

    assertNoQuestions(response, prompt, `E2E "${E2E_QUERY}"`)
  })
})
