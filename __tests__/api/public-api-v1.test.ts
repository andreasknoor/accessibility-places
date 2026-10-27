// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { GET as lookupGET } from "@/app/api/v1/places/lookup/route"
import { GET as nearbyGET } from "@/app/api/v1/places/nearby/route"
import { GET as toiletsGET } from "@/app/api/v1/toilets/nearby/route"
import { GET as detailGET } from "@/app/api/v1/places/[id]/route"
import { GET as openapiGET } from "@/app/api/v1/openapi.json/route"
import { GET as docsGET } from "@/app/api/v1/docs/route"
import { serializePlace } from "@/lib/public-api/serialize"
import { elementToPlace } from "@/lib/adapters/osm"
import { mergePlaces, finalisePlaceConfidence, buildAttribute } from "@/lib/matching/merge"
import type { Place } from "@/lib/types"

const TOKEN = "test-token-0123456789"
let ipCounter = 0

function req(path: string, token: string | null = TOKEN): NextRequest {
  const sep = path.includes("?") ? "&" : "?"
  const url = `http://localhost/api/v1${path}${token ? `${sep}token=${token}` : ""}`
  // Distinct IP per request so the in-memory rate limiter never interferes.
  return new NextRequest(url, { headers: { "x-forwarded-for": `10.0.0.${++ipCounter % 250}` } })
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })

// ─── Fixtures (shaped like real Overpass / Photon responses) ──────────────

const MUSEUM = {
  type: "way", id: 31622818, center: { lat: 52.4986, lon: 13.3776 },
  tags: {
    name: "Deutsches Technikmuseum", tourism: "museum", wheelchair: "yes", "toilets:wheelchair": "yes",
    "addr:street": "Trebbiner Straße", "addr:housenumber": "9", "addr:postcode": "10963", "addr:city": "Berlin",
    "check_date:wheelchair": "2025-06-01",
  },
}
const TAXI = { type: "node", id: 2210553448, lat: 52.4987, lon: 13.3777, tags: { name: "Technikmuseum", amenity: "taxi" } }
const ENTRANCE_NODE = { type: "node", id: 4428520387, tags: { entrance: "main", wheelchair: "yes" } }
const WC_STANDALONE = { type: "node", id: 900, lat: 52.4991, lon: 13.3776, tags: { amenity: "toilets", wheelchair: "yes", centralkey: "eurokey", fee: "no", opening_hours: "24/7" } }
const WC_FAR = { type: "node", id: 901, lat: 52.505, lon: 13.3776, tags: { amenity: "toilets", wheelchair: "designated" } }
const CASTLE = {
  type: "relation", id: 9674820, center: { lat: 52.4045, lon: 13.0383 },
  tags: { name: "Schloss Sanssouci", historic: "castle", wheelchair: "limited", "addr:city": "Potsdam" },
}

let overpassFails = false
let structureFails = false
let photonHits: unknown[] = []

function overpassFor(query: string) {
  if (overpassFails) return new Response("busy", { status: 504 })
  if (query.includes("out ids")) return structureFails ? new Response("busy", { status: 504 }) : json({ elements: [{ type: "way", id: 31622818 }, ENTRANCE_NODE] })
  if (query.includes("amenity=toilets")) return json({ elements: [WC_STANDALONE, WC_FAR] })
  if (query.includes("amenity=parking")) return json({ elements: [] })
  if (query.includes("way(id:31622818)")) return json({ elements: [MUSEUM] })
  if (query.includes("(id:")) return json({ elements: [] })
  if (query.includes(`"historic"~`)) return json({ elements: [CASTLE] })
  if (query.includes(`["name"~`)) return json({ elements: [MUSEUM, TAXI] })
  return json({ elements: [MUSEUM] })
}

beforeEach(() => {
  vi.stubEnv("PUBLIC_API_TOKENS", `other-token-abcdefghij,${TOKEN}`)
  vi.stubEnv("GINTO_API_KEY", "")
  overpassFails = false
  structureFails = false
  photonHits = [{
    type: "Feature", geometry: { coordinates: [13.3776, 52.4986] },
    properties: { name: "Deutsches Technikmuseum", city: "Berlin", countrycode: "DE", osm_key: "tourism", osm_value: "museum", osm_type: "W", osm_id: 31622818 },
  }]
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("photon")) return json({ features: photonHits })
    const body = typeof init?.body === "string" ? decodeURIComponent(init.body.replace(/^data=/, "")) : ""
    return overpassFor(body)
  }))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// ─── Auth / validation ────────────────────────────────────────────────────

describe("access token", () => {
  it("401 without a token", async () => {
    const res = await lookupGET(req("/places/lookup?name=Test", null))
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe("unauthorized")
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })
  it("401 with a wrong token", async () => {
    expect((await lookupGET(req("/places/lookup?name=Test", "wrong-token-0123456789"))).status).toBe(401)
  })
  it("accepts any configured token", async () => {
    expect((await toiletsGET(req("/toilets/nearby?lat=52.4986&lon=13.3776", "other-token-abcdefghij"))).status).toBe(200)
  })
  it("ignores an Authorization header (cache key is the URL)", async () => {
    const r = new NextRequest("http://localhost/api/v1/toilets/nearby?lat=52.5&lon=13.4", { headers: { authorization: `Bearer ${TOKEN}` } })
    expect((await toiletsGET(r)).status).toBe(401)
  })
  it("503 when no token is configured", async () => {
    vi.stubEnv("PUBLIC_API_TOKENS", "")
    expect((await lookupGET(req("/places/lookup?name=Test"))).status).toBe(503)
  })
})

describe("parameter validation", () => {
  it.each([
    ["/places/lookup", "name: "],
    ["/places/lookup?name=Museum&lat=52.5", "lat and lon"],
    ["/places/nearby?lat=52.5&lon=13.4&radius=9000", "radius"],
    ["/places/nearby?lat=52.5&lon=13.4&category=spaceport", "Unknown category: spaceport"],
    ["/places/nearby?lat=52.5&lon=13.4&wheelchair=maybe", "Invalid wheelchair value"],
    ["/toilets/nearby?lat=48.85&lon=2.35", "outside the covered area"],
    ["/toilets/nearby?lat=abc&lon=13.4", "lat"],
  ])("%s → 400", async (path, msg) => {
    const handler = path.startsWith("/places/lookup") ? lookupGET : path.startsWith("/places/nearby") ? nearbyGET : toiletsGET
    const res = await handler(req(path))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe("invalid_parameter")
    expect(body.error.message).toContain(msg)
  })
})

// ─── Endpoints ────────────────────────────────────────────────────────────

describe("GET /places/lookup", () => {
  it("returns the venue with match_score, provenance and attribution — and drops name noise", async () => {
    const res = await lookupGET(req("/places/lookup?name=Deutsches%20Technikmuseum&city=Berlin"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=86400")
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
    const body = await res.json()
    expect(body.license).toBe("ODbL-1.0")
    expect(body.attribution[0]).toContain("OpenStreetMap contributors")
    expect(body.query).not.toHaveProperty("token")
    expect(body.results).toHaveLength(1) // the taxi rank is gone
    const [p] = body.results
    expect(p).toMatchObject({
      id: "osm:way:31622818", name: "Deutsches Technikmuseum", category: "museum",
      address: { street: "Trebbiner Straße 9", postcode: "10963", city: "Berlin" },
      accessibility: {
        wheelchair: "yes", toilet_wheelchair: "yes", nearest_wheelchair_toilet_m: 0,
        entrance_step_free: "yes", // from the entrance node on the outline
        elevator: "unknown",
      },
      confidence: "medium",
      conflicts: [],
      links: { osm: "https://www.openstreetmap.org/way/31622818" },
    })
    expect(p.match_score).toBeGreaterThan(0.9)
    expect(p.field_sources.wheelchair).toEqual(["osm"])
    expect(p.sources[0]).toMatchObject({ source: "osm", last_verified: "2025-06-01" })
  })

  it("reports partial failure as warnings with a short cache", async () => {
    structureFails = true
    const res = await lookupGET(req("/places/lookup?name=Deutsches%20Technikmuseum&city=Berlin"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=300")
    const body = await res.json()
    expect(body.warnings.map((w: { code: string }) => w.code)).toEqual(["structure_unavailable"])
    expect(body.results[0].accessibility.entrance_step_free).toBe("unknown")
  })

  it("502 (never cached) when every source failed", async () => {
    overpassFails = true
    const res = await lookupGET(req("/places/lookup?name=Deutsches%20Technikmuseum&city=Berlin"))
    expect(res.status).toBe(502)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  it("warns when no location can be found", async () => {
    photonHits = []
    const body = await (await lookupGET(req("/places/lookup?name=Nirgendwo"))).json()
    expect(body.results).toEqual([])
    expect(body.warnings[0].code).toBe("location_not_found")
  })
})

describe("GET /places/nearby", () => {
  it("returns venues sorted by distance with nearest toilet", async () => {
    const body = await (await nearbyGET(req("/places/nearby?lat=52.4986&lon=13.3776&radius=500&category=museum"))).json()
    expect(body.results[0]).toMatchObject({ id: "osm:way:31622818", distance_m: 0 })
    expect(body.results[0].accessibility.nearest_wheelchair_toilet_m).toBe(0)
    expect(body.warnings).toEqual([])
  })
  it("filters by wheelchair value", async () => {
    const body = await (await nearbyGET(req("/places/nearby?lat=52.4986&lon=13.3776&category=museum&wheelchair=no"))).json()
    expect(body.results).toEqual([])
  })
  it("fetches API-only categories with the extra OSM query", async () => {
    const body = await (await nearbyGET(req("/places/nearby?lat=52.4045&lon=13.0383&radius=300&category=castle"))).json()
    expect(body.results.map((r: { name: string; category: string }) => [r.name, r.category])).toEqual([["Schloss Sanssouci", "castle"]])
  })
  it("skips nearest-toilet above 1 km with a warning", async () => {
    const res = await nearbyGET(req("/places/nearby?lat=52.4986&lon=13.3776&radius=2000&category=museum"))
    const body = await res.json()
    expect(body.warnings.map((w: { code: string }) => w.code)).toContain("nearest_toilet_not_computed")
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=300")
  })
})

describe("GET /toilets/nearby", () => {
  it("returns toilets within the radius with distance, euro key, fee, hours", async () => {
    const body = await (await toiletsGET(req("/toilets/nearby?lat=52.4986&lon=13.3776&radius=100"))).json()
    expect(body.results).toHaveLength(1) // WC_FAR is ~700 m away
    expect(body.results[0]).toMatchObject({
      id: "osm:node:900", kind: "standalone", wheelchair: "yes", euro_key: true, fee: "no", opening_hours: "24/7",
    })
    expect(body.results[0].distance_m).toBeGreaterThan(40)
    expect(body.results[0].distance_m).toBeLessThan(65)
  })
  it("502 when Overpass is down", async () => {
    overpassFails = true
    expect((await toiletsGET(req("/toilets/nearby?lat=52.4986&lon=13.3776"))).status).toBe(502)
  })
})

describe("GET /places/{id}", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
  it("returns one place", async () => {
    const body = await (await detailGET(req("/places/osm:way:31622818"), ctx("osm:way:31622818"))).json()
    expect(body.result).toMatchObject({ id: "osm:way:31622818", accessibility: { wheelchair: "yes" } })
  })
  it("404 for an unknown element", async () => {
    expect((await detailGET(req("/places/osm:node:1"), ctx("osm:node:1"))).status).toBe(404)
  })
  it("400 for a non-OSM id", async () => {
    expect((await detailGET(req("/places/ginto:abc"), ctx("ginto:abc"))).status).toBe(400)
  })
})

describe("docs", () => {
  it("serves OpenAPI 3.1 and a plain-text guide without a token", async () => {
    const spec = await (await openapiGET()).json()
    expect(spec.openapi).toBe("3.1.0")
    expect(Object.keys(spec.paths)).toEqual(["/places/lookup", "/places/nearby", "/toilets/nearby", "/places/{id}"])
    const docs = await docsGET()
    expect(docs.headers.get("Content-Type")).toContain("text/plain")
    expect(await docs.text()).toContain("?token=")
  })
})

// ─── Serializer: conflicts across merged sources ──────────────────────────

describe("serializePlace with merged sources", () => {
  function gintoPlace(over: Partial<Place>): Place {
    return {
      ...elementToPlace(MUSEUM)!,
      id: "ginto:g1",
      primarySource: "ginto",
      accessibility: {
        entrance: buildAttribute("ginto", "limited", "x", {}),
        toilet:   buildAttribute("ginto", "yes", "x", {}),
        parking:  buildAttribute("ginto", "unknown", "x", {}),
      },
      sourceRecords: [{ sourceId: "ginto", externalId: "g1", fetchedAt: "", metadata: { updatedAt: "2026-01-02T10:00:00Z" } }],
      gintoUrl: "https://www.ginto.guide/entries/g1",
      ...over,
    }
  }

  it("resolves disagreement conservatively and lists the conflict", () => {
    const merged = mergePlaces(finalisePlaceConfidence(elementToPlace(MUSEUM)!), gintoPlace({}))
    const api = serializePlace(merged)
    expect(api.accessibility.wheelchair).toBe("limited")
    expect(api.conflicts).toEqual([{
      field: "wheelchair", resolution: "most_conservative", resolved: "limited",
      values: [{ source: "osm", value: "yes" }, { source: "ginto", value: "limited" }],
    }])
    expect(api.confidence).toBe("low")
    expect(api.field_confidence.toilet_wheelchair).toBe("high") // OSM + Ginto agree
    expect(api.field_sources.toilet_wheelchair).toEqual(["osm", "ginto"])
    expect(api.sources.map((s) => [s.source, s.last_updated])).toEqual([["osm", null], ["ginto", "2026-01-02"]])
    expect(api.links.ginto).toBe("https://www.ginto.guide/entries/g1")
  })

  it("never invents values", () => {
    const bare = elementToPlace({ type: "node", id: 1, lat: 52, lon: 13, tags: { name: "X", tourism: "museum" } })!
    const api = serializePlace(finalisePlaceConfidence(bare))
    expect(api.accessibility).toEqual({
      wheelchair: "unknown", entrance_step_free: "unknown", elevator: "unknown", toilet_wheelchair: "unknown",
      nearest_wheelchair_toilet_m: null, parking_disabled: "unknown", parking_disabled_nearby_m: null,
      surface_notes: null, description: null,
    })
    expect(Object.values(api.field_sources).every((s) => s.length === 0)).toBe(true)
    expect(api.confidence).toBe("low")
  })
})
