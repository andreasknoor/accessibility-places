import { openApiSpec } from "@/lib/public-api/openapi"

// OpenAPI 3.1 spec of the public API. Public (no token): it holds no data.
export function GET() {
  return Response.json(openApiSpec(), {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, s-maxage=86400" },
  })
}
