import type { MetadataRoute } from "next"
import { CITIES, SEO_CATEGORY_SLUGS } from "@/lib/cities"

const BASE     = "https://accessible-places.org"
const CAT_SLUGS = Object.keys(SEO_CATEGORY_SLUGS)

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`,         lastModified: new Date(), changeFrequency: "weekly",  priority: 1   },
    { url: `${BASE}/en`,       lastModified: new Date(), changeFrequency: "weekly",  priority: 1   },
    { url: `${BASE}/faq`,      lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/en/faq`,   lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/impressum`,    lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/en/impressum`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ]

  const seoPages: MetadataRoute.Sitemap = CITIES.flatMap((city) =>
    CAT_SLUGS.flatMap((slug) => [
      {
        url:             `${BASE}/${city.slug}/${slug}`,
        lastModified:    new Date(),
        changeFrequency: "weekly" as const,
        priority:        0.7,
      },
      {
        url:             `${BASE}/en/${city.slug}/${slug}`,
        lastModified:    new Date(),
        changeFrequency: "weekly" as const,
        priority:        0.7,
      },
    ]),
  )

  return [...staticPages, ...seoPages]
}
