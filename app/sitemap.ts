import type { MetadataRoute } from "next"

const BASE = "https://accessible-places.org"

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url:             `${BASE}/`,
      lastModified:    new Date(),
      changeFrequency: "weekly",
      priority:        1,
    },
    {
      url:             `${BASE}/faq`,
      lastModified:    new Date(),
      changeFrequency: "monthly",
      priority:        0.8,
    },
    {
      url:             `${BASE}/en/faq`,
      lastModified:    new Date(),
      changeFrequency: "monthly",
      priority:        0.8,
    },
    {
      url:             `${BASE}/impressum`,
      lastModified:    new Date(),
      changeFrequency: "yearly",
      priority:        0.3,
    },
    {
      url:             `${BASE}/en/impressum`,
      lastModified:    new Date(),
      changeFrequency: "yearly",
      priority:        0.3,
    },
  ]
}
