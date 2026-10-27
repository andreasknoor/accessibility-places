import type { NextRequest } from "next/server"
import { handleNearby, corsPreflight } from "@/lib/public-api/handlers"

// Public read-only API — see lib/public-api/ and docs/public-api.md.
export function GET(req: NextRequest) {
  return handleNearby(req)
}

export function OPTIONS() {
  return corsPreflight()
}
