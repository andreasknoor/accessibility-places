import type { MetadataRoute } from "next"
import { CITIES, SEO_CATEGORY_SLUGS } from "@/lib/cities"
import { VALID_SEO_PATHS, SEO_DATA_DATE } from "@/lib/seo-validity"

const BASE = "https://accessible-places.org"

// Build time — correct for static pages whose content ships with the codebase.
const BUILD_DATE = new Date()

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`,             lastModified: BUILD_DATE, changeFrequency: "weekly",  priority: 1   },
    { url: `${BASE}/en`,           lastModified: BUILD_DATE, changeFrequency: "weekly",  priority: 1   },
    { url: `${BASE}/faq`,          lastModified: BUILD_DATE, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/en/faq`,       lastModified: BUILD_DATE, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/impressum`,    lastModified: BUILD_DATE, changeFrequency: "yearly",  priority: 0.3 },
    { url: `${BASE}/en/impressum`, lastModified: BUILD_DATE, changeFrequency: "yearly",  priority: 0.3 },
  ]

  const seoPages: MetadataRoute.Sitemap = CITIES.flatMap((city) =>
    Object.keys(SEO_CATEGORY_SLUGS)
      .filter((category) => VALID_SEO_PATHS.has(`${city.slug}/${category}`))
      .flatMap((category) => [
        { url: `${BASE}/${city.slug}/${category}`,    lastModified: SEO_DATA_DATE, changeFrequency: "weekly" as const, priority: 0.7 },
        { url: `${BASE}/en/${city.slug}/${category}`, lastModified: SEO_DATA_DATE, changeFrequency: "weekly" as const, priority: 0.7 },
      ]),
  )

  // City guide pages — one per city that has at least one valid SEO category.
  const citiesWithData = new Set([...VALID_SEO_PATHS].map((p) => p.split("/")[0]))
  const cityGuidePages: MetadataRoute.Sitemap = CITIES
    .filter((city) => citiesWithData.has(city.slug))
    .flatMap((city) => [
      { url: `${BASE}/${city.slug}/barrierefrei`, lastModified: SEO_DATA_DATE, changeFrequency: "weekly" as const, priority: 0.8 },
      { url: `${BASE}/en/${city.slug}/accessible`, lastModified: SEO_DATA_DATE, changeFrequency: "weekly" as const, priority: 0.8 },
    ])

  return [...staticPages, ...cityGuidePages, ...seoPages]
}
