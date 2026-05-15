import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow:    "/",
      // Parameterised home-page URLs (SPA — same empty shell for all params)
      disallow: ["/*?*q="],
    },
    sitemap: "https://accessible-places.org/sitemap.xml",
  }
}
