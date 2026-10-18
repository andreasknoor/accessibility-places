import { notFound }        from "next/navigation"
import { resolveSeoRoute } from "@/lib/cities"

// Rejects unknown city/category slugs before the loading.tsx Suspense boundary.
// Once that fallback streams, Next has already committed to HTTP 200, so the
// page's own notFound() only yields a noindex soft 404 — here it is a real 404.
export default async function SeoRouteLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ city: string; category: string }>
}) {
  const { city, category } = await params
  if (!resolveSeoRoute(city, category)) notFound()
  return children
}
