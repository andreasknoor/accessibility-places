import { revalidatePath } from "next/cache"
import { NextResponse }   from "next/server"
import { CITIES, SEO_CATEGORY_SLUGS } from "@/lib/cities"

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token")
  if (!process.env.REVALIDATE_SECRET || token !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const slugs = Object.keys(SEO_CATEGORY_SLUGS)
  for (const city of CITIES) {
    for (const slug of slugs) {
      revalidatePath(`/${city.slug}/${slug}`)
      revalidatePath(`/en/${city.slug}/${slug}`)
    }
  }

  const count = CITIES.length * slugs.length * 2
  return NextResponse.json({ revalidated: count })
}
