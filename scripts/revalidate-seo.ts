/**
 * Triggers on-demand revalidation of all SEO landing pages.
 * Run after data changes or whenever a content refresh is needed.
 *
 * Usage:
 *   REVALIDATE_SECRET=xxx npm run revalidate:seo
 *   APP_URL=https://accessible-places.org REVALIDATE_SECRET=xxx npm run revalidate:seo
 */

const BASE   = process.env.APP_URL ?? "https://accessible-places.org"
const SECRET = process.env.REVALIDATE_SECRET

if (!SECRET) {
  console.error("Error: REVALIDATE_SECRET is not set")
  process.exit(1)
}

const url = `${BASE}/api/revalidate-seo?token=${encodeURIComponent(SECRET)}`

async function main() {
  console.log(`Revalidating SEO pages at ${BASE} …`)

  const res  = await fetch(url, { method: "POST" })
  const body = await res.json().catch(() => ({}))

  if (!res.ok) {
    console.error(`Failed (${res.status}):`, body)
    process.exit(1)
  }

  console.log(`Done — ${body.revalidated} pages marked for revalidation`)
}

main()
