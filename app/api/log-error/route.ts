import { NextRequest, NextResponse } from "next/server"

const WINDOW_MS  = 60_000
const MAX_PER_IP = 5

const ipWindows = new Map<string, number[]>()

function isRateLimited(ip: string): boolean {
  const now    = Date.now()
  const cutoff = now - WINDOW_MS
  const times  = (ipWindows.get(ip) ?? []).filter((t) => t > cutoff)
  times.push(now)
  ipWindows.set(ip, times)
  return times.length > MAX_PER_IP
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  if (isRateLimited(ip)) return new NextResponse(null, { status: 429 })

  try {
    const body = await req.json()
    const message: string = typeof body.message === "string" ? body.message.slice(0, 500)  : "unknown"
    const stack:   string = typeof body.stack   === "string" ? body.stack.slice(0, 2000)   : ""
    const context: string = typeof body.context === "string" ? body.context.slice(0, 200)  : ""

    console.error("[client-error]", JSON.stringify({ message, stack, context, ip }))
  } catch {
    // ignore malformed body
  }

  return new NextResponse(null, { status: 204 })
}
