import { docsMarkdown } from "@/lib/public-api/docs"

// Plain-text usage guide for LLM agents. Public (no token): it holds no data.
export function GET() {
  return new Response(docsMarkdown(), {
    headers: {
      "Content-Type":                "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control":               "public, s-maxage=86400",
    },
  })
}
