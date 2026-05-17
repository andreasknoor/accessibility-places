import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual }           from "crypto"
import { getStats, resetStats }      from "@/lib/stats"
import type { StatsResult, StatsResponse } from "@/lib/stats"

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

const SOURCE_LABELS: Record<string, string> = {
  osm:                "OpenStreetMap",
  accessibility_cloud:"accessibility.cloud",
  reisen_fuer_alle:   "Reisen für Alle",
  ginto:              "Ginto",
  google_places:      "Google Places",
}

const SOURCE_ORDER = ["osm", "accessibility_cloud", "reisen_fuer_alle", "ginto", "google_places"]

function fmt(n: number): string {
  return n.toLocaleString("de-DE")
}

function errorColor(rate: number): string {
  if (rate < 1)  return "#10b981"
  if (rate < 5)  return "#f59e0b"
  return "#ef4444"
}

function errorDot(rate: number): string {
  const c = errorColor(rate)
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c};margin-right:8px;flex-shrink:0"></span>`
}

function formatHour(h: string): string {
  // "2026-05-17T14" → "May 17, 2026, 14:00"
  const [date, hour] = h.split("T")
  const [y, m, d] = date.split("-")
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
  return `${monthNames[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}, ${hour}:00`
}

function renderHtml({ sources: stats, oldestHour }: StatsResponse): string {
  const entries = SOURCE_ORDER
    .map(id => ({ id, s: stats[id as keyof StatsResult] }))
    .filter(e => e.s != null) as { id: string; s: NonNullable<StatsResult[keyof StatsResult]> }[]

  const totalCalls  = entries.reduce((a, e) => a + e.s.totalCalls,       0)
  const totalErrors = entries.reduce((a, e) => a + e.s.totalErrors,      0)
  const totalErrHour= entries.reduce((a, e) => a + e.s.avgErrorsPerHour, 0)
  const totalCallHour=entries.reduce((a, e) => a + e.s.avgCallsPerHour,  0)
  const globalRate  = totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0

  const now = new Date().toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })

  const rows = entries.map(({ id, s }) => {
    const rate    = s.totalCalls > 0 ? (s.totalErrors / s.totalCalls) * 100 : 0
    const color   = errorColor(rate)
    const dot     = errorDot(rate)
    const warning = rate >= 5 ? `<span title="Hohe Fehlerrate" style="margin-left:6px">⚠</span>` : ""
    return `
      <tr>
        <td style="padding:12px 16px;display:flex;align-items:center">${dot}${SOURCE_LABELS[id] ?? id}${warning}</td>
        <td style="padding:12px 16px;text-align:right">${fmt(s.totalCalls)}</td>
        <td style="padding:12px 16px;text-align:right">${fmt(s.totalErrors)}</td>
        <td style="padding:12px 16px;text-align:right">
          <span style="background:${color}22;color:${color};padding:2px 8px;border-radius:4px;font-weight:600">${rate.toFixed(1)} %</span>
        </td>
        <td style="padding:12px 16px;text-align:right">${s.avgCallsPerHour.toFixed(1)}</td>
        <td style="padding:12px 16px;text-align:right">${s.avgErrorsPerHour.toFixed(1)}</td>
      </tr>`
  }).join("")

  const kpiColor = errorColor(globalRate)

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Adapter Stats</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0 }
  body { background: #111827; color: #f9fafb; font-family: ui-monospace, "Cascadia Code", "Fira Code", monospace; min-height: 100vh; padding: 32px 24px }
  h1 { font-size: 1.25rem; font-weight: 600; letter-spacing: 0.05em; color: #e5e7eb }
  .subtitle { color: #6b7280; font-size: 0.8rem; margin-top: 4px }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-top: 28px }
  .kpi { background: #1f2937; border: 1px solid #374151; border-radius: 8px; padding: 20px 24px }
  .kpi-value { font-size: 2rem; font-weight: 700; line-height: 1; margin-bottom: 6px }
  .kpi-label { color: #9ca3af; font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase }
  .table-wrap { margin-top: 28px; border: 1px solid #374151; border-radius: 8px; overflow: hidden }
  table { width: 100%; border-collapse: collapse }
  thead tr { background: #1f2937; border-bottom: 1px solid #374151 }
  thead th { padding: 10px 16px; text-align: left; font-size: 0.7rem; letter-spacing: 0.1em; text-transform: uppercase; color: #9ca3af; font-weight: 500 }
  thead th:not(:first-child) { text-align: right }
  tbody tr { border-bottom: 1px solid #1f2937 }
  tbody tr:last-child { border-bottom: none }
  tbody tr:hover { background: #1f2937 }
  tbody td { font-size: 0.875rem }
  tbody td:first-child { color: #e5e7eb }
  .legend { margin-top: 16px; font-size: 0.75rem; color: #6b7280; display: flex; gap: 20px }
  .leg { display: flex; align-items: center; gap: 6px }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block }
  .empty { margin-top: 48px; text-align: center; color: #6b7280 }
  .empty-icon { font-size: 2.5rem; margin-bottom: 12px }
  .empty-title { font-size: 1rem; color: #9ca3af; margin-bottom: 6px }
  .empty-hint { font-size: 0.8rem; line-height: 1.6 }
  .reset-btn { position: fixed; bottom: 24px; right: 24px; background: #7f1d1d; color: #fca5a5; border: 1px solid #991b1b; border-radius: 6px; padding: 10px 18px; font: inherit; font-size: 0.8rem; cursor: pointer; letter-spacing: 0.03em }
  .reset-btn:hover { background: #991b1b; color: #fee2e2 }
</style>
</head>
<body>
<h1>♿ Adapter Stats Dashboard</h1>
<p class="subtitle">Last updated: ${now} &nbsp;·&nbsp; 90-day window &nbsp;·&nbsp; hourly granularity${oldestHour ? ` &nbsp;·&nbsp; Since: ${formatHour(oldestHour)}` : ""}</p>

${entries.length === 0 ? `
<div class="empty">
  <div class="empty-icon">📭</div>
  <div class="empty-title">No hourly data yet</div>
  <div class="empty-hint">
    Stats were migrated to hourly granularity.<br>
    Data will appear here once the first searches reach the live system.<br>
    <span style="color:#4b5563">Keys: <code>stats:h:calls:&lt;source&gt;:YYYY-MM-DDTHH</code></span>
  </div>
</div>
` : `
<div class="kpis">
  <div class="kpi">
    <div class="kpi-value">${fmt(totalCalls)}</div>
    <div class="kpi-label">Total Calls</div>
  </div>
  <div class="kpi">
    <div class="kpi-value" style="color:${kpiColor}">${globalRate.toFixed(1)} %</div>
    <div class="kpi-label">Global Error Rate</div>
  </div>
  <div class="kpi">
    <div class="kpi-value">${totalCallHour.toFixed(1)}</div>
    <div class="kpi-label">Calls/hr (avg)</div>
  </div>
  <div class="kpi">
    <div class="kpi-value" style="color:${errorColor(totalErrHour > 0 ? 10 : 0)}">${totalErrHour.toFixed(1)}</div>
    <div class="kpi-label">Errors/hr (avg)</div>
  </div>
  <div class="kpi">
    <div class="kpi-value">${entries.length} / 5</div>
    <div class="kpi-label">Active Sources</div>
  </div>
</div>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Source</th>
        <th>Total Calls</th>
        <th>Total Errors</th>
        <th>Error Rate</th>
        <th>Calls/hr avg</th>
        <th>Errors/hr avg</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>
`}

<div class="legend">
  <span class="leg"><span class="dot" style="background:#10b981"></span>&lt; 1 % — OK</span>
  <span class="leg"><span class="dot" style="background:#f59e0b"></span>1–5 % — Elevated</span>
  <span class="leg"><span class="dot" style="background:#ef4444"></span>&gt; 5 % — Critical</span>
</div>

<button class="reset-btn" onclick="
  if (!confirm('Permanently delete all statistics?\\n\\nThis cannot be undone.')) return;
  const token = new URLSearchParams(location.search).get('token') ?? '';
  fetch('/api/stats?token=' + encodeURIComponent(token), { method: 'DELETE' })
    .then(r => r.json())
    .then(d => { alert(d.deleted + ' keys deleted.'); location.reload(); })
    .catch(() => alert('Reset failed.'));
">Reset statistics</button>
</body>
</html>`
}

export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.HEALTH_CHECK_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: "Stats endpoint not configured" }, { status: 503 })
  }
  const token = req.nextUrl.searchParams.get("token") ?? ""
  if (!safeEqual(token, secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  if (!process.env.KV_REST_API_URL) {
    return NextResponse.json({ ok: false, error: "KV not configured" }, { status: 503 })
  }

  const stats = await getStats()

  if (req.nextUrl.searchParams.get("format") === "html") {
    return new Response(renderHtml(stats), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    })
  }

  return NextResponse.json({ ok: true, ...stats }, {
    headers: { "Cache-Control": "no-store" },
  })
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const secret = process.env.HEALTH_CHECK_SECRET
  if (!secret) return NextResponse.json({ ok: false, error: "Stats endpoint not configured" }, { status: 503 })
  const token = req.nextUrl.searchParams.get("token") ?? ""
  if (!safeEqual(token, secret)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  if (!process.env.KV_REST_API_URL) return NextResponse.json({ ok: false, error: "KV not configured" }, { status: 503 })
  const deleted = await resetStats()
  return NextResponse.json({ ok: true, deleted }, { headers: { "Cache-Control": "no-store" } })
}
