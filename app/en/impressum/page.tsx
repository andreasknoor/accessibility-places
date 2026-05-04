import type { Metadata } from "next"
import ImpressumContent from "@/app/impressum/ImpressumContent"

const BASE = "https://accessible-places.org"

export const metadata: Metadata = {
  title: "Legal Notice",
  alternates: {
    canonical: `${BASE}/en/impressum`,
    languages: { de: `${BASE}/impressum`, en: `${BASE}/en/impressum` },
  },
}

export default function ImpressumPageEn() {
  return <ImpressumContent lang="en" />
}
