import type { Metadata } from "next"
import ImpressumContent from "./ImpressumContent"

const BASE = "https://accessible-places.org"

export const metadata: Metadata = {
  title: "Impressum",
  alternates: {
    canonical: `${BASE}/impressum`,
    languages: { de: `${BASE}/impressum`, en: `${BASE}/en/legal-notice` },
  },
}

export default function ImpressumPage() {
  return <ImpressumContent lang="de" />
}
