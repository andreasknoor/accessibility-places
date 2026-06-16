// @vitest-environment node
/**
 * Unit tests for the AccèsLibre adapter.
 * These tests exercise the internal derivation logic by calling the adapter
 * with a mocked fetch — no real network calls are made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// We test the adapter's exported logic indirectly by importing it and providing
// a mocked ACCESLIBRE_API_KEY environment variable and a mocked fetch.

// Set the env var before importing the adapter
process.env.ACCESLIBRE_API_KEY = "test-key"

import { fetchAccesLibre } from "../../lib/adapters/acceslibre"
import type { SearchParams } from "../../lib/types"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeParams(lat: number, lon: number): SearchParams {
  return {
    query:      "test",
    location:   { lat, lon },
    radiusKm:   5,
    categories: [],
    filters: {
      entrance: true, toilet: false, parking: false, parkingNearby: true,
      seating: false, onlyVerified: false, acceptUnknown: false,
      alwaysShowParking: false, alwaysShowToilets: false,
    },
    sources: {
      accessibility_cloud: false, osm: false, reisen_fuer_alle: false,
      ginto: false, acceslibre: true, google_places: false,
    },
    international: true,
  }
}

/** Build a minimal AccèsLibre API result item. */
function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    uuid:          "test-uuid-1",
    web_url:       "https://acceslibre.beta.gouv.fr/app/75-paris/a/restaurant/erp/test/",
    nom:           "Test Restaurant",
    adresse:       "1 Rue de Test 75001 Paris",
    commune:       "Paris",
    code_postal:   "75001",
    site_internet: null,
    activite:      { nom: "Restaurant", slug: "restaurant" },
    geom:          { type: "Point", coordinates: [2.3522, 48.8566] }, // [lon, lat]
    accessibilite: {
      entree:    { entree_plain_pied: null, entree_marches: null, entree_marches_rampe: null, entree_ascenseur: null, entree_pmr: null, entree_largeur_mini: null, entree_porte_type: null },
      accueil:   { sanitaires_presence: null, sanitaires_adaptes: null },
      transport: { stationnement_pmr: null, stationnement_ext_pmr: null },
    },
    ...overrides,
  }
}

/** Mock a successful API response with the given items. */
function mockFetch(items: unknown[]) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok:   true,
    json: async () => ({ count: items.length, next: null, results: items }),
  }))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AccèsLibre adapter — coordinate swap", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("swaps lon,lat from geom.coordinates to lat,lon on Place", async () => {
    // Paris coords: geom gives [lon=2.3522, lat=48.8566]
    mockFetch([makeItem()])
    const params = makeParams(48.8566, 2.3522)
    const places = await fetchAccesLibre(params)
    expect(places).toHaveLength(1)
    expect(places[0].coordinates.lat).toBeCloseTo(48.8566)
    expect(places[0].coordinates.lon).toBeCloseTo(2.3522)
  })
})

describe("AccèsLibre adapter — entrance value derivation", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("entree_plain_pied=true → entrance yes", async () => {
    mockFetch([makeItem({
      accessibilite: {
        entree:    { entree_plain_pied: true, entree_marches: null, entree_marches_rampe: null, entree_ascenseur: null, entree_pmr: null, entree_largeur_mini: null, entree_porte_type: null },
        accueil:   { sanitaires_presence: null, sanitaires_adaptes: null },
        transport: { stationnement_pmr: null, stationnement_ext_pmr: null },
      },
    })])
    const places = await fetchAccesLibre(makeParams(48.8566, 2.3522))
    expect(places[0].accessibility.entrance.value).toBe("yes")
  })

  it("entree_marches=2 with rampe=fixe → entrance limited", async () => {
    mockFetch([makeItem({
      accessibilite: {
        entree:    { entree_plain_pied: null, entree_marches: 2, entree_marches_rampe: "fixe", entree_ascenseur: null, entree_pmr: null, entree_largeur_mini: null, entree_porte_type: null },
        accueil:   { sanitaires_presence: null, sanitaires_adaptes: null },
        transport: { stationnement_pmr: null, stationnement_ext_pmr: null },
      },
    })])
    const places = await fetchAccesLibre(makeParams(48.8566, 2.3522))
    expect(places[0].accessibility.entrance.value).toBe("limited")
  })

  it("entree_marches=3 with no ramp or elevator → entrance no", async () => {
    mockFetch([makeItem({
      accessibilite: {
        entree:    { entree_plain_pied: null, entree_marches: 3, entree_marches_rampe: "aucune", entree_ascenseur: null, entree_pmr: null, entree_largeur_mini: null, entree_porte_type: null },
        accueil:   { sanitaires_presence: null, sanitaires_adaptes: null },
        transport: { stationnement_pmr: null, stationnement_ext_pmr: null },
      },
    })])
    const places = await fetchAccesLibre(makeParams(48.8566, 2.3522))
    expect(places[0].accessibility.entrance.value).toBe("no")
  })

  it("entree_marches=3 with no ramp_field at all → entrance no", async () => {
    mockFetch([makeItem({
      accessibilite: {
        entree:    { entree_plain_pied: null, entree_marches: 3, entree_marches_rampe: null, entree_ascenseur: null, entree_pmr: null, entree_largeur_mini: null, entree_porte_type: null },
        accueil:   { sanitaires_presence: null, sanitaires_adaptes: null },
        transport: { stationnement_pmr: null, stationnement_ext_pmr: null },
      },
    })])
    const places = await fetchAccesLibre(makeParams(48.8566, 2.3522))
    expect(places[0].accessibility.entrance.value).toBe("no")
  })
})

describe("AccèsLibre adapter — toilet value derivation", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("sanitaires_adaptes=true → toilet yes", async () => {
    mockFetch([makeItem({
      accessibilite: {
        entree:    { entree_plain_pied: null, entree_marches: null, entree_marches_rampe: null, entree_ascenseur: null, entree_pmr: null, entree_largeur_mini: null, entree_porte_type: null },
        accueil:   { sanitaires_presence: true, sanitaires_adaptes: true },
        transport: { stationnement_pmr: null, stationnement_ext_pmr: null },
      },
    })])
    const places = await fetchAccesLibre(makeParams(48.8566, 2.3522))
    expect(places[0].accessibility.toilet.value).toBe("yes")
  })

  it("sanitaires_presence=true + sanitaires_adaptes=false → toilet no", async () => {
    mockFetch([makeItem({
      accessibilite: {
        entree:    { entree_plain_pied: null, entree_marches: null, entree_marches_rampe: null, entree_ascenseur: null, entree_pmr: null, entree_largeur_mini: null, entree_porte_type: null },
        accueil:   { sanitaires_presence: true, sanitaires_adaptes: false },
        transport: { stationnement_pmr: null, stationnement_ext_pmr: null },
      },
    })])
    const places = await fetchAccesLibre(makeParams(48.8566, 2.3522))
    expect(places[0].accessibility.toilet.value).toBe("no")
  })
})

describe("AccèsLibre adapter — parking value derivation", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("stationnement_pmr=true → parking yes", async () => {
    mockFetch([makeItem({
      accessibilite: {
        entree:    { entree_plain_pied: null, entree_marches: null, entree_marches_rampe: null, entree_ascenseur: null, entree_pmr: null, entree_largeur_mini: null, entree_porte_type: null },
        accueil:   { sanitaires_presence: null, sanitaires_adaptes: null },
        transport: { stationnement_pmr: true, stationnement_ext_pmr: null },
      },
    })])
    const places = await fetchAccesLibre(makeParams(48.8566, 2.3522))
    expect(places[0].accessibility.parking.value).toBe("yes")
  })

  it("stationnement_ext_pmr=true only → parking limited", async () => {
    mockFetch([makeItem({
      accessibilite: {
        entree:    { entree_plain_pied: null, entree_marches: null, entree_marches_rampe: null, entree_ascenseur: null, entree_pmr: null, entree_largeur_mini: null, entree_porte_type: null },
        accueil:   { sanitaires_presence: null, sanitaires_adaptes: null },
        transport: { stationnement_pmr: null, stationnement_ext_pmr: true },
      },
    })])
    const places = await fetchAccesLibre(makeParams(48.8566, 2.3522))
    expect(places[0].accessibility.parking.value).toBe("limited")
  })
})

describe("AccèsLibre adapter — category mapping", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("unmapped activite slug → place is skipped", async () => {
    mockFetch([makeItem({ activite: { nom: "Unknown", slug: "totally-unknown-category" } })])
    const places = await fetchAccesLibre(makeParams(48.8566, 2.3522))
    expect(places).toHaveLength(0)
  })

  it("restaurant slug → category restaurant", async () => {
    mockFetch([makeItem({ activite: { nom: "Restaurant", slug: "restaurant" } })])
    const places = await fetchAccesLibre(makeParams(48.8566, 2.3522))
    expect(places[0].category).toBe("restaurant")
  })

  it("musee slug → category museum", async () => {
    mockFetch([makeItem({ activite: { nom: "Musée", slug: "musee" } })])
    const places = await fetchAccesLibre(makeParams(48.8566, 2.3522))
    expect(places[0].category).toBe("museum")
  })

  it("pharmacie slug → category pharmacy", async () => {
    mockFetch([makeItem({ activite: { nom: "Pharmacie", slug: "pharmacie" } })])
    const places = await fetchAccesLibre(makeParams(48.8566, 2.3522))
    expect(places[0].category).toBe("pharmacy")
  })
})

describe("AccèsLibre adapter — geo-fence", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("returns empty when not in international mode", async () => {
    mockFetch([makeItem()])
    const params = { ...makeParams(48.8566, 2.3522), international: false }
    const places = await fetchAccesLibre(params)
    expect(places).toHaveLength(0)
  })

  it("returns empty when outside France (Berlin coords)", async () => {
    mockFetch([makeItem()])
    const places = await fetchAccesLibre(makeParams(52.52, 13.40))
    expect(places).toHaveLength(0)
  })

  it("returns results when inside France (Paris coords)", async () => {
    mockFetch([makeItem()])
    const places = await fetchAccesLibre(makeParams(48.8566, 2.3522))
    expect(places).toHaveLength(1)
  })
})

describe("AccèsLibre adapter — Place fields", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("sets acceslibreUrl from web_url", async () => {
    mockFetch([makeItem()])
    const places = await fetchAccesLibre(makeParams(48.8566, 2.3522))
    expect(places[0].acceslibreUrl).toBe("https://acceslibre.beta.gouv.fr/app/75-paris/a/restaurant/erp/test/")
  })

  it("sets primarySource to acceslibre", async () => {
    mockFetch([makeItem()])
    const places = await fetchAccesLibre(makeParams(48.8566, 2.3522))
    expect(places[0].primarySource).toBe("acceslibre")
  })

  it("sets country to FR", async () => {
    mockFetch([makeItem()])
    const places = await fetchAccesLibre(makeParams(48.8566, 2.3522))
    expect(places[0].address.country).toBe("FR")
  })
})
