import { NextRequest, NextResponse } from "next/server"

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX       = 5
const ipWindows = new Map<string, number[]>()

function checkRateLimit(ip: string): boolean {
  const now    = Date.now()
  const recent = (ipWindows.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX) return false
  recent.push(now)
  ipWindows.set(ip, recent)
  return true
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown"
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }

  const token = process.env.GITHUB_REPORT_TOKEN
  if (!token) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 })
  }

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  const { lat, lon, osmId, nearestPlaceName } = body as Record<string, unknown>
  if (typeof lat !== "number" || typeof lon !== "number") {
    return NextResponse.json({ error: "missing_coords" }, { status: 400 })
  }

  const osmIdStr  = typeof osmId          === "string" ? osmId          : null
  const placeStr  = typeof nearestPlaceName === "string" ? nearestPlaceName : null

  const osmUrl = osmIdStr
    ? `https://www.openstreetmap.org/${osmIdStr}`
    : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=19/${lat}/${lon}`

  const editorUrl = osmIdStr
    ? (() => {
        const [type, id] = osmIdStr.split("/")
        return `https://www.openstreetmap.org/edit?${type}=${id}`
      })()
    : `https://www.openstreetmap.org/edit#map=19/${lat}/${lon}`

  const issueTitle = `🟡 Parkplatz-Meldung · ${lat.toFixed(5)}, ${lon.toFixed(5)}`
  const issueBody = [
    "Ein Nutzer hat diesen **gelben** (accessible-tier) Parkplatz-Marker als möglichen **dedizierten Rollstuhlparkplatz** gemeldet.",
    "",
    "Bitte in OSM prüfen: Ist es ein reservierter Behindertenparkplatz?",
    "Falls ja → Tag korrigieren: `parking_space=disabled` oder `capacity:disabled=1` hinzufügen.",
    "",
    "---",
    "",
    `**Koordinaten:** ${lat}, ${lon}`,
    osmIdStr ? `**OSM-Objekt:** ${osmUrl}` : `**OSM-Karte:** ${osmUrl}`,
    `**iD-Editor:** ${editorUrl}`,
    placeStr ? `**Nächste Venue:** ${placeStr}` : null,
    `**Gemeldet:** ${new Date().toISOString()}`,
  ].filter(Boolean).join("\n")

  const ghRes = await fetch(
    "https://api.github.com/repos/andreasknoor/accessibility-places/issues",
    {
      method:  "POST",
      headers: {
        "Authorization":        `Bearer ${token}`,
        "Accept":               "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type":         "application/json",
      },
      body: JSON.stringify({ title: issueTitle, body: issueBody }),
    },
  )

  if (!ghRes.ok) {
    const err = await ghRes.text().catch(() => "")
    console.error("[report-parking] GitHub API error:", ghRes.status, err)
    return NextResponse.json({ error: "github_error" }, { status: 502 })
  }

  const issue = await ghRes.json() as { number: number }
  return NextResponse.json({ ok: true, issue: issue.number })
}
