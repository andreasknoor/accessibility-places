import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules:   { userAgent: "*", allow: "/" },
    sitemap: "https://accessible-places.andreasknoor.com/sitemap.xml",
  }
}
