import type { MetadataRoute } from "next"
import { CITIES, SEO_CATEGORY_SLUGS } from "@/lib/cities"
import { getNonEmptySlugPairs } from "@/lib/seo-blob"

const BASE = "https://accessible-places.org"

const ALL_PAIRS = CITIES.flatMap((city) =>
  Object.keys(SEO_CATEGORY_SLUGS).map((category) => ({ city: city.slug, category })),
)

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pairs = process.env.BLOB_READ_WRITE_TOKEN
    ? await getNonEmptySlugPairs().then((p) => p.length > 0 ? p : ALL_PAIRS)
    : ALL_PAIRS

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`,             lastModified: new Date(), changeFrequency: "weekly",  priority: 1   },
    { url: `${BASE}/en`,           lastModified: new Date(), changeFrequency: "weekly",  priority: 1   },
    { url: `${BASE}/faq`,          lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/en/faq`,       lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/impressum`,    lastModified: new Date(), changeFrequency: "yearly",  priority: 0.3 },
    { url: `${BASE}/en/impressum`, lastModified: new Date(), changeFrequency: "yearly",  priority: 0.3 },
  ]

  const seoPages: MetadataRoute.Sitemap = pairs.flatMap(({ city, category }) => [
    { url: `${BASE}/${city}/${category}`,    lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.7 },
    { url: `${BASE}/en/${city}/${category}`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.7 },
  ])

  return [...staticPages, ...seoPages]
}
