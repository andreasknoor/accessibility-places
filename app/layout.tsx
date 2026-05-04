import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LocaleProvider } from "@/lib/i18n"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets:  ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets:  ["latin"],
})

const DESCRIPTION =
  "Barrierefreie Orte in Deutschland, Österreich und der Schweiz — " +
  "verlässlicher als Google Maps. Kostenlose Suche nach Restaurants, Cafés, Hotels und mehr."

export const metadata: Metadata = {
  title:       "Accessible Places",
  description: DESCRIPTION,
  metadataBase: new URL("https://accessible-places.org"),
  openGraph: {
    type:        "website",
    url:         "https://accessible-places.org",
    title:       "Accessible Places",
    description: DESCRIPTION,
    locale:      "de_DE",
    siteName:    "Accessible Places",
  },
  appleWebApp: {
    capable:        true,
    statusBarStyle: "default",
    title:          "Accessible Places",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
}

export const viewport: Viewport = {
  themeColor:   "#2563eb",
  width:        "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type":    "WebApplication",
            "name":     "Accessible Places",
            "url":      "https://accessible-places.org",
            "description": DESCRIPTION,
            "applicationCategory": "TravelApplication",
            "operatingSystem": "Web",
            "inLanguage": ["de", "en"],
            "offers": { "@type": "Offer", "price": "0", "priceCurrency": "EUR" },
            "author": { "@type": "Person", "name": "Andreas Knoor" },
          })}}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <LocaleProvider>
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        </LocaleProvider>
        <Analytics />
      </body>
    </html>
  )
}
