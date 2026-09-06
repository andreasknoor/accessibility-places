import { NextRequest, NextResponse } from "next/server"
import { ipFromRequest } from "@/lib/rate-limit"
import { isReportRateLimited } from "@/lib/report-rate-limit"

// This endpoint is unauthenticated and its output is published to a PUBLIC
// repository under the token owner's own GitHub identity. Everything below
// that reaches the issue body is therefore attacker-controlled content that
// we publish as ourselves — it gets hard caps and strict shapes, not just
// type checks.

const MAX_PLACE_NAME_LEN = 120

// OSM object ids have exactly one shape. Anything else is dropped rather than
// sanitised: a malformed id has no legitimate use here, and validating by
// allowlist removes the URL-injection surface in osmUrl/editorUrl entirely
// (both interpolate this value straight into a link the issue renders).
const OSM_ID_RE = /^(node|way|relation)\/\d{1,20}$/

// GitHub renders the issue body as Markdown, so a bare place name could carry
// @mentions (notification spam appearing to come from us), #123 cross-links,
// images used as tracking pixels, or raw HTML. Wrapping the value in an
// inline code span neutralises all of it — inside a code span GitHub does not
// linkify mentions, issue references, or URLs. Backticks and newlines would
// break out of the span, so they are flattened first, and the whole thing is
// length-capped so a single report cannot produce an enormous issue.
function asInlineCode(raw: string): string | null {
  const flat = raw.replace(/[`\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_PLACE_NAME_LEN)
  return flat.length > 0 ? `\`${flat}\`` : null
}

export async function POST(req: NextRequest) {
  const ip = ipFromRequest(req)
  if (await isReportRateLimited(ip)) {
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
  // Range-checked, not just type-checked: these are interpolated into the
  // issue title, body, and two OSM links, and the other routes
  // (search/route.ts, nearby-parking/route.ts) already validate coordinates
  // this way. Number.isFinite also rejects NaN/Infinity, which JSON.parse
  // cannot currently produce but which no longer depends on that guarantee.
  if (!Number.isFinite(lat as number) || !Number.isFinite(lon as number) ||
      (lat as number) < -90  || (lat as number) > 90 ||
      (lon as number) < -180 || (lon as number) > 180) {
    return NextResponse.json({ error: "missing_coords" }, { status: 400 })
  }
  const latNum = lat as number
  const lonNum = lon as number

  const osmIdStr = typeof osmId === "string" && OSM_ID_RE.test(osmId) ? osmId : null
  const placeStr = typeof nearestPlaceName === "string" ? asInlineCode(nearestPlaceName) : null

  const osmUrl = osmIdStr
    ? `https://www.openstreetmap.org/${osmIdStr}`
    : `https://www.openstreetmap.org/?mlat=${latNum}&mlon=${lonNum}#map=19/${latNum}/${lonNum}`

  const editorUrl = osmIdStr
    ? (() => {
        // Safe to split blindly: OSM_ID_RE already guarantees exactly one "/"
        // with a known type on the left and digits on the right.
        const [type, id] = osmIdStr.split("/")
        return `https://www.openstreetmap.org/edit?${type}=${id}`
      })()
    : `https://www.openstreetmap.org/edit#map=19/${latNum}/${lonNum}`

  const issueTitle = `🟡 Parkplatz-Meldung · ${latNum.toFixed(5)}, ${lonNum.toFixed(5)}`
  const issueBody = [
    "Ein Nutzer hat diesen **gelben** (accessible-tier) Parkplatz-Marker als möglichen **dedizierten Rollstuhlparkplatz** gemeldet.",
    "",
    "Bitte in OSM prüfen: Ist es ein reservierter Behindertenparkplatz?",
    "Falls ja → Tag korrigieren: `parking_space=disabled` oder `capacity:disabled=1` hinzufügen.",
    "",
    "---",
    "",
    `**Koordinaten:** ${latNum}, ${lonNum}`,
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
