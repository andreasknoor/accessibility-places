# Top users in the adapter stats dashboard (Top 50)

Status: implemented in v9.20 (2026-07-02) — see `lib/user-id.ts`,
`lib/user-stats.ts`, and the "Top 20 Users" section in `/api/stats?format=html`

Goal: recognise the most active users (by search count) in the `/api/stats`
dashboard, fully anonymous/privacy-preserving, so a later phase can target
them (e.g. show a questionnaire to heavy users).

## Decisions (made 2026-07-02)

| Question | Decision |
|---|---|
| ID scheme | Random `crypto.randomUUID()` in `localStorage` (`ap_uid`). **Not** a hash of device properties — that would be fingerprinting. |
| Legal basis | Opt-out + transparency: ID created by default, privacy policy extended, visible settings toggle "Anonyme Nutzungsstatistik" (off ⇒ delete `ap_uid`, stop sending). Formally § 25 TDDDG wants consent — accepted risk given the minimal data. |
| What counts as a search | **All** searches: venue searches (`/api/search`) **and** amenity searches (`/api/nearby-parking`). |
| Retention | 180 days TTL, refreshed on every write (auto-forget for inactive users). |
| Local counter | Yes — `ap_search_count` in `localStorage`, incremented in parallel, so the future questionnaire can trigger purely client-side ("after N searches"). |

## Data model

Stored per user (nothing else — no IP, no query strings, no coordinates):

- `users:by_searches` — Redis **sorted set**; `ZINCRBY 1 <uid>` per search.
  Top-N = one `ZREVRANGE … WITHSCORES` (dashboard reads the top 50).
- `user:<uid>` — Redis **hash**: `firstSeen` (`YYYY-MM-DD`, day granularity
  only — data minimisation), `lastSeen`, `platform` (`ios` | `android` | `web`,
  from the same detection as `lib/analytics.ts`).
- TTL 180 days on `user:<uid>`, refreshed on write. The sorted set needs
  periodic pruning of members whose hash expired (lazy: prune during the
  dashboard read — drop members with a missing `user:<uid>` hash and `ZREM`
  them, so the set cannot grow unboundedly).

## Client side

- `lib/user-id.ts` — `getUserId(): string | null`: returns `ap_uid`, creating
  it on first call; returns `null` when the settings toggle is off. Also
  `incrementLocalSearchCount()` for `ap_search_count`.
- The uid + platform ride along in the existing POST bodies of `/api/search`
  and `/api/nearby-parking` (no extra request, existing rate limits apply).
  `/api/nearby-parking` is currently GET — the uid goes into a query param or
  the route gains POST support; decide at implementation time.
- Settings (`lib/settings.ts` + `SettingsSheet`): new `usageStats: boolean`
  (default `true`). Turning it off deletes `ap_uid` + `ap_search_count` and
  stops sending. i18n DE+EN for label + explanation.

## Server side

- `lib/stats.ts` (or a sibling `lib/user-stats.ts`): `trackUserSearch(uid,
  platform)` — fire-and-forget like `trackCall()`; pipeline of `ZINCRBY`,
  `HSET firstSeen` (NX semantics: only set if absent), `HSET lastSeen/platform`,
  `EXPIRE`.
- **Validation**: uid must match the UUID regex, platform must be one of the
  three literals — otherwise drop silently. This is the XSS guard for the
  HTML dashboard and keeps garbage out of the sorted set.
- **Placement**: only in the `/api/search` and `/api/nearby-parking` route
  handlers — never in `fetchAllSources` (SEO ISR renders must not count as
  users; same rule as the existing stats invariants).

## Dashboard

New section in the `/api/stats` HTML: "Top 20 Users" table with shortened
uid (`a3f9c2…`), search count, first seen, last seen, platform badge.
Read path: `ZREVRANGE` + pipelined `HGETALL`, with the lazy pruning above.

## Privacy checklist (implementation gates)

- [x] Privacy policy (`/datenschutz` + `/en/privacy`): new section describing
      the random ID, what is stored, retention, and the opt-out.
- [x] Settings toggle wired and honoured on both tracking points.
- [x] No PII anywhere in the payload or Redis values.
- [x] uid validation server-side (UUID regex + platform whitelist).
- [x] TTL + lazy ZSET pruning (unit-tested; verify against live Redis after deploy).
