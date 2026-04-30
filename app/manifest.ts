import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             "Accessible Spaces",
    short_name:       "AccessibleSpaces",
    description:      "Rollstuhlgerechte Orte in der DACH-Region finden",
    start_url:        "/",
    display:          "standalone",
    background_color: "#ffffff",
    theme_color:      "#2563eb",
    orientation:      "portrait",
    icons: [
      {
        src:     "/icons/icon-192.png",
        sizes:   "192x192",
        type:    "image/png",
        purpose: "any",
      },
      {
        src:     "/icons/icon-512.png",
        sizes:   "512x512",
        type:    "image/png",
        purpose: "maskable",
      },
    ],
  }
}
