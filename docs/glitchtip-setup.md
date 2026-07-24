# Self-Hosting GlitchTip (Error Tracking)

Step-by-step runbook for running a self-hosted [GlitchTip](https://glitchtip.com)
instance — a Sentry-API-compatible open-source error tracker — on the existing
Hetzner server, co-located with the Overpass container.

**Why GlitchTip:** Vercel's free plan keeps function logs for only ~1 hour.
GlitchTip gives durable, searchable error history (jump to any timestamp days
later), error-rate stats per hour/day, and captures **both** client- and
server-side errors through a single `@sentry/nextjs` SDK pointed at our own DSN.
Data stays on our EU box (GDPR), with no event quota.

## Target host (verified 2026-06-03)

| | |
|---|---|
| Host | `ubuntu-8gb-akn-1` — Hetzner CX33, x86_64 Intel Xeon Skylake |
| Resources | 4 vCPU, 8 GB RAM, 80 GB disk, Helsinki |
| IP | `65.109.1.63` (`ssh root@overpass.accessible-places.org`) |
| Already running | Overpass (Docker) + Caddy (reverse proxy, auto-TLS) |
| Headroom | CPU idle; ~27 GB disk free; **no swap** |

> **Note:** the project's CLAUDE.md still describes this box as a CAX21/ARM
> machine — that is outdated. It is an x86 Intel host, and Overpass runs on it.

### Co-location risks (read before starting)

GlitchTip shares the box with the latency-critical Overpass server. Two risks,
both mitigated by the steps below:

1. **Page-cache eviction** — GlitchTip's ~1–1.5 GB RAM displaces Overpass's
   memory-mapped DACH database from the page cache, which can raise Overpass
   query latency (the private server exists to deliver 50–200 ms). We cap
   GlitchTip's memory and measure Overpass afterwards.
2. **No swap = hard OOM** — on a swapless 8 GB box, a GlitchTip migration /
   Celery spike / Postgres `VACUUM` could trip the OOM killer and take down
   **Overpass**. Phase 1 adds a swapfile as a safety net.

---

## Phase 0 — DNS: add `logs.accessible-places.org` in Vercel

Our domain's DNS is managed by Vercel (that's how `overpass.accessible-places.org`
resolves). We add an A record for the new subdomain pointing at the Hetzner IP.

1. Go to the **Vercel dashboard → your account/team → Domains** (the
   account-level Domains tab, *not* the project's Settings → Domains).
2. Click **`accessible-places.org`** to open it, then the **DNS Records** tab.
   - If the domain is **not** listed here, its nameservers aren't Vercel's — in
     that case add the A record at your registrar instead. Verify with
     `dig NS accessible-places.org +short` (should show `ns1.vercel-dns.com`
     etc.). The rest of this runbook is unaffected.
3. **Add Record:**
   | Field | Value |
   |---|---|
   | Type | `A` |
   | Name | `logs` |
   | Value | `65.109.1.63` |
   | TTL | `60` (raise later once stable) |
4. Save. Verify propagation from your laptop:
   ```bash
   dig logs.accessible-places.org +short   # → 65.109.1.63
   ```

> This is a plain DNS record, **not** a Vercel project domain — do not add it
> under the project's Domains, or Vercel will try to serve the app there.

---

## Phase 1 — Server prep: add swap

SSH in and create a 4 GB swapfile (one-time, survives reboot):

```bash
ssh root@overpass.accessible-places.org

fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Prefer keeping Overpass's pages in RAM; only swap under real pressure
sysctl -w vm.swappiness=10
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf

free -h   # confirm: Swap now shows 4.0Gi
```

---

## Phase 2 — GlitchTip stack (Docker Compose)

```bash
mkdir -p /opt/glitchtip && cd /opt/glitchtip
```

### `.env`

Generate a secret key and write the env file:

```bash
SECRET=$(openssl rand -hex 32)
cat > /opt/glitchtip/.env <<EOF
SECRET_KEY=${SECRET}
GLITCHTIP_DOMAIN=https://logs.accessible-places.org
DEFAULT_FROM_EMAIL=noreply@accessible-places.org
# Disable open sign-up after you create the first (admin) user — see Phase 4
ENABLE_OPEN_USER_REGISTRATION=true
# Retention: events older than this are purged (keeps Postgres small)
GLITCHTIP_MAX_EVENT_LIFE_DAYS=90
# Email is optional; console backend just logs invites/alerts. For real
# alert emails set e.g. EMAIL_URL=smtp://user:pass@smtp.example.com:587
EMAIL_URL=consolemail://
CELERY_WORKER_CONCURRENCY=2
EOF
chmod 600 /opt/glitchtip/.env
```

### `docker-compose.yml`

Note the **`mem_limit`** entries — they are the cap that protects Overpass.
Total ceiling ≈ 1.8 GB.

```yaml
services:
  postgres:
    image: postgres:17-alpine
    restart: always
    environment:
      POSTGRES_HOST_AUTH_METHOD: trust
    volumes:
      - pg-data:/var/lib/postgresql/data
    # Keep Postgres cache small so it doesn't fight Overpass for page cache
    command: postgres -c shared_buffers=192MB -c max_connections=50
    mem_limit: 512m

  redis:
    image: valkey/valkey:8-alpine
    restart: always
    mem_limit: 128m

  web:
    image: glitchtip/glitchtip:latest
    restart: always
    depends_on: [postgres, redis]
    env_file: .env
    environment:
      DATABASE_URL: postgres://postgres@postgres:5432/postgres
      REDIS_URL: redis://redis:6379/0
      PORT: "8000"
    # Bind to loopback only — Caddy terminates TLS and proxies in
    ports:
      - "127.0.0.1:8000:8000"
    mem_limit: 768m

  worker:
    image: glitchtip/glitchtip:latest
    restart: always
    depends_on: [postgres, redis]
    env_file: .env
    environment:
      DATABASE_URL: postgres://postgres@postgres:5432/postgres
      REDIS_URL: redis://redis:6379/0
    command: ./bin/run-celery-with-beat.sh
    mem_limit: 512m

  migrate:
    image: glitchtip/glitchtip:latest
    depends_on: [postgres]
    env_file: .env
    environment:
      DATABASE_URL: postgres://postgres@postgres:5432/postgres
      REDIS_URL: redis://redis:6379/0
    command: ./manage.py migrate
    restart: "no"

volumes:
  pg-data:
```

### Start it

```bash
cd /opt/glitchtip
docker compose run --rm migrate      # one-shot DB migration
docker compose up -d                 # postgres, redis, web, worker

docker compose ps                    # all "Up"; web healthy
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000   # → 200/302
```

---

## Phase 3 — Caddy vhost

Caddy already serves Overpass and handles Let's Encrypt automatically. Add a
second site block. Edit `/etc/caddy/Caddyfile`:

```caddyfile
logs.accessible-places.org {
	reverse_proxy 127.0.0.1:8000
}
```

Reload (zero downtime) and confirm:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
curl -sI https://logs.accessible-places.org | head -1   # → HTTP/2 200 (valid TLS)
```

---

## Phase 4 — Create the GlitchTip project & get the DSN

1. Open **https://logs.accessible-places.org** and **register** — the first user
   created becomes the admin.
2. **Lock down sign-up** so strangers can't register: set
   `ENABLE_OPEN_USER_REGISTRATION=false` in `/opt/glitchtip/.env`, then
   `docker compose up -d web worker` to apply.
3. Create an **Organization**, then a **Project** with platform
   **Next.js / JavaScript**.
4. Copy the project's **DSN** — it looks like
   `https://<key>@logs.accessible-places.org/<id>`. You'll paste it into Vercel
   in Phase 5.

---

## Phase 5 — Wire up the app (`@sentry/nextjs` → GlitchTip)

GlitchTip speaks the Sentry ingest protocol, so we use the official Sentry SDK
but point it at our DSN and turn off everything GlitchTip doesn't need (tracing,
session replay).

### 5a. Install

```bash
npm install @sentry/nextjs
```

### 5b. DSN as a Vercel env var

In **Vercel → your project → Settings → Environment Variables**, add (for
Production + Preview + Development):

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | the DSN from Phase 4 |

It must be `NEXT_PUBLIC_` so the **client** bundle can read it. (Server code
reads the same public var — fine, the DSN is not a secret.) Re-deploy after
adding, or pull locally with `vercel env pull` for dev.

### 5c. Config files

Create three small files at the repo root. Keep `tracesSampleRate: 0` and no
replay — GlitchTip is **error-only**.

`instrumentation-client.ts`:
```ts
import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,           // GlitchTip = errors only
  enabled: process.env.NODE_ENV === "production",
})
```

`instrumentation.ts` (server + edge init, plus error hook):
```ts
import * as Sentry from "@sentry/nextjs"

export async function register() {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0,
    enabled: process.env.NODE_ENV === "production",
  })
}

export const onRequestError = Sentry.captureRequestError
```

`sentry.server.config.ts` is folded into `instrumentation.ts` above on Next 16,
so you don't need a separate one.

### 5d. Wrap `next.config.ts`

At the bottom of `next.config.ts`:
```ts
import { withSentryConfig } from "@sentry/nextjs"
// ...existing config...
export default withSentryConfig(nextConfig, {
  silent: true,
  // We self-host and don't upload source maps to a SaaS; keep it minimal.
  sourcemaps: { disable: true },
})
```

> Keep `turbopack: {}` in the config — see CLAUDE.md, the production build must
> stay on Turbopack.

### 5e. ⚠️ CSP — add the GlitchTip domain (easy to forget)

The SDK POSTs events to `logs.accessible-places.org`. Without a CSP update the
browser silently blocks them. In `next.config.ts`, append the domain to
**`connect-src`** (the directive around line 31):

```diff
- "connect-src 'self' https://nominatim.openstreetmap.org ... https://www.wikidata.org https://lh3.googleusercontent.com",
+ "connect-src 'self' https://nominatim.openstreetmap.org ... https://www.wikidata.org https://lh3.googleusercontent.com https://logs.accessible-places.org",
```

### 5f. Replace the old client-error plumbing

The SDK now auto-captures client errors (unhandled exceptions, promise
rejections, React error boundaries) and server errors. So:

- The fire-and-forget `fetch("/api/log-error", …)` call in `HomeClient`'s search
  `catch` block can be replaced with `Sentry.captureException(err, { tags: { context: "search" } })`.
- `app/api/log-error/route.ts` becomes redundant — remove it once you've
  confirmed events arrive in GlitchTip, or keep it as a fallback (your call).

### 5g. (Optional) Quick win — hourly error counts in Upstash

Independently of GlitchTip, you already store hour-granularity counters in
`lib/stats.ts` (Upstash). Add a generic `error`/`warning` counter with the same
key scheme to get "errors per hour/day" trend numbers for free, surfaced via
`GET /api/stats`. This complements GlitchTip (which gives the stack traces).

### 5h. Keep event volume down

**First, the misconception to retire:** the "1,000 events/month" cap belongs to
the *hosted* glitchtip.com plan. The **self-hosted** open-source build you are
running here has **no event quota at all** — the only real limit is your own
disk and RAM, shared with Overpass. So you minimise volume for *resource and
signal-to-noise* reasons, not to satisfy a counter.

**The hard ceiling — retention.** `GLITCHTIP_MAX_EVENT_LIFE_DAYS=90` (set in
`.env`, Phase 2) auto-purges anything older, so the database plateaus instead of
growing forever. Lower it (e.g. `30`) if disk gets tight; "jump to a timestamp 2
days ago" stays satisfied either way. This is your single most effective knob.

**Three ways the event count stays small:**

1. **Automatic grouping** — GlitchTip fingerprints identical errors into one
   *issue* with an occurrence counter. 1,000 hits of the same bug show as one
   row ("1,000 events"), not 1,000 rows. Keeps the issue list readable.
2. **Filter noise before it's sent** — drop worthless browser noise (aborted
   fetches, browser-extension errors, the `ResizeObserver` loop warning) in the
   SDK config so they never leave the client.
3. **Production-only** — already set via `enabled: production`, so local dev
   errors produce nothing.

**The "context before/after" paradox — resolved.** Breadcrumbs (the trail of
"user clicked here", "this page opened", "this request ran") are **not separate
events**. The SDK keeps the trail locally and sends nothing until an error
fires; at that moment it attaches the recent breadcrumbs **to that single error
event**. So "context just before" rides *inside* the one event — it costs a few
extra bytes in that payload, **not one extra event**. There is no separate
"after" capture: if something else breaks afterwards, that's its own error
(with its own breadcrumbs), which is automatically your "after". Bottom line:
context raises per-event *size*, never event *count* — and bytes on your own
disk are cheap. Cap the trail depth with `maxBreadcrumbs` if it ever feels too
heavy.

Concrete filter config (extends the `Sentry.init` in `instrumentation-client.ts`
from step 5c):

```ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 0,          // no performance transactions → less mass
  maxBreadcrumbs: 50,           // context depth (default 100)
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "Non-Error promise rejection captured",
    "AbortError",               // aborted search requests
  ],
  beforeSend(event) {
    // last-resort place to drop e.g. browser-extension noise
    return event
  },
})
```

As a guard against a runaway loop firing the same error thousands of times:
automatic grouping (point 1) covers the UI, and you can add a simple request
rate-limit on the GlitchTip ingest path in Caddy if needed.

### 5i. Server-side captures for handled errors (#1/#2/#3)

**What the SDK auto-captures vs what it doesn't.** The instrumentation files
report only **unhandled** errors — on the client (window.onerror, unhandled
rejections, error boundaries) and on the server via `onRequestError` (errors that
propagate out of Server Components, route handlers, Server Actions, middleware).
Errors the app **catches and handles** are invisible to GlitchTip unless reported
explicitly. This app catches a lot on purpose — the `/api/search` pipeline runs
each adapter through `safeRun`, which swallows per-source failures and streams a
`source` status event instead. Those never reach GlitchTip on their own.

So we add **three targeted captures**, all at the `/api/search` **API boundary**
(`app/api/search/route.ts`) — never inside `safeRun` or the adapters, which must
stay side-effect-free so they're safe to call from ISR SEO pages (same rule as
the `trackError` stats):

| # | Trigger | Call | Level / tags |
|---|---|---|---|
| **#1** | Unhandled pipeline crash (the route's final `catch`) | `captureException(err)` — real stack | `error` · `area:search-pipeline, kind:unhandled` |
| **#2** | **All** active sources errored in one request | `captureMessage(...)` + `extra` with each source's error | `error` · `kind:all-sources-failed` |
| **#3** | An **unexpected** adapter failure (e.g. changed API contract) | `captureMessage(...)`, gated by `isExpectedAdapterError()` | `error` · `area:adapter, source:<x>, kind:unexpected` |

**The expected/unexpected split.** A single source failing with an HTTP/network
error is normal operating noise — it stays a stats-only Upstash counter
(`lib/stats.ts`, surfaced via `GET /api/stats`). Only *unexpected* failures are
reported. The classifier (a helper in `route.ts`) treats these as **expected**
(not reported):

```ts
function isExpectedAdapterError(errStr: string): boolean {
  return /\b[45]\d\d\b/.test(errStr)                                               // HTTP status, e.g. "API error: 503", "returned 429"
      || /timeout|abort|fetch failed|network|ECONN|ENOTFOUND|socket|terminated/i.test(errStr)
}
```

Everything else (e.g. `"unexpected response shape"`, a parse/TypeError) is
unexpected → reported under #3. Because `safeRun` stringifies the original Error,
#3 has no adapter stack — it carries the message + source tag instead (the
trade-off for keeping `safeRun` side-effect-free).

**Deliberately NOT captured** (expected / best-effort / would be noise): single
adapter failures in `safeRun`, `/api/nearby-parking`, the geocode autocomplete
routes (suggest/place-suggest/reverse), and `/api/health` (it is the monitor).
These stay as stats counters and/or console logs only.

**Filtering in GlitchTip.** Search by the `kind` tag — `kind:unhandled`,
`kind:all-sources-failed`, `kind:unexpected` — to triage. Use the `level` field
if you later downgrade some captures to `warning`. To distinguish expected from
unexpected centrally, you can also gate in the server `beforeSend` (in
`instrumentation.ts`) rather than at each call site.

---

## Phase 6 — Verify end-to-end

1. **Test event:** deploy, then trigger an error (e.g. a throwaway route that
   throws, or `Sentry.captureException(new Error("glitchtip smoke test"))`).
   Confirm it appears in the GlitchTip UI within seconds, with stack trace and
   timestamp.
2. **Client capture:** force a client-side error in the browser and confirm it
   lands too.
3. **Overpass latency check** (the co-location concern):
   ```bash
   ssh root@overpass.accessible-places.org 'docker stats --no-stream; free -h'
   # confirm glitchtip containers respect mem_limit, swap is present,
   # and Overpass page cache is still healthy
   ```
   Run a few real searches in the app and confirm Overpass response times are
   still in the ~50–200 ms range.
4. **Bump `APP_VERSION`** in `lib/config.ts` and run `npm test` before committing
   the app-side changes (CSP, instrumentation, config).

---

## Ongoing notes

- **Backups:** the `pg-data` volume holds all events. If you care about history,
  add a periodic `pg_dump` to your backup routine.
- **Updates:** `cd /opt/glitchtip && docker compose pull && docker compose up -d`
  — re-run `migrate` if a release needs it.
- **Disk watch:** 27 GB free is shared with Overpass's growing DACH diffs. The
  `GLITCHTIP_MAX_EVENT_LIFE_DAYS=90` retention keeps Postgres bounded; lower it
  if disk gets tight.
- **If Overpass slows down** after rollout, lower GlitchTip `mem_limit`s further
  or move the stack to a dedicated box.
