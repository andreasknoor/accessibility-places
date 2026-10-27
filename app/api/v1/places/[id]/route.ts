import type { NextRequest } from "next/server"
import { handleDetail, corsPreflight } from "@/lib/public-api/handlers"

// Public read-only API — see lib/public-api/ and docs/public-api.md.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return handleDetail(req, id)
}

export function OPTIONS() {
  return corsPreflight()
}
