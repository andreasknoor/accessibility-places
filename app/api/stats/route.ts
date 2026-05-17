import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual }           from "crypto"
import { getStats }                  from "@/lib/stats"

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.HEALTH_CHECK_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: "Stats endpoint not configured" }, { status: 503 })
  }
  const token = req.nextUrl.searchParams.get("token") ?? ""
  if (!safeEqual(token, secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  if (!process.env.KV_REST_API_URL) {
    return NextResponse.json({ ok: false, error: "KV not configured" }, { status: 503 })
  }

  const stats = await getStats()

  return NextResponse.json({ ok: true, stats }, {
    headers: { "Cache-Control": "no-store" },
  })
}
