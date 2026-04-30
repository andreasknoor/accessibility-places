// @vitest-environment node
/**
 * Headless end-to-end integration tests.
 * Each test hits a live data source with a real HTTP request.
 * Sources without a configured API key are skipped automatically.
 *
 * Query: "Rollstuhlgerechte Restaurants in Berlin Mitte"
 * Coords: Alexanderplatz area, 2 km radius.
 */

import { readFileSync } from "fs"
import { resolve } from "path"
import { describe, it, expect, beforeAll } from "vitest"

// Load .env.local before importing adapters so process.env is populated
beforeAll(() => {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8")
    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eqIdx = trimmed.indexOf("=")
      if (eqIdx < 0) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      if (key && !(key in process.env)) process.env[key] = val
    }
  } catch {
    // .env.local not found — keys must be set in the shell environment
  }
})

import { fetchOsm } from "@/lib/adapters/osm"
import { fetchAccessibilityCloud } from "@/lib/adapters/accessibility-cloud"
import { fetchGooglePlaces } from "@/lib/adapters/google-places"
import { fetchReisenFuerAlle } from "@/lib/adapters/reisen-fuer-alle"
import type { SearchParams } from "@/lib/types"

// ─── Shared search params ──────────────────────────────────────────────────────

const PARAMS: SearchParams = {
  query:    "Rollstuhlgerechte Restaurants in Berlin Mitte",
  location: { lat: 52.5200, lon: 13.4050 },
  radiusKm: 2,
  categories: ["restaurant"],
  filters: { entrance: true, toilet: true, parking: true, seating: false, onlyVerified: false, acceptUnknown: true },
  sources:  { accessibility_cloud: true, osm: true, reisen_fuer_alle: true, google_places: true },
}

function isPlaceholder(val: string | undefined): boolean {
  return !val || val.startsWith("your_")
}

// ─── OSM (no API key required) ─────────────────────────────────────────────────

describe("OSM adapter – live search", () => {
  it("returns restaurants in Berlin Mitte", { timeout: 35_000 }, async () => {
    const places = await fetchOsm(PARAMS)
    expect(places.length).toBeGreaterThan(0)
    for (const p of places.slice(0, 3)) {
      expect(p.name).toBeTruthy()
      expect(p.primarySource).toBe("osm")
      expect(p.coordinates.lat).toBeGreaterThan(51)
      expect(p.coordinates.lat).toBeLessThan(54)
    }
  })
})

// ─── accessibility.cloud ───────────────────────────────────────────────────────

describe("accessibility.cloud adapter – live search", () => {
  it("returns places in Berlin Mitte", { timeout: 25_000 }, async () => {
    if (isPlaceholder(process.env.ACCESSIBILITY_CLOUD_API_KEY)) {
      console.log("[skip] ACCESSIBILITY_CLOUD_API_KEY not configured")
      return
    }
    const places = await fetchAccessibilityCloud(PARAMS)
    expect(places.length).toBeGreaterThan(0)
    for (const p of places.slice(0, 3)) {
      expect(p.name).toBeTruthy()
      expect(p.primarySource).toBe("accessibility_cloud")
    }
  })
})

// ─── Google Places ─────────────────────────────────────────────────────────────

describe("Google Places adapter – live search", () => {
  it("returns restaurants in Berlin Mitte", { timeout: 25_000 }, async () => {
    if (isPlaceholder(process.env.GOOGLE_PLACES_API_KEY)) {
      console.log("[skip] GOOGLE_PLACES_API_KEY not configured")
      return
    }
    const places = await fetchGooglePlaces(PARAMS)
    expect(places.length).toBeGreaterThan(0)
    for (const p of places.slice(0, 3)) {
      expect(p.name).toBeTruthy()
      expect(p.primarySource).toBe("google_places")
    }
  })
})

// ─── Reisen für Alle ──────────────────────────────────────────────────────────

describe("Reisen für Alle adapter – live search", () => {
  it("returns certified places or skips when key absent", { timeout: 25_000 }, async () => {
    if (
      isPlaceholder(process.env.REISEN_FUER_ALLE_API_KEY) ||
      isPlaceholder(process.env.REISEN_FUER_ALLE_API_BASE)
    ) {
      console.log("[skip] REISEN_FUER_ALLE_API_KEY / REISEN_FUER_ALLE_API_BASE not configured")
      return
    }
    const places = await fetchReisenFuerAlle(PARAMS)
    expect(places.length).toBeGreaterThan(0)
    for (const p of places.slice(0, 3)) {
      expect(p.name).toBeTruthy()
      expect(p.primarySource).toBe("reisen_fuer_alle")
    }
  })
})
