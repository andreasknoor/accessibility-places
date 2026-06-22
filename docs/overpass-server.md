# Private Overpass server (Hetzner) — Ops Runbook

Self-hosted Overpass API for DACH at `overpass.accessible-places.org` (Caddy → Docker on Hetzner CX33, x86 Intel Xeon, 8 GB RAM). Eliminates public-mirror rate limits and reduces latency from 2–15 s to ~50–200 ms.

**Server:** `65.109.1.63` — `ssh root@overpass.accessible-places.org`

**Docker container:** `overpass` — image `wiktorn/overpass-api`, data at `/overpass-data:/db`, port 8080 → Caddy → HTTPS.

The server is shared with the self-hosted GlitchTip instance (`logs.accessible-places.org`, see `docs/glitchtip-setup.md`).

## Critical Docker env vars

Wrong defaults cause failures under load:

| Variable | Production value | Why |
|---|---|---|
| `OVERPASS_RATE_LIMIT` | `32` | Default 4–8; "slots occupied" HTML at peak |
| `OVERPASS_SPACE` | `6442450944` | Default 512 MB; CX33 has 8 GB |
| `OVERPASS_TIME` | `300` | Default 1000 s; queries use `[timeout:12]` anyway |
| `OVERPASS_ALLOW_DUPLICATE_QUERIES` | `yes` | Default `no` rejects identical concurrent queries immediately with HTML 200 — primary cause of load-test failures |
| `OVERPASS_HEALTHCHECK` | see below | Default healthcheck query has **no `[timeout:]`** — those queries hang ~15 s and 504 at the gateway, marking the container `(unhealthy)` even while real traffic is fine (the OSM adapter always sends `[timeout:12]`). Override to add `[timeout:5]` so the flag reflects real availability. |

## Restart command

E.g. after config change:

```bash
docker stop overpass && docker rm overpass
docker run -d --name overpass --restart always -p 8080:80 \
  -v /overpass-data:/db \
  -e OVERPASS_META=yes \
  -e OVERPASS_MODE=clone \
  -e OVERPASS_REPLICATION_URL=https://download.geofabrik.de/europe/dach-updates/ \
  -e OVERPASS_DIFF_URL=https://download.geofabrik.de/europe/dach-updates/ \
  -e OVERPASS_REPLICATION_DELAY=3600 \
  -e OVERPASS_USE_AREAS=true \
  -e OVERPASS_RULES_LOAD=1 \
  -e OVERPASS_ALLOW_DUPLICATE_QUERIES=yes \
  -e OVERPASS_RATE_LIMIT=32 \
  -e OVERPASS_SPACE=6442450944 \
  -e OVERPASS_TIME=300 \
  -e 'OVERPASS_HEALTHCHECK=curl --noproxy "*" -qf "http://localhost/api/interpreter?data=\[out:json\]\[timeout:5\];node(${NODE_ID});out;" | jq ".generator" | grep -q Overpass || exit 1' \
  wiktorn/overpass-api
```

(`${NODE_ID}` stays literal — the in-container healthcheck script sets it; single-quote the `-e` arg so the host shell doesn't expand it. A ready-to-run copy of this exact command lives at `/root/restart-overpass.sh` on the server.)

## Healthcheck note

The bare default query `node(1);out;` (no `[timeout:]`) deterministically 504s on this server — a query-shape quirk, not load. The override above clears the `(unhealthy)` false alarm. Don't infer load from the health flag alone; check `uptime`, `docker stats`, and `/api/status` slot count instead.

## Critical after any fresh container start

The `update_overpass` supervisor process runs as `user=overpass` (uid=1000 inside the container). The host volume `/overpass-data` must be owned by uid=1000; otherwise the replication script cannot create `/db/replicate_id.backup` and loops with `Permission denied`. Fix: `chown 1000:1000 /overpass-data` on the host. Also, `OVERPASS_DIFF_URL` is what the `update_overpass` script reads for ongoing diff updates — `OVERPASS_REPLICATION_URL` is used only for the initial clone. Both must point to the same URL.

## If replication stopped

(Data timestamp stops advancing): check `docker logs overpass` for `OVERPASS_DIFF_URL is not set` (wrong env var name) or `replicate_id` missing/wrong permissions. Bootstrap the sequence file with:

```bash
docker exec overpass /app/venv/bin/pyosmium-get-changes \
  --server https://download.geofabrik.de/europe/dach-updates/ \
  -D <TIMESTAMP> -f /db/replicate_id
```

where `<TIMESTAMP>` is the OSM base timestamp from `/api/status`.

## Overpass HTML 200 responses

When the daemon is overloaded it returns `Content-Type: text/html` with HTTP 200 (not 5xx). The OSM adapter guard (`res.headers?.get("content-type")`) detects this and rejects the endpoint so the parallel race falls through to the public mirrors.

## Restricting access with a shared-secret header (optional)

By default the Overpass API has **no authentication** — anyone who knows the URL
(`overpass.accessible-places.org`) can POST queries and consume the server. To lock
it to this app only, the OSM adapter can send a shared-secret header
(`X-AP-Key`) that Caddy enforces. The adapter attaches it **only** to the private
endpoint (never to public mirrors — that would leak the secret) and **only** when
`OVERPASS_PRIVATE_KEY` is set (`overpassHeaders()` in `lib/adapters/osm.ts`), so the
app code is inert until you opt in.

**Lockout-free rollout order** (never reject what the app already sends):

1. App code is deployed (header sending is inert while `OVERPASS_PRIVATE_KEY` is unset).
2. Set `OVERPASS_PRIVATE_KEY` in Vercel **Production** → redeploy. Every prod request
   now carries `X-AP-Key`; Caddy still ignores it → no change yet.
3. **Only then** add the Caddy rule below. Outsiders (no header) get 403; the app
   passes. Rollback = remove the rule (server is open again).

Safety net: even if step 3 is misconfigured, the OSM adapter's `Promise.any` race
falls through to the public mirror (`overpass-api.de`) — the app degrades to slower,
never down.

**Testing on a branch without touching live:** set `OVERPASS_PRIVATE_KEY` (and
optionally `OVERPASS_ENDPOINTS`) in Vercel's **Preview** scope only, so only branch
previews send the header. To test enforcement, add a *separate* Caddy block on a test
subdomain proxying the same container, and point the preview's `OVERPASS_ENDPOINTS` at
it — the live `overpass.accessible-places.org` path stays open until you migrate the
rule there.

Caddy (enforce on the live host, step 3):

```
overpass.accessible-places.org {
  @noauth not header X-AP-Key "DEIN_SECRET"
  respond @noauth 403
  reverse_proxy localhost:8080
}
```
