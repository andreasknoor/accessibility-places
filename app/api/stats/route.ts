import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual }           from "crypto"
import { getStats, resetStats }      from "@/lib/stats"
import { getTopUsers, resetUserStats, setUserComment, COMMENT_MAX_LENGTH } from "@/lib/user-stats"
import type { StatsResult, StatsResponse, SourceStats } from "@/lib/stats"
import type { TopUser } from "@/lib/user-stats"

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

const SOURCE_LABELS: Record<string, string> = {
  osm_private:         "OSM - private server",
  osm_parking_private: "OSM parking - private server",
  osm_public:          "OSM - public server",
  osm_parking_public:  "OSM parking - public server",
  accessibility_cloud: "Accessibility Cloud",
  ginto:               "Ginto",
  google_places:       "Google Places",
}

const SOURCE_ORDER = ["osm_private", "osm_parking_private", "osm_public", "osm_parking_public", "accessibility_cloud", "ginto", "google_places"]

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

const PLATFORM_BADGES: Record<string, { label: string; color: string }> = {
  ios:     { label: "iOS",     color: "#60a5fa" },
  android: { label: "Android", color: "#34d399" },
  web:     { label: "Web",     color: "#a78bfa" },
}

// HTML-escape for the comment column. Every OTHER value in this table is
// write-validated to a safe shape (uid = UUID regex, platform = whitelist,
// dates server-generated) — but the comment is operator-entered free text and
// MUST go through esc() wherever it is rendered. Keep that invariant when
// extending this table.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function renderTopUsers(topUsers: TopUser[]): string {
  if (topUsers.length === 0) return ""
  const rows = topUsers.map((u, i) => {
    const badge = PLATFORM_BADGES[u.platform ?? ""] ?? { label: u.platform ?? "–", color: "#9ca3af" }
    // data-* attributes are the sort/filter keys (uid/platform write-validated,
    // dates/searches server-generated — safe to embed unescaped).
    return `
      <tr data-rank="${i + 1}" data-uid="${u.uid}" data-searches="${u.searches}" data-first="${u.firstSeen ?? ""}" data-last="${u.lastSeen ?? ""}" data-platform="${u.platform ?? ""}">
        <td style="padding:12px 16px;color:#6b7280">${i + 1}</td>
        <td style="padding:12px 16px"><code>${u.uid.slice(0, 8)}…</code></td>
        <td style="padding:8px 16px">
          <input class="comment-input" data-uid="${u.uid}" value="${esc(u.comment ?? "")}"
                 maxlength="${COMMENT_MAX_LENGTH}" placeholder="…" spellcheck="false">
        </td>
        <td style="padding:12px 16px;text-align:right;font-weight:600">${fmt(u.searches)}</td>
        <td style="padding:12px 16px;text-align:right;color:#9ca3af">${u.firstSeen ?? "–"}</td>
        <td style="padding:12px 16px;text-align:right;color:#9ca3af">${u.lastSeen ?? "–"}</td>
        <td style="padding:12px 16px;text-align:right">
          <span style="background:${badge.color}22;color:${badge.color};padding:2px 8px;border-radius:4px;font-weight:600">${badge.label}</span>
        </td>
      </tr>`
  }).join("")
  const pfCounts: Record<string, number> = {}
  for (const u of topUsers) pfCounts[u.platform ?? ""] = (pfCounts[u.platform ?? ""] ?? 0) + 1
  const filterButtons = ["", "ios", "android", "web"].map((pf) => {
    const label = pf === "" ? "Alle" : PLATFORM_BADGES[pf].label
    const count = pf === "" ? topUsers.length : (pfCounts[pf] ?? 0)
    return `<button class="pf-filter${pf === "" ? " active" : ""}" data-pf="${pf}">${label} (${count})</button>`
  }).join("")
  return `
<h2 style="font-size:1rem;font-weight:600;letter-spacing:0.05em;color:#e5e7eb;margin-top:40px">👥 Top ${topUsers.length} Users</h2>
<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
  <p class="subtitle">Anonymous random IDs · searches counted server-side · 180-day retention since last visit · comments save on Enter</p>
  <div class="pf-bar">${filterButtons}</div>
</div>
<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th class="sortable" data-key="rank">#</th>
        <th class="sortable" data-key="uid">User ID</th>
        <th class="sortable" data-key="comment">Comment</th>
        <th class="sortable" data-key="searches">Searches</th>
        <th class="sortable" data-key="first">First seen</th>
        <th class="sortable" data-key="last">Last seen</th>
        <th class="sortable" data-key="platform">Platform</th>
      </tr>
    </thead>
    <tbody id="users-tbody">${rows}</tbody>
  </table>
</div>
<div class="section-footer" style="justify-content:flex-end">
  <button class="reset-btn" onclick="
    if (!confirm('Permanently delete all USER statistics?\\n\\nAdapter stats are kept. This cannot be undone.')) return;
    const token = new URLSearchParams(location.search).get('token') ?? '';
    fetch('/api/stats?token=' + encodeURIComponent(token) + '&target=users', { method: 'DELETE' })
      .then(r => r.json())
      .then(d => { alert(d.deleted + ' keys deleted.'); location.reload(); })
      .catch(() => alert('Reset failed.'));
  ">Reset user stats</button>
</div>
<script>
  document.querySelectorAll('.comment-input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.value = input.defaultValue; input.blur(); return; }
      if (e.key !== 'Enter') return;
      const token = new URLSearchParams(location.search).get('token') ?? '';
      input.classList.remove('saved', 'save-error');
      fetch('/api/stats?token=' + encodeURIComponent(token), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: input.dataset.uid, comment: input.value }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (!d.ok) throw new Error();
          input.defaultValue = input.value;  // Escape now reverts to the saved state
          input.classList.add('saved');
          setTimeout(() => input.classList.remove('saved'), 1500);
        })
        .catch(() => input.classList.add('save-error'));
    });
  });

  // Column sorting — client-side over the ≤50 rendered rows. Sort keys come
  // from the row's data-* attributes; the comment column reads the live input
  // value so unsaved edits sort correctly too.
  const usersTbody = document.getElementById('users-tbody');
  document.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
      document.querySelectorAll('th.sortable').forEach((o) => delete o.dataset.dir);
      th.dataset.dir = dir;
      const numeric = key === 'rank' || key === 'searches';
      const val = (tr) => key === 'comment'
        ? (tr.querySelector('.comment-input')?.value ?? '').toLowerCase()
        : numeric ? Number(tr.dataset[key]) : (tr.dataset[key] ?? '');
      [...usersTbody.querySelectorAll('tr')]
        .sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'asc' ? 1 : -1); })
        .forEach((tr) => usersTbody.appendChild(tr));
    });
  });

  // Platform filter — hides non-matching rows (sorting keeps working on the
  // full set; hidden rows simply stay hidden wherever they land).
  document.querySelectorAll('.pf-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pf-filter').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const pf = btn.dataset.pf;
      usersTbody.querySelectorAll('tr').forEach((tr) => {
        tr.style.display = (!pf || tr.dataset.platform === pf) ? '' : 'none';
      });
    });
  });
</script>`
}

function renderHtml({ sources: stats, oldestHour }: StatsResponse, topUsers: TopUser[]): string {
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

  const fmtMs = (v: number | null) => v != null ? `${fmt(v)} ms` : "–"

  const rows = entries.map(({ id, s }: { id: string; s: SourceStats }) => {
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
        <td style="padding:12px 16px;text-align:right;color:#9ca3af">${fmtMs(s.minMs)}</td>
        <td style="padding:12px 16px;text-align:right;color:#9ca3af">${fmtMs(s.avgMs)}</td>
        <td style="padding:12px 16px;text-align:right;color:#9ca3af">${fmtMs(s.maxMs)}</td>
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
  th.sortable { cursor: pointer; user-select: none }
  th.sortable:hover { color: #e5e7eb }
  th.sortable[data-dir="asc"]::after  { content: " ▲"; color: #6b7280 }
  th.sortable[data-dir="desc"]::after { content: " ▼"; color: #6b7280 }
  .pf-bar { display: flex; gap: 6px }
  .pf-filter { background: #1f2937; color: #9ca3af; border: 1px solid #374151; border-radius: 6px; padding: 5px 10px; font: inherit; font-size: 0.72rem; cursor: pointer; letter-spacing: 0.03em }
  .pf-filter:hover { color: #e5e7eb }
  .pf-filter.active { background: #374151; color: #e5e7eb; border-color: #4b5563 }
  .comment-input { width: 100%; min-width: 160px; background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; padding: 6px 8px; font: inherit; font-size: 0.8rem }
  .comment-input:focus { outline: none; border-color: #6b7280 }
  .comment-input.saved { border-color: #10b981 }
  .comment-input.save-error { border-color: #ef4444 }
  .section-footer { margin-top: 16px; display: flex; justify-content: space-between; align-items: center; gap: 16px }
  .section-footer .legend { margin-top: 0 }
  .reset-btn { background: #7f1d1d; color: #fca5a5; border: 1px solid #991b1b; border-radius: 6px; padding: 10px 18px; font: inherit; font-size: 0.8rem; cursor: pointer; letter-spacing: 0.03em }
  .reset-btn:hover { background: #991b1b; color: #fee2e2 }
</style>
</head>
<body>
<h1>♿ Adapter Stats Dashboard</h1>
<p class="subtitle">Last updated: ${now} &nbsp;·&nbsp; 90-day window &nbsp;·&nbsp; hourly granularity${oldestHour ? (() => { const days = Math.max(1, Math.round((Date.now() - new Date(oldestHour.replace("T", " ") + ":00:00Z").getTime()) / 86_400_000)); return ` &nbsp;·&nbsp; Since: ${formatHour(oldestHour)} (${days} day${days !== 1 ? "s" : ""})`; })() : ""}</p>

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
    <div class="kpi-value">${entries.length} / ${SOURCE_ORDER.length}</div>
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
        <th>Min (ms)</th>
        <th>Avg (ms)</th>
        <th>Max (ms)</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>
`}

<div class="section-footer">
  <div class="legend">
    <span class="leg"><span class="dot" style="background:#10b981"></span>&lt; 1 % — OK</span>
    <span class="leg"><span class="dot" style="background:#f59e0b"></span>1–5 % — Elevated</span>
    <span class="leg"><span class="dot" style="background:#ef4444"></span>&gt; 5 % — Critical</span>
  </div>
  <button class="reset-btn" onclick="
    if (!confirm('Permanently delete all ADAPTER statistics?\\n\\nUser stats are kept. This cannot be undone.')) return;
    const token = new URLSearchParams(location.search).get('token') ?? '';
    fetch('/api/stats?token=' + encodeURIComponent(token), { method: 'DELETE' })
      .then(r => r.json())
      .then(d => { alert(d.deleted + ' keys deleted.'); location.reload(); })
      .catch(() => alert('Reset failed.'));
  ">Reset adapter stats</button>
</div>

${renderTopUsers(topUsers)}
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

  const [stats, topUsers] = await Promise.all([getStats(), getTopUsers(50)])

  if (req.nextUrl.searchParams.get("format") === "html") {
    return new Response(renderHtml(stats, topUsers), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    })
  }

  return NextResponse.json({ ok: true, ...stats, topUsers }, {
    headers: { "Cache-Control": "no-store" },
  })
}

// Save an operator comment on a top-users row: { uid, comment }. An empty
// comment clears the field. 404 when the user hash has expired in the meantime.
export async function PATCH(req: NextRequest): Promise<Response> {
  const secret = process.env.HEALTH_CHECK_SECRET
  if (!secret) return NextResponse.json({ ok: false, error: "Stats endpoint not configured" }, { status: 503 })
  const token = req.nextUrl.searchParams.get("token") ?? ""
  if (!safeEqual(token, secret)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  if (!process.env.KV_REST_API_URL) return NextResponse.json({ ok: false, error: "KV not configured" }, { status: 503 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 })
  }

  const updated = await setUserComment(body.uid, body.comment)
  if (!updated) return NextResponse.json({ ok: false, error: "Unknown user or invalid input" }, { status: 404 })
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const secret = process.env.HEALTH_CHECK_SECRET
  if (!secret) return NextResponse.json({ ok: false, error: "Stats endpoint not configured" }, { status: 503 })
  const token = req.nextUrl.searchParams.get("token") ?? ""
  if (!safeEqual(token, secret)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  if (!process.env.KV_REST_API_URL) return NextResponse.json({ ok: false, error: "KV not configured" }, { status: 503 })
  // ?target=users clears only the anonymous user stats; default clears only
  // the adapter stats — the two datasets are reset independently.
  const deleted = req.nextUrl.searchParams.get("target") === "users"
    ? await resetUserStats()
    : await resetStats()
  return NextResponse.json({ ok: true, deleted }, { headers: { "Cache-Control": "no-store" } })
}
