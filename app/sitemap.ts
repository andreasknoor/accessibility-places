import type { MetadataRoute } from "next"

const BASE = "https://accessible-places.org"

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url:              `${BASE}/`,
      lastModified:     new Date(),
      changeFrequency:  "weekly",
      priority:         1,
    },
    {
      url:              `${BASE}/impressum`,
      lastModified:     new Date(),
      changeFrequency:  "yearly",
      priority:         0.3,
    },
  ]
}
