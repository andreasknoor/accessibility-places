import { NextRequest, NextResponse } from "next/server"
import { trackUserOpen } from "@/lib/user-stats"

// Anonymous app-open ping for the top-users statistic: counts users who open
// the app without ever running a search (they are invisible to the search-
// driven trackUserSearch path). Called once per calendar day per device from
// HomeClient; body = { userId, platform }, same validation and opt-out
// semantics as the search counter (invalid input is dropped silently).
//
// The write is awaited (not fire-and-forget like in the streaming search
// route): this response ends immediately, and on Vercel Fluid the instance
// freezes at response end — an unawaited Redis write would be exactly the
// ping we wanted to record.
export async function POST(req: NextRequest): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await req.json()
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>
  } catch { /* malformed body → validation drops it below */ }

  await trackUserOpen(body.userId, body.platform)

  // Always 204 — the client cannot act on a failure, and the response must
  // not leak whether the input was counted.
  return new NextResponse(null, { status: 204 })
}
