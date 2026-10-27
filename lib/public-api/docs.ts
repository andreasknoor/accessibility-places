import {
  API_ONLY_CATEGORIES, DEFAULT_NEARBY_CATEGORIES, NEARBY_TOILET_MAX_RADIUS_M, RATE_LIMIT_PER_MINUTE,
} from "./constants"

export const API_BASE = "https://accessible-places.org/api/v1"

// Plain-markdown usage guide served at GET /api/v1/docs — written for an LLM
// agent that can only issue HTTPS GET requests.
export function docsMarkdown(): string {
  return `# Accessible Places — Public API v1

Read-only JSON API for wheelchair accessibility of venues in Germany, Austria
and Switzerland (DACH). Data: OpenStreetMap and Ginto, merged by the
Accessible Places app (https://accessible-places.org).

Base URL: ${API_BASE}
OpenAPI 3.1 spec: ${API_BASE}/openapi.json

## Access
Every data endpoint needs an access token as a query parameter:
\`?token=<YOUR_TOKEN>\`. Headers are not supported. Missing or wrong token → 401.
Rate limit: ${RATE_LIMIT_PER_MINUTE} requests/minute per IP (429 + Retry-After when exceeded).
Plain GET requests, no JavaScript, no cookies. Responses are JSON.

## Endpoints

### 1. Find a venue by name — GET /places/lookup
Params: \`name\` (required), \`city\`, \`address\`, \`lat\`+\`lon\` (to disambiguate), \`limit\` (1–10, default 5).
Returns the best matches with \`match_score\` (0–1), highest first.
  ${API_BASE}/places/lookup?name=Deutsches%20Technikmuseum&city=Berlin&token=TOKEN
  ${API_BASE}/places/lookup?name=Schloss%20Sanssouci&city=Potsdam&token=TOKEN

match_score = 0.6·name similarity + 0.25·proximity to the geocoded candidate
(1 at the point, 0 at 500 m) + 0.15·city match. Treat < 0.6 as "probably not
the venue you meant".

### 2. Venues near a point — GET /places/nearby
Params: \`lat\`, \`lon\` (required), \`radius\` metres (1–5000, default 1000),
\`category\` (comma-separated), \`wheelchair\` (comma-separated filter: yes, limited, no, unknown),
\`limit\` (1–50, default 20). Sorted by distance (\`distance_m\`).
  ${API_BASE}/places/nearby?lat=52.5096&lon=13.3700&radius=800&category=museum,concert_hall&token=TOKEN
Categories: all app categories (e.g. museum, theatre, cinema, gallery, park, zoo,
attraction, library, restaurant, cafe, hotel …) plus ${API_ONLY_CATEGORIES.join(", ")}.
Default without \`category\`: ${DEFAULT_NEARBY_CATEGORIES.join(", ")}.
A venue matches every category it belongs to (the Berlin Philharmonie is both
\`theatre\` and \`concert_hall\`; its \`category\` field shows the most specific one).

### 3. Wheelchair toilets near a point — GET /toilets/nearby
Params: \`lat\`, \`lon\` (required), \`radius\` metres (1–500, default 100).
Public toilets (amenity=toilets with wheelchair=yes|designated) and venues with
toilets:wheelchair=yes|designated (private/no-access excluded), nearest first.
Fields: \`distance_m\`, \`kind\` (standalone | venue), \`wheelchair\` (designated | yes),
\`euro_key\` (true = needs a EURO key, null = not tagged), \`fee\`, \`opening_hours\`, \`access\`.
  ${API_BASE}/toilets/nearby?lat=52.5096&lon=13.3700&radius=100&token=TOKEN

### 4. One venue — GET /places/{id}
\`id\` = osm:node:<n> | osm:way:<n> | osm:relation:<n> (the \`id\` from other responses).
  ${API_BASE}/places/osm:way:31622818?token=TOKEN

## Place fields
- \`accessibility.wheelchair\`: yes | limited | no | unknown — whole-venue / entrance access.
- \`accessibility.entrance_step_free\`: yes | no | unknown — from step_count / ramp tags of
  the venue or its OSM entrance nodes (lookup + detail only; nearby uses venue tags).
- \`accessibility.elevator\`: yes | no | unknown — elevator tags or highway=elevator nodes
  inside the building (lookup + detail only).
- \`accessibility.toilet_wheelchair\`: yes | limited | no | unknown.
- \`accessibility.nearest_wheelchair_toilet_m\`: metres to the nearest wheelchair toilet
  within 500 m (same data as /toilets/nearby); 0 when the venue itself has one
  (toilet_wheelchair = yes); null when none was found — or not computed (then a
  \`warnings\` entry says so; /places/nearby computes it only for radius ≤ ${NEARBY_TOILET_MAX_RADIUS_M} m).
- \`accessibility.parking_disabled\`: yes | limited | no | unknown. When the venue has no
  parking data of its own but a reserved disabled parking space exists within ~150 m,
  this is "yes" and \`parking_disabled_nearby_m\` gives the distance.
- \`accessibility.surface_notes\`, \`accessibility.description\`: OSM surface tags and the
  free-text wheelchair:description, if tagged.
- \`field_sources\`: which source(s) each field came from. Empty = no data. Values are never
  guessed: anything without evidence is "unknown" or null.
- \`sources[]\`: per source the fields it supplied, \`last_verified\` (OSM check_date) and
  \`last_updated\` (Ginto record update), plus a link.

## Conflicts
When sources disagree, the field holds the MOST CONSERVATIVE value
(no < limited < yes) and \`conflicts[]\` lists every source's value.

## Confidence
\`confidence\` (for \`wheelchair\`) and \`field_confidence\` (per field):
- high: an audited/certified entry (Ginto AUDITED) or 2+ agreeing independent sources
  (summed source weight ≥ 1.0; weights OSM 0.75, Ginto 0.90, Ginto audited 1.0)
- medium: one solid source (summed weight ≥ 0.70, e.g. OSM alone)
- low: weaker evidence, no data, or any conflict between sources
These are the same tiers the app shows as "bestätigt / wahrscheinlich / unsicher".

## Partial results, errors, caching
- If a source times out (8 s), you still get results plus \`warnings[]\`. Treat a
  response with warnings as possibly incomplete.
- Errors: \`{ "error": { "code": "...", "message": "..." } }\` with HTTP 400
  (invalid_parameter), 401 (unauthorized), 404 (not_found), 429 (rate_limited),
  502 (upstream_unavailable), 503 (not_configured).
- Complete responses are cached for 24 h; responses with warnings for 5 min.
- Coverage: DACH only. Coordinates outside → 400.

## License
Responses are a database derived from OpenStreetMap (and Ginto), licensed under
the ODbL 1.0. Keep the \`attribution\` lines when you republish data.
`
}
