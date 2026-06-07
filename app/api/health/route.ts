import { NextRequest, NextResponse } from "next/server"
import type { Place, SearchParams, SourceId } from "@/lib/types"
import { OVERPASS_ENDPOINTS, PUBLIC_OVERPASS_ENDPOINTS } from "@/lib/config"
import { startAdapterTasks } from "@/lib/adapters"
import { findMatch } from "@/lib/matching/match"
import {
  mergePlaces,
  passesFilters,
  finalisePlaceConfidence,
  computeFilteredConfidence,
  emptyAttribute,
} from "@/lib/matching/merge"

// ─── Fixed test scenario ─────────────────────────────────────────────────────
// Berlin Mitte: stable, well-mapped area for cafés in OSM.
// Coordinates bypass Nominatim so geocoding failures don't affect the check.

const SCENARIO = {
  label:      "Cafés in Berlin Mitte (entrance + toilet filter)",
  location:   { lat: 52.5200, lon: 13.4050 },
  radiusKm:   2,
  categories: ["cafe"] as SearchParams["categories"],
  filters: {
    entrance: true, toilet: true, parking: false, parkingNearby: true, seating: false,
    onlyVerified: false, acceptUnknown: true, alwaysShowParking: false, alwaysShowToilets: false,
  },
  minResults:    3,
  minConfidence: 0.30,
} as const

// ─── Mock fixture (used in ?mock=1 / load-test mode) ─────────────────────────
// Runs the real merge+filter+scoring pipeline without any external HTTP calls.

function makeMockPlaces(): Place[] {
  const place = (
    id: string, name: string,
    entrance: "yes" | "limited" | "no",
    lat: number, lon: number,
  ): Place => ({
    id,
    name,
    category:    "cafe",
    address:     { street: "Unter den Linden", houseNumber: "1", postalCode: "10117", city: "Berlin", country: "DE" },
    coordinates: { lat, lon },
    accessibility: {
      entrance: {
        value: entrance, confidence: 0.75, conflict: false,
        sources: [{ sourceId: "osm", value: entrance, rawValue: entrance, reliabilityWeight: 0.75 }],
        details: {},
      },
      toilet:  emptyAttribute(),
      parking: emptyAttribute(),
    },
    overallConfidence: 0,
    primarySource:     "osm",
    sourceRecords:     [{ sourceId: "osm", externalId: id, fetchedAt: new Date().toISOString() }],
  })

  return [
    place("mock-1", "Café Mitte",            "yes",     52.5200, 13.4050),
    place("mock-2", "Kaffeehaus Berlin",     "limited", 52.5210, 13.4060),
    place("mock-3", "Espresso Bar Zentrum",  "yes",     52.5190, 13.4040),
    place("mock-4", "Bistro am Gendarmenmarkt", "no",   52.5140, 13.3930),
    place("mock-5", "Café am Hackeschen Markt", "limited", 52.5220, 13.4070),
  ]
}

// ─── Pipeline (shared between live and mock modes) ───────────────────────────

function runPipeline(
  places: Place[],
  filters: SearchParams["filters"],
  categories: SearchParams["categories"],
): Place[] {
  const canonical: Place[] = []
  for (const incoming of places) {
    const idx = findMatch(canonical, incoming)
    if (idx >= 0) canonical[idx] = mergePlaces(canonical[idx], incoming)
    else          canonical.push(finalisePlaceConfidence(incoming))
  }

  const categoryFiltered = categories.length
    ? canonical.filter((p) => categories.includes(p.category))
    : canonical

  return categoryFiltered
    .map((p) => ({ ...p, overallConfidence: computeFilteredConfidence(p, filters) }))
    .filter((p) => passesFilters(p, filters))
    .sort((a, b) => b.overallConfidence - a.overallConfidence)
}

// ─── Constant-time token comparison ─────────────────────────────────────────

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ─── Health check result types ───────────────────────────────────────────────

type CheckResult = { name: string; ok: true; actual?: number | string } | { name: string; ok: false; error: string }

type AdapterReport =
  | { status: "ok";           rawCount: number; durationMs: number }
  | { status: "error";        error: string;    durationMs: number }
  | { status: "skipped_no_key" }
  | { status: "disabled" }

type PhotonReport =
  | { status: "ok";      featureCount: number; durationMs: number }
  | { status: "error";   httpStatus?: number;  error: string;     durationMs: number }
  | { status: "skipped" }

// ─── Photon availability check ───────────────────────────────────────────────

const PHOTON_CHECK_URL =
  "https://photon.komoot.io/api/?q=Berlin&limit=1&lang=de" +
  "&bbox=5.87,45.82,17.17,55.06&layer=city&layer=district&layer=locality"

async function checkPhoton(): Promise<PhotonReport> {
  const t0 = Date.now()
  try {
    const res = await fetch(PHOTON_CHECK_URL, {
      headers: { "User-Agent": "AccessiblePlaces/1.0 (health-check)" },
      signal:  AbortSignal.timeout(5_000),
    })
    const durationMs = Date.now() - t0
    if (!res.ok) {
      return { status: "error", httpStatus: res.status, error: res.statusText || `HTTP ${res.status}`, durationMs }
    }
    const data = await res.json() as { features?: unknown[] }
    return { status: "ok", featureCount: data.features?.length ?? 0, durationMs }
  } catch (err) {
    return { status: "error", error: String(err), durationMs: Date.now() - t0 }
  }
}

// ─── Overpass endpoint probe ─────────────────────────────────────────────────
// Sends a no-op query ([out:json][timeout:5];out 0;) to verify the endpoint
// is alive and returns JSON (not an HTML overload page).

type OverpassProbeResult =
  | { endpoint: string; kind: "private" | "public"; ok: true;  durationMs: number }
  | { endpoint: string; kind: "private" | "public"; ok: false; durationMs: number; error: string }

const PUBLIC_OVERPASS_SET = new Set(PUBLIC_OVERPASS_ENDPOINTS)

async function probeOverpassEndpoint(endpoint: string): Promise<OverpassProbeResult> {
  const kind: "private" | "public" = PUBLIC_OVERPASS_SET.has(endpoint) ? "public" : "private"
  const t0 = Date.now()
  try {
    const res = await fetch(endpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    "data=[out:json][timeout:5];out+0;",
      signal:  AbortSignal.timeout(10_000),
    })
    const durationMs = Date.now() - t0
    const ct = res.headers.get("content-type") ?? ""
    if (!res.ok)             return { endpoint, kind, ok: false, durationMs, error: `HTTP ${res.status}` }
    if (ct.includes("html")) return { endpoint, kind, ok: false, durationMs, error: "HTML response (overloaded)" }
    return { endpoint, kind, ok: true, durationMs }
  } catch (err) {
    return { endpoint, kind, ok: false, durationMs: Date.now() - t0, error: String(err) }
  }
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = process.env.HEALTH_CHECK_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: "Health endpoint not configured (HEALTH_CHECK_SECRET missing)" }, { status: 503 })
  }
  const token = req.nextUrl.searchParams.get("token") ?? ""
  if (!safeEqual(token, secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  const isMock      = req.nextUrl.searchParams.get("mock") === "1"
  const checkPhotonFlag = req.nextUrl.searchParams.get("photon") === "1"
  const t0          = Date.now()

  const adapterReport: Partial<Record<SourceId | "google_places", AdapterReport>> = {
    google_places: { status: "disabled" },
  }

  let results: Place[] = []
  const checks: CheckResult[] = []
  let photonReport: PhotonReport = { status: "skipped" }

  // Start Photon check in parallel (live mode only; mock skips all external calls)
  const photonPromise = checkPhotonFlag && !isMock ? checkPhoton() : Promise.resolve<PhotonReport>({ status: "skipped" })

  // Probe results for all Overpass endpoints (live mode only)
  let overpassProbes: OverpassProbeResult[] = []

  if (isMock) {
    // ── Mock mode: fixture data through the real pipeline, no HTTP calls ──
    const mockPlaces = makeMockPlaces()
    results = runPipeline(mockPlaces, { ...SCENARIO.filters }, [...SCENARIO.categories])
    adapterReport.osm = { status: "ok", rawCount: mockPlaces.length, durationMs: 0 }
  } else {
    // ── Live mode: real adapter calls (OSM required, others if key present) ──
    const hasACloud = Boolean(process.env.ACCESSIBILITY_CLOUD_API_KEY)
    const hasRfa    = Boolean(process.env.REISEN_FUER_ALLE_API_KEY && process.env.REISEN_FUER_ALLE_API_BASE)

    if (!hasACloud) adapterReport.accessibility_cloud = { status: "skipped_no_key" }
    if (!hasRfa)    adapterReport.reisen_fuer_alle    = { status: "skipped_no_key" }

    const sources: SearchParams["sources"] = {
      osm:                 true,
      accessibility_cloud: hasACloud,
      reisen_fuer_alle:    hasRfa,
      ginto:               false,   // off in health checks — CH-only, separate concern
      google_places:       false,   // always off — no costs in health checks
    }

    const params: SearchParams = {
      query:      SCENARIO.label,
      location:   SCENARIO.location,
      radiusKm:   SCENARIO.radiusKm,
      categories: [...SCENARIO.categories],
      filters:    { ...SCENARIO.filters },
      sources,
      signal:     AbortSignal.timeout(35_000),
    }

    // Probe each Overpass endpoint individually in parallel with the adapter run
    const probePromise = Promise.all(OVERPASS_ENDPOINTS.map(probeOverpassEndpoint))

    try {
      const tasks        = startAdapterTasks(params)
      const adapterResults = await Promise.all(tasks.map((t) => t.promise))

      let allPlaces: Place[] = []
      for (const r of adapterResults) {
        const report: AdapterReport = r.error
          ? { status: "error", error: r.error, durationMs: r.durationMs }
          : { status: "ok",    rawCount: r.places.length, durationMs: r.durationMs }
        adapterReport[r.sourceId] = report
        allPlaces = allPlaces.concat(r.places)
      }

      results = runPipeline(allPlaces, params.filters, params.categories)
    } catch (err) {
      adapterReport.osm = { status: "error", error: String(err), durationMs: Date.now() - t0 }
    }

    overpassProbes = await probePromise

    // Evaluate probes: private failure → fails the check; public failure → warn only
    for (const probe of overpassProbes) {
      if (probe.ok) continue
      if (probe.kind === "private") {
        console.error(`[health] Private Overpass endpoint down: ${probe.endpoint} — ${probe.error}`)
        checks.push({ name: `overpass_private_${probe.endpoint}`, ok: false, error: probe.error })
      } else {
        console.info(`[health] Public Overpass mirror degraded (non-critical): ${probe.endpoint} — ${probe.error}`)
        // public mirror failures are logged but do NOT fail the health check
      }
    }
  }

  // ── Photon result ─────────────────────────────────────────────────────────
  photonReport = await photonPromise
  if (photonReport.status !== "skipped") {
    if (photonReport.status === "ok") {
      checks.push({ name: "photon_available", ok: true, actual: photonReport.durationMs + "ms" })
    } else {
      checks.push({ name: "photon_available", ok: false, error: photonReport.error })
    }
  }

  // ── Shared checks (live and mock) ─────────────────────────────────────────
  if (results.length >= SCENARIO.minResults) {
    checks.push({ name: `result_count_min_${SCENARIO.minResults}`, ok: true, actual: results.length })
  } else {
    checks.push({ name: `result_count_min_${SCENARIO.minResults}`, ok: false, error: `got ${results.length}` })
  }

  const topConfidence = results[0]?.overallConfidence ?? 0
  if (topConfidence >= SCENARIO.minConfidence) {
    checks.push({ name: "top_confidence_min_0.3", ok: true, actual: Math.round(topConfidence * 100) / 100 })
  } else {
    checks.push({ name: "top_confidence_min_0.3", ok: false, error: `got ${topConfidence.toFixed(2)}` })
  }

  const allOk = checks.every((c) => c.ok)

  const body = {
    ok:        allOk,
    timestamp: new Date().toISOString(),
    mode:      isMock ? "mock" : "live",
    durationMs: Date.now() - t0,
    scenario:  {
      label:      SCENARIO.label,
      location:   SCENARIO.location,
      radiusKm:   SCENARIO.radiusKm,
      filters:    SCENARIO.filters,
    },
    adapters: adapterReport,
    photon:   photonReport,
    overpassEndpoints: isMock ? [] : overpassProbes.map(p => ({
      endpoint: p.endpoint, kind: p.kind, ok: p.ok, durationMs: p.durationMs,
      ...(p.ok ? {} : { error: (p as { error: string }).error }),
    })),
    checks,
    ...(allOk ? {} : { topResults: results.slice(0, 3).map((p) => ({ name: p.name, confidence: p.overallConfidence, entrance: p.accessibility.entrance.value })) }),
  }

  return NextResponse.json(body, {
    status:  allOk ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  })
}
