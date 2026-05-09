import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json()
    const message: string = typeof body.message === "string" ? body.message.slice(0, 500)  : "unknown"
    const stack:   string = typeof body.stack   === "string" ? body.stack.slice(0, 2000)   : ""
    const context: string = typeof body.context === "string" ? body.context.slice(0, 200)  : ""
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"

    console.error("[client-error]", JSON.stringify({ message, stack, context, ip }))
  } catch {
    // ignore malformed body
  }

  return new NextResponse(null, { status: 204 })
}
