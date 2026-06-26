import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { FaqAccordion, type FaqCategory } from "@/components/faq/FaqAccordion"

const BASE = "https://accessible-places.org"

export const metadata: Metadata = {
  title: "Frequently Asked Questions",
  description: "Answers to common questions about Accessible Places — find wheelchair-accessible venues in Germany, Austria and Switzerland reliably.",
  alternates: {
    canonical: `${BASE}/en/faq`,
    languages: { de: `${BASE}/faq`, en: `${BASE}/en/faq` },
  },
}

// `id` is a stable deep-link slug — kept identical to the DE file so /faq#slug
// and /en/faq#slug resolve to the same question. Do not derive it from the
// question text: rewording a question would silently break shared links.
const FAQ_CATEGORIES_EN: FaqCategory[] = [
  {
    id: "grundlagen",
    icon: "💡",
    label: "Basics",
    items: [
      {
        id: "what-is",
        q: "What is Accessible Places?",
        a: "Accessible Places helps people with wheelchairs or limited mobility find accessible venues in Germany, Austria and Switzerland. A key focus is data reliability: accessibility information in Google Maps is often incomplete and difficult to filter in a meaningful way. Accessible Places solves exactly this problem — offering a fast, easy-to-use search that aggregates and rates information from multiple sources.",
      },
      {
        id: "which-venues",
        q: "Which wheelchair-accessible venues can I find — restaurants, hotels, cafés?",
        a: "Restaurants, cafés, bars, pubs, beer gardens, fast food / snack bars, hotels, hostels, holiday apartments, museums, theatres, cinemas, libraries, galleries, attractions and ice cream shops.",
      },
      {
        id: "free",
        q: "Is searching for wheelchair-accessible places free?",
        a: "Yes, completely free and no registration required.",
      },
    ],
  },
  {
    id: "suchen-finden",
    icon: "🔍",
    label: "Search & Discover",
    items: [
      {
        id: "how-to-find",
        q: "How do I find wheelchair-accessible places in Germany, Austria and Switzerland?",
        a: "Simply enter a location — for example \"Berlin Mitte\" or \"Vienna\" — and choose a category such as restaurant or hotel. Accessible Places searches multiple data sources instantly and shows you accessible venues nearby. The app covers the entire DACH region: Germany, Austria and Switzerland.",
      },
      {
        id: "find-nearby",
        q: "How do I find wheelchair-accessible restaurants or cafés near me?",
        a: "Tap the location button (⌖) next to the search field and allow location access. Accessible Places automatically detects your position and searches for accessible restaurants, cafés or other venues in your immediate vicinity — no need to type a location.",
      },
      {
        id: "find-parking-toilet",
        q: "How do I find a wheelchair toilet or accessible parking space nearby?",
        a: (
          <>
            <p>
              Tap the location button (⌖) or type your location. Below the search field you&apos;ll find the quick-search chips{" "}
              <strong className="font-semibold text-foreground">🅿 Parking</strong> and{" "}
              <strong className="font-semibold text-foreground">🚻 Toilets</strong>. Tapping a chip replaces the regular search results and shows only wheelchair-accessible parking or accessible toilets within your set radius (adjustable in Settings).
            </p>
            <p className="mt-2">
              Toilet markers appear in <strong className="font-semibold text-foreground">green</strong> for standalone public toilets (e.g. in squares or parks) and in <strong className="font-semibold text-foreground">violet</strong> for toilets inside venues. Tap a marker for details such as Euro key requirement or changing table.
            </p>
            <p className="mt-2">
              Alternatively, use the <strong className="font-semibold text-foreground">layer buttons</strong> at the bottom-left of the map (🅿 and 🚻) to show parking or toilet markers alongside your regular search results.
            </p>
          </>
        ),
        schemaText:
          "Tap the location button (⌖) or type your location. Below the search field you'll find the quick-search chips 🅿 Parking and 🚻 Toilets. Tapping a chip replaces the regular search results and shows wheelchair-accessible parking or accessible toilets within your set radius. Toilet markers appear in green for standalone public toilets and in violet for toilets inside venues. Tap a marker for details such as Euro key requirement or changing table. Alternatively, use the layer buttons at the bottom-left of the map to show parking or toilet markers alongside your regular search results.",
      },
    ],
  },
  {
    id: "daten-verlaesslichkeit",
    icon: "📊",
    label: "Data & Reliability",
    items: [
      {
        id: "reliability",
        q: "How reliable is the accessibility information?",
        a: "The app combines data from several specialised sources: OpenStreetMap (OSM), accessibility.cloud (including Wheelmap.org), Ginto (for Switzerland) and Google Places. Each source is weighted by its trustworthiness — from manually verified entries to automatically collected data. The coloured circle next to each entry shows at a glance how solid the data is.",
      },
      {
        id: "coloured-circle",
        q: "What does the coloured circle next to each entry mean?",
        a: "Green means reliable accessibility information, yellow means moderate data quality, and red means uncertain or incomplete data. The colour reflects how trustworthy the available information is — not whether a place is accessible or not.",
      },
      {
        id: "up-to-date",
        q: "Is the accessibility information up to date and verified?",
        a: "Data is fetched live from the sources on every search. Manually verified entries from Wheelmap contributors are highlighted with a special badge.",
      },
      {
        id: "vs-google-maps",
        q: "What is the difference from Google Maps when searching for accessible places?",
        a: "Google Maps contains little structured accessibility information and offers no dedicated filter for it. Accessible Places is built specifically for this search: it combines multiple specialised data sources, rates each piece of information by reliability, and shows at a glance how suitable a venue is for wheelchair users.",
      },
      {
        id: "vs-wheelmap",
        q: "What is the difference between Wheelmap.org and Accessible Places?",
        a: (
          <>
            <p>
              Wheelmap.org and Accessible Places pursue similar goals but set different priorities —
              they are not competitors but complement each other. Wheelmap is one of the largest
              crowdsourcing platforms for accessibility: thousands of people add places there directly.
              This valuable data also feeds into Accessible Places.
            </p>
            <p className="mt-2">Accessible Places focuses on four things:</p>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
              <li>
                <strong className="font-semibold text-foreground">Multiple sources, transparently rated:</strong>{" "}
                Accessible Places merges data from different sources into a single, unified view — from
                professionally certified on-site surveys, through community-maintained maps like Wheelmap
                and OpenStreetMap, to automatically aggregated listings such as Google Places. Each
                source has its strengths: a certified survey documents a venue in fine detail; the
                Wheelmap and OpenStreetMap community covers an enormous breadth of places and contributes
                information checked on the ground; while automatically collected data is available almost
                everywhere but is often less precise. As a result, how complete and verified the
                information is varies from entry to entry. Rather than blurring those differences,
                Accessible Places makes them visible: a coloured circle shows at a glance how solid each
                entry&apos;s information is, and the detail view reveals which sources it came from.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Best data per region:</strong> For
                each region we integrate the strongest local source. In Switzerland, for example, Ginto
                provides particularly high-quality accessibility data. This creates the best possible
                data basis everywhere.
              </li>
              <li>
                <strong className="font-semibold text-foreground">List view instead of map:</strong>{" "}
                Wheelmap.org shows places primarily on a map — you navigate to see what&apos;s nearby.
                Accessible Places delivers results as a sorted list first: with reliability rating,
                entrance and toilet information at a glance. The map is always available as an
                alternative, but isn&apos;t the primary view.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Wheelchair parking:</strong> Accessible
                Places shows wheelchair-accessible parking directly on the map. The question &ldquo;Where is
                the nearest accessible parking space?&rdquo; can be answered with a single click — something
                other platforms don&apos;t offer in this way.
              </li>
            </ul>
            <p className="mt-2">
              If you&apos;d like to contribute accessibility data yourself, Wheelmap.org is the best place to
              do so — new entries appear here too after a short while.
            </p>
          </>
        ),
        schemaText:
          "Wheelmap.org and Accessible Places pursue similar goals but set different priorities — they are not competitors but complement each other. Wheelmap is one of the largest crowdsourcing platforms for accessibility: thousands of people add places there directly. This valuable data also feeds into Accessible Places. Accessible Places focuses on four things: Multiple sources, transparently rated — Accessible Places merges data from different sources into a single, unified view, from professionally certified on-site surveys through community-maintained maps like Wheelmap and OpenStreetMap to automatically aggregated listings such as Google Places; each source has its strengths, and because they vary in how complete and verified they are, a coloured circle on each entry shows how solid the information is. Best data per region — for each region we integrate the strongest local source; in Switzerland, for example, Ginto provides particularly high-quality accessibility data. List view instead of map — Wheelmap.org shows places primarily on a map; Accessible Places delivers results as a sorted list first with reliability rating and details at a glance — the map is always available as an alternative. Wheelchair parking — Accessible Places shows wheelchair-accessible parking directly on the map, and the question \"Where is the nearest accessible parking space?\" can be answered with a single click. If you'd like to contribute accessibility data yourself, Wheelmap.org is the best place to do so — new entries appear here too after a short while.",
      },
    ],
  },
  {
    id: "app-mitmachen",
    icon: "📱",
    label: "App & Contributing",
    items: [
      {
        id: "mobile-app",
        q: "Can I search for accessible places on my smartphone?",
        a: "Yes — Accessible Places can be installed as an app on your phone without the App Store or Play Store. On iPhone/iPad: open Safari → tap the Share icon → select \"Add to Home Screen\". On Android: open Chrome → tap the menu (three dots) → \"Install app\" or \"Add to home screen\". Once installed it behaves like a native app — with its own icon, full screen and no browser bar.",
      },
      {
        id: "feedback",
        q: "How can I give feedback or report a bug?",
        a: "Use the \"Feedback\" link at the bottom of the page to open a short form. No account or registration required.",
      },
      {
        id: "contribute-data",
        q: "How can I add or change accessibility information for places myself?",
        a: (
          <>
            The easiest way: open the place on Wheelmap.org and enter the accessibility information
            directly there — free of charge and no prior knowledge required. The{" "}
            <a
              href="https://news.wheelmap.org/en/faq/#:~:text=Edit%20place%20details"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline hover:opacity-80"
            >
              Wheelmap FAQ
            </a>{" "}
            explains how to do this step by step. Since Accessible Places fetches Wheelmap data
            regularly, new or corrected entries usually become available here too after about 24 hours.
          </>
        ),
        schemaText:
          "The easiest way: open the place on Wheelmap.org and enter the accessibility information directly there — free of charge and no prior knowledge required. The Wheelmap FAQ at https://news.wheelmap.org/en/faq/ explains how to do this step by step. Since Accessible Places fetches Wheelmap data regularly, new or corrected entries usually become available here too after about 24 hours.",
      },
    ],
  },
  {
    id: "accessibility-of-app",
    icon: "♿",
    label: "Accessibility of this app",
    items: [
      {
        id: "a11y-statement",
        q: "How accessible is the app itself?",
        a: "Accessible Places is built to target WCAG 2.1/2.2 Level AA. The interface is keyboard-operable, works with screen readers (VoiceOver, TalkBack), labels controls with accessible names, announces search results, and respects the \"Reduce Motion\" system setting. Interface colour contrast meets the WCAG AA thresholds. A full formal conformance audit by an external body is still outstanding — this statement is based on self-assessment and automated testing.",
      },
      {
        id: "a11y-limitations",
        q: "What are the known limitations?",
        a: (
          <>
            <p>Despite careful work, some areas are not yet fully accessible:</p>
            <ul className="list-disc pl-5 mt-2 flex flex-col gap-1.5">
              <li>
                <strong className="font-semibold text-foreground">Map view:</strong> Individual markers on the
                map cannot be reached by keyboard (a limitation of the map library). As an equivalent
                alternative, the <strong className="font-semibold text-foreground">results list</strong> contains
                every result and is fully operable by keyboard and screen reader.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Contrast on the map:</strong> Coloured markers
                and text over photos sit on varying backgrounds, where contrast may in some cases fall below the
                target values.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Text size in the iOS app:</strong> The native
                iOS app does not automatically follow the &ldquo;Larger Text&rdquo; setting; pinch-to-zoom is
                available instead.
              </li>
            </ul>
          </>
        ),
        schemaText:
          "Known limitations: map markers cannot be reached by keyboard — the results list is the equivalent, fully operable alternative. Contrast of markers/text over maps and photos may in some cases fall below target values. The native iOS app does not automatically follow the \"Larger Text\" setting; pinch-to-zoom is available.",
      },
      {
        id: "a11y-feedback",
        q: "How do I report an accessibility problem?",
        a: "If you come across a barrier, we'd be grateful for a note via the \"Feedback\" link at the bottom of the page — no account or registration needed. We aim to fix reported issues promptly.",
      },
    ],
  },
]

const allItems = FAQ_CATEGORIES_EN.flatMap((c) => c.items)

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: allItems.map(({ q, a, schemaText }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: schemaText ?? (a as string) },
  })),
}

export default function FaqPageEn() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <main className="max-w-3xl mx-auto px-6 pt-safe-10 pb-10">
        <Link
          href="/en"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>

        <h1 className="text-2xl font-bold mb-2">Frequently Asked Questions</h1>
        <p className="text-sm text-muted-foreground mb-8">
          {allItems.length} questions in {FAQ_CATEGORIES_EN.length} categories
        </p>

        <FaqAccordion categories={FAQ_CATEGORIES_EN} />
      </main>
    </div>
  )
}
