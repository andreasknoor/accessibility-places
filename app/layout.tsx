import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
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
  "Barrierefreie Orte in Deutschland, Österreich und der Schweiz finden — " +
  "Restaurants, Hotels, Museen und mehr mit geprüften Rollstuhl-Informationen."

export const metadata: Metadata = {
  title:       "Accessible Places",
  description: DESCRIPTION,
  metadataBase: new URL("https://accessible-places.andreasknoor.com"),
  openGraph: {
    type:        "website",
    url:         "https://accessible-places.andreasknoor.com",
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
      </head>
      <body className="min-h-full flex flex-col">
        <LocaleProvider>
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        </LocaleProvider>
      </body>
    </html>
  )
}
