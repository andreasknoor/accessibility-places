import { NextRequest, NextResponse } from "next/server"

const PHOTON_URL = "https://photon.komoot.io/api/"
// Bounding box covering DE + AT + CH (minLon, minLat, maxLon, maxLat)
const DACH_BBOX  = "5.87,45.82,17.17,55.06"

export async function GET(req: NextRequest) {
  const q    = req.nextUrl.searchParams.get("q")?.trim()
  const lang = req.nextUrl.searchParams.get("lang") ?? "de"

  if (!q || q.length < 2) return NextResponse.json([])

  const url =
    `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=6&lang=${lang}` +
    `&bbox=${DACH_BBOX}` +
    `&layer=city&layer=district&layer=locality`

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "AccessibleSpaces/1.0 (contact@accessible-spaces.app)" },
      signal:  AbortSignal.timeout(3_000),
    })
    if (!res.ok) return NextResponse.json([])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: { features?: any[] } = await res.json()
    const seen = new Set<string>()

    const suggestions = (data.features ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((f: any) => {
        const p       = f.properties ?? {}
        const name    = (p.name ?? "").trim()
        const city    = (p.city ?? p.county ?? "").trim()
        const display = city && city !== name ? `${name}, ${city}` : name
        return { display, name }
      })
      .filter(({ display }) => {
        if (!display || seen.has(display)) return false
        seen.add(display)
        return true
      })

    return NextResponse.json(suggestions)
  } catch {
    return NextResponse.json([])
  }
}
