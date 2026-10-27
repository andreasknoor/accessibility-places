import { API_BASE } from "./docs"
import { API_VERSION } from "./constants"
import { API_CATEGORIES } from "./schemas"

const A11Y = { type: "string", enum: ["yes", "limited", "no", "unknown"] }
const YNU  = { type: "string", enum: ["yes", "no", "unknown"] }
const SRC  = { type: "array", items: { type: "string", enum: ["osm", "ginto"] } }
const CONF = { type: "string", enum: ["high", "medium", "low"] }
const NUM_OR_NULL = { type: ["number", "null"] }
const STR_OR_NULL = { type: ["string", "null"] }

const tokenParam = { name: "token", in: "query", required: true, schema: { type: "string" }, description: "Access token." }
const q = (name: string, schema: object, description: string, required = false) =>
  ({ name, in: "query", required, schema, description })

const envelope = (results: object) => ({
  type: "object",
  required: ["api_version", "license", "attribution", "generated_at", "warnings"],
  properties: {
    api_version:  { type: "string" },
    license:      { type: "string", const: "ODbL-1.0" },
    attribution:  { type: "array", items: { type: "string" } },
    generated_at: { type: "string", format: "date-time" },
    query:        { type: "object" },
    count:        { type: "integer" },
    ...results,
    warnings:     { type: "array", items: { $ref: "#/components/schemas/Warning" } },
  },
})

const errors = {
  "400": { $ref: "#/components/responses/Error" },
  "401": { $ref: "#/components/responses/Error" },
  "429": { $ref: "#/components/responses/Error" },
  "502": { $ref: "#/components/responses/Error" },
  "503": { $ref: "#/components/responses/Error" },
}

const fieldSourceKeys = [
  "wheelchair", "entrance_step_free", "elevator", "toilet_wheelchair", "nearest_wheelchair_toilet_m",
  "parking_disabled", "parking_disabled_nearby_m", "surface_notes", "description",
]

export function openApiSpec(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title:       "Accessible Places Public API",
      version:     API_VERSION,
      description: `Read-only wheelchair-accessibility data for venues in DACH (OpenStreetMap + Ginto, ODbL). Usage guide: ${API_BASE}/docs`,
      license:     { name: "ODbL-1.0 (data)", url: "https://opendatacommons.org/licenses/odbl/1-0/" },
    },
    servers: [{ url: API_BASE }],
    paths: {
      "/places/lookup": {
        get: {
          summary: "Find a venue by name (optionally narrowed by city, address or coordinates)",
          parameters: [
            q("name", { type: "string", minLength: 2, maxLength: 100 }, "Venue name.", true),
            q("city", { type: "string" }, "City."),
            q("address", { type: "string" }, "Street address."),
            q("lat", { type: "number" }, "Latitude (with lon) to disambiguate."),
            q("lon", { type: "number" }, "Longitude (with lat)."),
            q("limit", { type: "integer", minimum: 1, maximum: 10, default: 5 }, "Max results."),
            tokenParam,
          ],
          responses: { "200": { description: "Matches, best first.", content: { "application/json": { schema: envelope({ results: { type: "array", items: { $ref: "#/components/schemas/Place" } } }) } } }, ...errors },
        },
      },
      "/places/nearby": {
        get: {
          summary: "Venues near a point",
          parameters: [
            q("lat", { type: "number" }, "Latitude.", true),
            q("lon", { type: "number" }, "Longitude.", true),
            q("radius", { type: "integer", minimum: 1, maximum: 5000, default: 1000 }, "Radius in metres."),
            q("category", { type: "string" }, `Comma-separated: ${API_CATEGORIES.join(", ")}.`),
            q("wheelchair", { type: "string" }, "Comma-separated filter: yes, limited, no, unknown."),
            q("limit", { type: "integer", minimum: 1, maximum: 50, default: 20 }, "Max results."),
            tokenParam,
          ],
          responses: { "200": { description: "Venues, nearest first.", content: { "application/json": { schema: envelope({ results: { type: "array", items: { $ref: "#/components/schemas/Place" } } }) } } }, ...errors },
        },
      },
      "/toilets/nearby": {
        get: {
          summary: "Wheelchair-accessible toilets near a point",
          parameters: [
            q("lat", { type: "number" }, "Latitude.", true),
            q("lon", { type: "number" }, "Longitude.", true),
            q("radius", { type: "integer", minimum: 1, maximum: 500, default: 100 }, "Radius in metres."),
            tokenParam,
          ],
          responses: { "200": { description: "Toilets, nearest first.", content: { "application/json": { schema: envelope({ results: { type: "array", items: { $ref: "#/components/schemas/Toilet" } } }) } } }, ...errors },
        },
      },
      "/places/{id}": {
        get: {
          summary: "One venue by OSM id",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^osm:(node|way|relation):\\d+$" }, description: "e.g. osm:way:31622818" },
            tokenParam,
          ],
          responses: {
            "200": { description: "The venue.", content: { "application/json": { schema: envelope({ result: { $ref: "#/components/schemas/Place" } }) } } },
            "404": { $ref: "#/components/responses/Error" },
            ...errors,
          },
        },
      },
    },
    components: {
      responses: {
        Error: {
          description: "Error",
          content: { "application/json": { schema: {
            type: "object",
            properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } },
          } } },
        },
      },
      schemas: {
        Warning: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
        Place: {
          type: "object",
          properties: {
            id:          { type: "string", examples: ["osm:way:31622818"] },
            name:        { type: "string" },
            category:    { type: "string" },
            address:     { type: "object", properties: { street: STR_OR_NULL, postcode: STR_OR_NULL, city: STR_OR_NULL } },
            location:    { type: "object", properties: { lat: { type: "number" }, lon: { type: "number" } } },
            distance_m:  { type: "integer", description: "/places/nearby only" },
            match_score: { type: "number", minimum: 0, maximum: 1, description: "/places/lookup only" },
            accessibility: {
              type: "object",
              properties: {
                wheelchair: A11Y, entrance_step_free: YNU, elevator: YNU, toilet_wheelchair: A11Y,
                nearest_wheelchair_toilet_m: NUM_OR_NULL, parking_disabled: A11Y,
                parking_disabled_nearby_m: NUM_OR_NULL, surface_notes: STR_OR_NULL, description: STR_OR_NULL,
              },
            },
            field_sources:    { type: "object", properties: Object.fromEntries(fieldSourceKeys.map((k) => [k, SRC])) },
            field_confidence: { type: "object", properties: { wheelchair: CONF, toilet_wheelchair: CONF, parking_disabled: CONF } },
            sources: {
              type: "array",
              items: { type: "object", properties: {
                source: { type: "string", enum: ["osm", "ginto"] }, source_ref: { type: "string" },
                fields: { type: "array", items: { type: "string" } },
                last_verified: STR_OR_NULL, last_updated: STR_OR_NULL, url: STR_OR_NULL,
              } },
            },
            conflicts: {
              type: "array",
              items: { type: "object", properties: {
                field: { type: "string" },
                values: { type: "array", items: { type: "object", properties: { source: { type: "string" }, value: { type: "string" } } } },
                resolution: { type: "string", const: "most_conservative" },
                resolved: { type: "string" },
              } },
            },
            confidence: CONF,
            links: { type: "object", properties: { website: STR_OR_NULL, osm: STR_OR_NULL, ginto: STR_OR_NULL } },
          },
        },
        Toilet: {
          type: "object",
          properties: {
            id: STR_OR_NULL, kind: { type: "string", enum: ["standalone", "venue"] }, name: STR_OR_NULL,
            location: { type: "object", properties: { lat: { type: "number" }, lon: { type: "number" } } },
            distance_m: { type: "integer" }, wheelchair: { type: "string", enum: ["designated", "yes"] },
            euro_key: { type: ["boolean", "null"] }, fee: STR_OR_NULL, opening_hours: STR_OR_NULL,
            access: STR_OR_NULL, changing_table: { type: ["boolean", "null"] },
            links: { type: "object", properties: { osm: STR_OR_NULL } },
          },
        },
      },
    },
  }
}
