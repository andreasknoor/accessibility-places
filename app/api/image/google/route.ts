import { NextRequest, NextResponse } from "next/server"
import { ipFromRequest, isRateLimited, rateLimitResponse } from "@/lib/rate-limit"

// Validates that photoName matches the Google Places photo resource pattern.
// Prevents SSRF: only exact-format strings are forwarded to the Google API.
const PHOTO_NAME_RE = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/

export async function GET(req: NextRequest) {
  if (isRateLimited("photo", ipFromRequest(req), 20)) return rateLimitResponse()

  const photoName = req.nextUrl.searchParams.get("photoName") ?? ""

  // Length cap is defence-in-depth: real photoNames are ~80 chars.
  if (photoName.length > 200 || !PHOTO_NAME_RE.test(photoName)) {
    return NextResponse.json({ error: "Invalid photoName" }, { status: 400 })
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 })
  }

  const url = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=600&skipHttpRedirect=true&key=${apiKey}`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return NextResponse.json({ error: "Photo fetch failed" }, { status: 502 })
    const data = await res.json()
    const photoUri = data?.photoUri
    if (!photoUri || typeof photoUri !== "string") {
      return NextResponse.json({ error: "No photo URI" }, { status: 404 })
    }
    return NextResponse.json({ url: photoUri }, {
      headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
    })
  } catch {
    return NextResponse.json({ error: "Photo fetch failed" }, { status: 502 })
  }
}
