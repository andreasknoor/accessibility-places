import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

const BASE = "https://accessible-places.org"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy policy for Accessible Places — find wheelchair-accessible venues in the DACH region.",
  alternates: {
    canonical: `${BASE}/en/privacy`,
    languages: { de: `${BASE}/datenschutz`, en: `${BASE}/en/privacy` },
  },
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-lg mx-auto px-6 py-10">
        <Link
          href="/en"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>

        <h1 className="text-2xl font-bold mb-8">Privacy Policy</h1>

        <div className="flex flex-col gap-6 text-sm text-muted-foreground leading-relaxed">

          <section>
            <h2 className="font-semibold text-foreground mb-2">1. Controller</h2>
            <p>
              The controller within the meaning of the GDPR is Andreas Knoor. Contact
              details are listed in the{" "}
              <Link href="/en/legal-notice" className="text-primary underline hover:opacity-80">
                Legal Notice
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground mb-2">2. Data collected and purposes</h2>

            <h3 className="font-medium text-foreground mt-3 mb-1">Location data</h3>
            <p>
              The &ldquo;Nearby&rdquo; feature uses the browser&apos;s Geolocation API to
              determine your current position. Coordinates are used solely for the
              search and are not stored permanently. Location access is only requested
              after your explicit consent.
            </p>

            <h3 className="font-medium text-foreground mt-3 mb-1">Search queries</h3>
            <p>
              Search queries (location, category) are processed server-side and
              forwarded to external data services (see section 3). No search queries
              are stored permanently.
            </p>

            <h3 className="font-medium text-foreground mt-3 mb-1">User preferences</h3>
            <p>
              Settings such as filter presets and display options are stored exclusively
              in local device storage (localStorage) and are not transmitted to any
              server.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground mb-2">3. External services</h2>
            <p className="mb-2">
              The app uses the following external services. With each search, the
              necessary data (location coordinates or place name, category) is
              transmitted to these services:
            </p>
            <ul className="list-disc pl-5 flex flex-col gap-1.5">
              <li>
                <strong className="text-foreground">OpenStreetMap / Overpass API</strong> —
                querying accessibility data.
                Operator: OpenStreetMap Foundation, UK.{" "}
                <a href="https://wiki.osmfoundation.org/wiki/Privacy_Policy" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80">Privacy policy</a>
              </li>
              <li>
                <strong className="text-foreground">Nominatim / Photon (Komoot)</strong> —
                place search and address suggestions.
                Operators: OpenStreetMap Foundation and Komoot GmbH, Berlin.{" "}
                <a href="https://www.komoot.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80">Komoot privacy policy</a>
              </li>
              <li>
                <strong className="text-foreground">accessibility.cloud</strong> —
                accessibility data (incl. Wheelmap.org). Operator: Sozialhelden e.V., Berlin.{" "}
                <a href="https://www.accessibility.cloud/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80">Privacy policy</a>
              </li>
              <li>
                <strong className="text-foreground">Ginto</strong> —
                accessibility data for Switzerland. Operator: Ginto AG, Switzerland.{" "}
                <a href="https://ginto.guide" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80">ginto.guide</a>
              </li>
              <li>
                <strong className="text-foreground">Google Places API</strong> —
                supplementary venue data. Operator: Google Ireland Ltd., Dublin.{" "}
                <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80">Privacy policy</a>
              </li>
              <li>
                <strong className="text-foreground">Vercel</strong> —
                hosting and infrastructure. Operator: Vercel Inc., San Francisco.{" "}
                <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80">Privacy policy</a>
              </li>
              <li>
                <strong className="text-foreground">Vercel Analytics / Speed Insights</strong> —
                anonymous usage statistics and Core Web Vitals. No personal data is
                collected. Operator: Vercel Inc.
              </li>
              <li>
                <strong className="text-foreground">Tally</strong> —
                feedback form. Operator: Tally BV, Belgium.{" "}
                <a href="https://tally.so/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80">Privacy policy</a>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-foreground mb-2">4. Map view</h2>
            <p>
              Map tiles are loaded from OpenStreetMap servers. Your IP address is
              transmitted to the respective tile server in the process.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground mb-2">5. Legal basis</h2>
            <p>
              Processing is based on Art. 6(1)(b) GDPR (performance of a contract /
              pre-contractual measures) and Art. 6(1)(f) GDPR (legitimate interest in
              a functional app). Location data is only processed on the basis of your
              explicit consent (Art. 6(1)(a) GDPR).
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground mb-2">6. Your rights</h2>
            <p>
              You have the right to access, rectification, erasure, and restriction of
              processing, as well as the right to data portability and to object.
              Requests should be directed to the contact address listed in the{" "}
              <Link href="/en/legal-notice" className="text-primary underline hover:opacity-80">
                Legal Notice
              </Link>
              . You also have the right to lodge a complaint with a data protection
              supervisory authority.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground mb-2">7. Changes</h2>
            <p>
              This privacy policy may be updated when necessary. The current version
              is always available at accessible-places.org/en/privacy.
            </p>
          </section>

        </div>
      </div>
    </div>
  )
}
