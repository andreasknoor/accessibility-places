import type { MetadataRoute } from "next"
import de from "@/lib/i18n/de"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             "Accessible Places",
    short_name:       "AccessiblePlaces",
    description:      de.metadata.manifestDescription,
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
