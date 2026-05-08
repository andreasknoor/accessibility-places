import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import Script from "next/script"
import { Analytics } from "@vercel/analytics/next"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LocaleProvider } from "@/lib/i18n"
// Static metadata is built at compile time and can't follow the visitor's
// runtime locale — pick the German strings to match the primary audience
// and the German FAQ/Impressum that ship at the apex URL.
import de from "@/lib/i18n/de"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets:  ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets:  ["latin"],
})

export const metadata: Metadata = {
  title: {
    default:  de.metadata.title,
    template: de.metadata.titleTemplate,
  },
  description: de.metadata.description,
  metadataBase: new URL("https://accessible-places.org"),
  openGraph: {
    type:        "website",
    url:         "https://accessible-places.org",
    title:       "Accessible Places",
    description: de.metadata.description,
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
  colorScheme:  "light",
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
      lang="de"
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
            "description": de.metadata.description,
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
        <Script src="https://tally.so/widgets/embed.js" strategy="lazyOnload" />
      </body>
    </html>
  )
}
