import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

const BASE = "https://accessible-places.org"

export const metadata: Metadata = {
  title: "About the App",
  description:
    "Accessible Places is a free web app helping wheelchair users and people with mobility impairments find reliable accessibility data across Germany, Austria and Switzerland.",
  alternates: {
    canonical: `${BASE}/en/ueber-uns`,
    languages: { de: `${BASE}/ueber-uns`, en: `${BASE}/en/ueber-uns` },
  },
}

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-6 py-10">

        <Link
          href="/en"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>

        <h1 className="text-2xl font-bold mb-3 leading-snug">
          Accessible Places: Real-Time Accessibility Navigation for the DACH Region
        </h1>
        <p className="text-sm text-muted-foreground mb-8">An overview of the project, the idea behind it, and how the app works.</p>

        {/* Project overview — bordered box */}
        <div className="rounded-xl border border-border bg-card p-5 mb-10">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-4">Project Overview</h2>
          <dl className="grid gap-2.5 text-sm">
            {[
              ["Name",           "Accessible Places"],
              ["Website",        "accessible-places.org"],
              ["Concept",        "Real-time aggregation and reliability scoring of accessibility data from multiple sources"],
              ["Regions",        "Germany, Austria and Switzerland (DACH)"],
              ["Data sources",   "OpenStreetMap (OSM), accessibility.cloud (incl. Wheelmap.org), Ginto (Switzerland), Google Places"],
              ["Business model", "100% free · ad-free · no registration · private non-profit project"],
            ].map(([label, value]) => (
              <div key={label} className="grid grid-cols-[10rem_1fr] gap-x-3">
                <dt className="font-medium text-muted-foreground shrink-0">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex flex-col gap-10 text-sm leading-relaxed">

          <section>
            <h2 className="text-lg font-bold mb-3">What is Accessible Places?</h2>
            <p className="text-muted-foreground">
              Let's be honest: everyone loves exploring new, unfamiliar places. Getting out, discovering something new, and having a great, carefree time. That's exactly what people in wheelchairs or with mobility impairments wish for too – but the reality of everyday life is usually anything but carefree.
            </p>
            <p className="text-muted-foreground mt-3">
              When planning a trip or a weekend outing, practical questions immediately arise: Does the restaurant have a step-free entrance? Is there an accessible toilet with grab rails? And what about a wide disabled parking space right at the entrance – or at least somewhere nearby? And if so: exactly where?
            </p>
            <p className="text-muted-foreground mt-3">
              These essential questions are unfortunately very difficult to answer online. That's precisely why "Accessible Places" was created. The web app aims to end the tedious search for wheelchair-relevant information across countless different websites. And it answers what is perhaps the most important question of all: how reliable is the information really?
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">The Problem with Standard Maps</h2>
            <p className="text-muted-foreground">
              When we're out and about, our fingers instinctively reach for Google Maps, Bing Maps or Apple Maps. Great for navigation, but they quickly fall short when it comes to accessibility. Structured information is often nowhere to be found, and dedicated filters for wheelchair users are almost entirely absent. Instead, you have to wade through reviews, because a label like "Wheelchair accessible: Yes" is often far too vague or simply outdated in practice. In the worst case, you end up facing an insurmountable step.
            </p>
            <p className="text-muted-foreground mt-3">
              Accessible Places takes a different approach. Rather than relying on a single, often incomplete source, the platform merges data from various specialists live and in real time. When you search, the site quietly pulls from sources like OpenStreetMap, accessibility.cloud (which includes the well-known Wheelmap.org data), and Ginto with specific information for Switzerland. Google Maps data can optionally be added as a supplement – but only ever as enrichment, never as the sole source to blindly rely on.
            </p>
            <blockquote className="mt-4 pl-4 border-l-2 border-primary italic text-foreground">
              "Wheelchair users don't need vague assumptions – they need reliable facts."
            </blockquote>
            <p className="text-muted-foreground mt-3">
              With Accessible Places, I wanted to create a tool that bundles the best data sources and immediately shows users how reliable the current information is – without barriers, without cost, and without data collection in the background.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">Three Ways to Find What You're Looking For</h2>
            <p className="text-muted-foreground mb-4">
              The primary goal of Accessible Places is to provide the shortest path to the right information, whatever the situation. The app offers three intuitive search modes:
            </p>
            <ol className="flex flex-col gap-4">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center mt-0.5">1</span>
                <div>
                  <p className="font-semibold">Nearby</p>
                  <p className="text-muted-foreground mt-0.5">Perfect for spontaneous decisions on the go. The app automatically detects your smartphone's location (with permission) and instantly shows the nearest accessible restaurants, cafés or cinemas in your immediate area.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center mt-0.5">2</span>
                <div>
                  <p className="font-semibold">Explore</p>
                  <p className="text-muted-foreground mt-0.5">Ideal for planning holidays or day trips in advance. Simply enter your destination and a category (e.g. hotel or theatre). The best results are displayed clearly in a list or visually on a map.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center mt-0.5">3</span>
                <div>
                  <p className="font-semibold">Find a Place</p>
                  <p className="text-muted-foreground mt-0.5">Targeted search for a specific venue. If you want to know about the accessibility of a particular attraction, museum or bar, simply enter the name and immediately get all available details about the entrance, toilet and parking.</p>
                </div>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">The Color Code: Why Red Doesn't Mean "Inaccessible"</h2>
            <p className="text-muted-foreground mb-4">
              A central element that immediately catches the eye is the traffic light system combined with a "reliability score". These color codes appear both in the search results and as small circles in the map view. There's a key, innovative insight here: the colors primarily indicate not whether a place is accessible, but how reliable the underlying data currently is.
            </p>
            <ul className="flex flex-col gap-3">
              <li className="flex items-start gap-3">
                <span className="text-lg leading-none mt-0.5">🔴</span>
                <p className="text-muted-foreground"><span className="font-semibold text-foreground">Red</span> does not automatically mean the place is inaccessible. It simply means the data is currently incomplete or uncertain (e.g. only unverified baseline data from Google Maps is available).</p>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-lg leading-none mt-0.5">🟡</span>
                <p className="text-muted-foreground"><span className="font-semibold text-foreground">Yellow</span> indicates a solid, reasonably good and plausible data basis.</p>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-lg leading-none mt-0.5">🟢</span>
                <p className="text-muted-foreground"><span className="font-semibold text-foreground">Green</span> means the information is highly reliable and has typically been manually checked and verified by the community (e.g. Wheelmap users). Manually verified entries are also highlighted with a special badge.</p>
              </li>
            </ul>
            <p className="text-muted-foreground mt-4">
              This honest approach prevents nasty surprises on arrival. You immediately know when you can trust the app's data completely – and when it's worth making a quick call to the venue just to be sure.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">A Passion Project for the DACH Region – Completely Free</h2>
            <p className="text-muted-foreground">
              Accessible Places is a private, non-commercial hobby project. It's completely free, requires no registration or personal data, and is 100% ad-free.
            </p>
            <p className="text-muted-foreground mt-3">
              The platform already works comprehensively across Germany, Austria and Switzerland. Whether searching for an accessible hotel in central Berlin, a cosy café in Vienna or an ice cream parlour in Zurich – the platform helps you find the best available accessibility information with minimal effort. Users can also submit feedback or report issues instantly via an integrated form.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3">Practical Tip: Install Without an App Store</h2>
            <p className="text-muted-foreground mb-4">
              You don't need to visit the Apple App Store or Google Play Store to get the app. Since Accessible Places is built as a modern Progressive Web App (PWA), it can be installed directly from your mobile browser:
            </p>
            <ul className="flex flex-col gap-3">
              <li className="flex items-start gap-2.5">
                <span className="text-base leading-none mt-0.5">📱</span>
                <p className="text-muted-foreground"><span className="font-semibold text-foreground">iPhone (Safari):</span> Tap the Share icon at the bottom (the square with the upward arrow) and choose "Add to Home Screen".</p>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="text-base leading-none mt-0.5">🤖</span>
                <p className="text-muted-foreground"><span className="font-semibold text-foreground">Android (Chrome):</span> Tap the three-dot menu in the top right and choose "Install app" or "Add to Home Screen".</p>
              </li>
            </ul>
            <p className="text-muted-foreground mt-4">
              Accessible Places then appears on your home screen as a fully-featured app, complete with its own icon and a clean fullscreen mode without browser bars.
            </p>
          </section>

          <p className="text-muted-foreground pt-2 border-t border-border">
            Simple, independent, and genuinely useful. Try it yourself at:{" "}
            <Link href="/en" className="text-primary hover:underline font-medium">
              accessible-places.org
            </Link>
          </p>

        </div>
      </div>
    </div>
  )
}
