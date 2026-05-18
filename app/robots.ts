import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow:    "/",
      disallow: [
        "/?*",    // SPA deep-link params (same shell for all); blocks /?q=, /?cat=, /?selectLat= …
        "/en?*",  // same for the EN home page
        "/api/",  // API routes — not content pages
      ],
    },
    sitemap: "https://accessible-places.org/sitemap.xml",
  }
}
