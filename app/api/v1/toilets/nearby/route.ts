import type { NextRequest } from "next/server"
import { handleToilets, corsPreflight } from "@/lib/public-api/handlers"

// Public read-only API — see lib/public-api/ and docs/public-api.md.
export function GET(req: NextRequest) {
  return handleToilets(req)
}

export function OPTIONS() {
  return corsPreflight()
}
