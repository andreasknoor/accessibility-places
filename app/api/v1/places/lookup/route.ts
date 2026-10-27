import type { NextRequest } from "next/server"
import { handleLookup, corsPreflight } from "@/lib/public-api/handlers"

// Public read-only API — see lib/public-api/ and docs/public-api.md.
export function GET(req: NextRequest) {
  return handleLookup(req)
}

export function OPTIONS() {
  return corsPreflight()
}
