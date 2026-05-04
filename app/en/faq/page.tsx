import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

const BASE = "https://accessible-places.org"

export const metadata: Metadata = {
  title: "Frequently Asked Questions",
  description: "Answers to common questions about Accessible Places — find wheelchair-accessible venues in Germany, Austria and Switzerland reliably.",
  alternates: {
    canonical: `${BASE}/en/faq`,
    languages: { de: `${BASE}/faq`, en: `${BASE}/en/faq` },
  },
}

const FAQ_EN = [
  {
    q: "What is Accessible Places?",
    a: "Accessible Places helps people with wheelchairs or limited mobility find accessible venues in Germany, Austria and Switzerland. A key focus is data reliability: accessibility information in Google Maps is often incomplete and difficult to filter in a meaningful way. Accessible Places solves exactly this problem — offering a fast, easy-to-use search that aggregates and rates information from multiple sources.",
  },
  {
    q: "How do I find wheelchair-accessible places in Germany, Austria and Switzerland?",
    a: "Simply enter a location — for example \"Berlin Mitte\" or \"Vienna\" — and choose a category such as restaurant or hotel. Accessible Places searches multiple data sources instantly and shows you accessible venues nearby. The app covers the entire DACH region: Germany, Austria and Switzerland.",
  },
  {
    q: "Which wheelchair-accessible venues can I find — restaurants, hotels, cafés?",
    a: "Restaurants, cafés, bars, pubs, beer gardens, fast food / snack bars, hotels, hostels, holiday apartments, museums, theatres, cinemas, libraries, galleries, attractions and ice cream shops.",
  },
  {
    q: "How do I find wheelchair-accessible restaurants or cafés near me?",
    a: "Tap \"Nearby\" and allow location access. Accessible Places automatically detects your position and searches for accessible restaurants, cafés or other venues in your immediate vicinity — no need to type a location.",
  },
  {
    q: "What is the difference from Google Maps when searching for accessible places?",
    a: "Google Maps contains little structured accessibility information and offers no dedicated filter for it. Accessible Places is built specifically for this search: it combines multiple specialised data sources, rates each piece of information by reliability, and shows at a glance how suitable a venue is for wheelchair users.",
  },
  {
    q: "How reliable is the accessibility information?",
    a: "The app combines data from three sources: OpenStreetMap (OSM), accessibility.cloud (including Wheelmap.org) and Google Places. Each source is weighted by its trustworthiness — from manually verified entries to automatically collected data. The coloured circle next to each entry shows at a glance how solid the data is.",
  },
  {
    q: "What does the coloured circle next to each entry mean?",
    a: "Green means reliable accessibility information, yellow means moderate data quality, and red means uncertain or incomplete data. The colour reflects how trustworthy the available information is — not whether a place is accessible or not.",
  },
  {
    q: "Is searching for wheelchair-accessible places free?",
    a: "Yes, completely free and no registration required.",
  },
  {
    q: "Is the accessibility information up to date and verified?",
    a: "Data is fetched live from the sources on every search. Manually verified entries from Wheelmap contributors are highlighted with a special badge.",
  },
  {
    q: "Can I search for accessible places on my smartphone?",
    a: "Yes — Accessible Places can be installed as an app on your phone without the App Store or Play Store. On iPhone/iPad: open Safari → tap the Share icon → select \"Add to Home Screen\". On Android: open Chrome → tap the menu (three dots) → \"Install app\" or \"Add to home screen\". Once installed it behaves like a native app — with its own icon, full screen and no browser bar.",
  },
  {
    q: "How can I give feedback or report a bug?",
    a: "Use the \"Feedback\" link at the bottom of the page to open a GitHub issue directly. You'll need a free GitHub account to submit.",
  },
]

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_EN.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
}

export default function FaqPageEn() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <div className="max-w-lg mx-auto px-6 py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>

        <h1 className="text-2xl font-bold mb-8">Frequently Asked Questions</h1>

        <dl className="flex flex-col gap-6">
          {FAQ_EN.map(({ q, a }) => (
            <div key={q} className="border-b border-border pb-6 last:border-0 last:pb-0">
              <dt className="font-semibold text-sm mb-1.5">{q}</dt>
              <dd className="text-sm text-muted-foreground leading-relaxed">{a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
