#!/usr/bin/env node
// Compares disabled-parking OSM data between private and public Overpass endpoints.
// Uses the exact same query as fetchOsmDisabledParking() in lib/adapters/osm.ts.
//
// Usage:
//   node scripts/compare-overpass-parking.mjs
//   RADIUS=10 node scripts/compare-overpass-parking.mjs
//   PUBLIC=https://overpass-api.de/api/interpreter node scripts/compare-overpass-parking.mjs

const PRIVATE = process.env.PRIVATE ?? "https://overpass.accessible-places.org/api/interpreter"
const PUBLIC  = process.env.PUBLIC  ?? "https://overpass-api.de/api/interpreter"

const LAT       = 52.5200   // Berlin Mitte
const LON       = 13.4050
const RADIUS_KM = Number(process.env.RADIUS ?? 5)
const RADIUS_M  = RADIUS_KM * 1000

// Identical to fetchOsmDisabledParking() in lib/adapters/osm.ts
const QUERY = `[out:json][timeout:30];(\
way(around:${RADIUS_M},${LAT},${LON})[amenity=parking]["capacity:disabled"];\
way(around:${RADIUS_M},${LAT},${LON})[amenity=parking]["capacity:wheelchair"];\
node(around:${RADIUS_M},${LAT},${LON})[amenity=parking_space][parking_space=disabled];\
node(around:${RADIUS_M},${LAT},${LON})[amenity=parking_space][wheelchair=designated];\
);out 500 center tags;`

const HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent":   "AccessibleSpaces/compare-script (accessibility check)",
}

async function query(label, url) {
  const t0 = Date.now()
  let res
  try {
    res = await fetch(url, {
      method:  "POST",
      headers: HEADERS,
      body:    `data=${encodeURIComponent(QUERY)}`,
      signal:  AbortSignal.timeout(60_000),
    })
  } catch (err) {
    throw new Error(`${label}: network error — ${err.message}`)
  }

  const ct = res.headers.get("content-type") ?? ""
  if (!ct.includes("json")) {
    const body = await res.text()
    throw new Error(`${label}: HTTP ${res.status}, content-type: ${ct}\n  Body: ${body.slice(0, 200)}`)
  }

  const json = await res.json()
  const ms   = Date.now() - t0
  return { json, ms }
}

function elementId(el) {
  return `${el.type}/${el.id}`
}

function capacity(el) {
  return el.tags?.["capacity:disabled"] ?? el.tags?.["capacity:wheelchair"] ?? "–"
}

console.log("Overpass Parking Data Comparison")
console.log(`Location : Berlin Mitte (${LAT}, ${LON}), radius ${RADIUS_KM} km`)
console.log("Query    : same as fetchOsmDisabledParking() in lib/adapters/osm.ts")
console.log()

let privateResult, publicResult
try {
  process.stdout.write(`▶ Private (${PRIVATE}) ... `)
  privateResult = await query("private", PRIVATE)
  console.log(`${privateResult.ms} ms`)
} catch (err) {
  console.error(`\n  ERROR: ${err.message}`)
  process.exit(1)
}
try {
  process.stdout.write(`▶ Public  (${PUBLIC}) ... `)
  publicResult = await query("public", PUBLIC)
  console.log(`${publicResult.ms} ms`)
} catch (err) {
  console.error(`\n  ERROR: ${err.message}`)
  process.exit(1)
}

const pElements = privateResult.json.elements ?? []
const uElements = publicResult.json.elements  ?? []

const pIds = new Set(pElements.map(elementId))
const uIds = new Set(uElements.map(elementId))

const onlyP     = [...pIds].filter(id => !uIds.has(id))
const onlyU     = [...uIds].filter(id => !pIds.has(id))
const inBoth    = [...pIds].filter(id => uIds.has(id))

const pById = Object.fromEntries(pElements.map(el => [elementId(el), el]))
const uById = Object.fromEntries(uElements.map(el => [elementId(el), el]))

const capDiffs = inBoth.filter(id => capacity(pById[id]) !== capacity(uById[id]))

const sep = "═".repeat(52)
console.log()
console.log(sep)
console.log(`  Private:  ${String(pElements.length).padStart(4)} elements   ${privateResult.ms} ms`)
console.log(`  Public:   ${String(uElements.length).padStart(4)} elements   ${publicResult.ms} ms`)
console.log(sep)
console.log()
console.log(`  ${"Matching elements (same ID):".padEnd(32)} ${inBoth.length}`)
console.log(`  ${"Only in private:".padEnd(32)} ${onlyP.length}`)
console.log(`  ${"Only in public:".padEnd(32)} ${onlyU.length}`)
console.log(`  ${"Capacity value differences:".padEnd(32)} ${capDiffs.length}`)

if (onlyP.length > 0) {
  console.log()
  console.log("── Only in private (newer data or ahead of public) ──")
  onlyP.forEach(id => console.log(`    ${id}  capacity=${capacity(pById[id])}`))
}

if (onlyU.length > 0) {
  console.log()
  console.log("── Only in public (missing from private / replication lag?) ──")
  onlyU.forEach(id => console.log(`    ${id}  capacity=${capacity(uById[id])}`))
}

if (capDiffs.length > 0) {
  console.log()
  console.log("── Capacity differences (same element, different tag value) ──")
  capDiffs.forEach(id => {
    console.log(`    ${id}  private=${capacity(pById[id])}  public=${capacity(uById[id])}`)
  })
}

console.log()
if (onlyP.length === 0 && onlyU.length === 0 && capDiffs.length === 0) {
  console.log("✅  Servers are in sync — identical results.")
} else {
  const lag = onlyU.length > 0 || capDiffs.length > 0
  if (lag) {
    console.log("⚠   Private server appears to be behind public (replication lag).")
    console.log("    To sync:")
    console.log("      docker exec overpass /app/bin/fetch_osc_and_apply.sh \\")
    console.log("        https://download.geofabrik.de/europe/dach-updates/")
  } else {
    console.log("⚠   Private server has data not yet in public (private is ahead — normal).")
  }
}
