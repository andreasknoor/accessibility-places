import Anthropic from "@anthropic-ai/sdk"
import type { Category, ParsedQuery, Place } from "./types"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are a search assistant for an accessibility mapping application.
Your job is to extract structured search parameters from a user's natural-language query.
The application searches for wheelchair-accessible places in the DACH region (Germany, Austria, Switzerland).
Always respond with valid JSON only — no explanation, no markdown.`

const CATEGORY_HINTS: Record<Category, string[]> = {
  cafe:        ["cafe", "café", "kaffee", "kaffeehaus", "bistro", "coffee"],
  restaurant:  ["restaurant", "essen", "speiselokal", "gastronomie", "gastro", "lokal"],
  bar:         ["bar", "pub", "kneipe", "biergarten", "bier"],
  fast_food:   ["fast food", "fastfood", "imbiss", "döner", "burger", "pizza"],
  hotel:       ["hotel", "motel", "hostel", "unterkunft", "übernachtung", "pension", "gästehaus", "lodge"],
  museum:      ["museum", "museen"],
  theater:     ["theater", "theatre", "kino", "oper", "cinema"],
  library:     ["bibliothek", "bücherei", "library"],
  gallery:     ["galerie", "gallery", "kunsthalle", "ausstellung"],
  attraction:  ["sehenswürdigkeit", "attraktion", "attraction", "freizeitpark", "zoo"],
}

function normaliseForMatch(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
}

export function inferCategories(query: string): Category[] {
  const lower = normaliseForMatch(query)
  const found: Category[] = []
  for (const [cat, hints] of Object.entries(CATEGORY_HINTS) as [Category, string[]][]) {
    if (hints.some((h) => new RegExp(`\\b${normaliseForMatch(h)}\\b`, "i").test(lower))) found.push(cat)
  }
  return found.length > 0 ? found : ["cafe", "restaurant", "bar", "fast_food", "hotel", "museum", "theater", "library", "gallery", "attraction"]
}

// Extract first quoted string as an explicit name hint.
// Supports straight, curly, German typographic and guillemet quote styles.
// User's quotes are an unambiguous "treat this as a name" signal —
// used to override the LLM's nameHint deterministically.
export function extractQuotedName(query: string): string {
  const m = query.match(/["'„“”‟"«»‹›]([^"'„“”‟"«»‹›]+)["'„“”‟"«»‹›]/u)
  return m ? m[1].trim() : ""
}

// Regex fallback: extract "in <Location>" from query
export function extractLocationFallback(query: string): string {
  // Match "in <City>" or "in <City District>" patterns (German/English)
  const match = query.match(
    /\bin\s+([A-ZÄÖÜ][a-zA-ZäöüÄÖÜß\s\-]+?)(?:\s*$|\s+(?:und|oder|mit|für|nahe|near|and|or|with)\b)/i,
  )
  if (match) return match[1].trim()

  // Last resort: return last 1-2 capitalised words (likely a city name)
  const words = query.split(/\s+/)
  const capitalised = words.filter((w) => /^[A-ZÄÖÜ]/.test(w))
  return capitalised.slice(-2).join(" ") || query
}

export async function parseQuery(userQuery: string): Promise<ParsedQuery> {
  // User-quoted strings are an explicit "this is a name" signal —
  // override whatever the LLM returns.
  const quotedName = extractQuotedName(userQuery)

  const prompt = `Analyse this accessibility search query and extract structured fields.

Rules:
- "locationQuery": ONLY the city, district, or address — no category words, no "in", no "barrierefreie"
- "nameHint": specific business name the user is asking about; empty string if searching by category only.
  IMPORTANT: treat unusual or abstract-sounding words as potential business names (e.g. "et cetera", "Zur Eiche", "No Name Bar").
- "categories": infer from context; return ALL categories when nameHint is set and no category is explicit.
- "freeTextHint": extra context like dietary preferences, atmosphere, etc.

Examples:
  - "Finde Restaurants in Spandau" → locationQuery:"Spandau", nameHint:"", categories:["restaurant"]
  - "et cetera in Potsdam" → locationQuery:"Potsdam", nameHint:"et cetera", categories:["cafe","restaurant","bar","fast_food","hotel","museum","theater","library","gallery","attraction"]
  - "Ist das Brauhaus Georgbräu in Berlin barrierefrei?" → locationQuery:"Berlin", nameHint:"Brauhaus Georgbräu", categories:["restaurant","bar"]
  - "Wilhelms Burger Gleimstraße Berlin" → locationQuery:"Berlin", nameHint:"Wilhelms Burger", categories:["fast_food","restaurant"]
  - "Rollstuhlgerechte Cafés in Berlin Mitte" → locationQuery:"Berlin Mitte", nameHint:"", categories:["cafe"]
  - "Barrierefreie Museen München" → locationQuery:"München", nameHint:"", categories:["museum"]

Query: "${userQuery}"

Return JSON:
{
  "locationQuery": "<city or district only>",
  "nameHint": "<specific business name or empty string>",
  "categories": ["cafe","restaurant","bar","fast_food","hotel","museum","theater","library","gallery","attraction"],
  "freeTextHint": "<extra context or empty string>"
}`

  try {
    const msg = await client.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 350,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: "user", content: prompt }],
    })

    const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}"
    // Strip markdown code fences if present
    const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    const parsed = JSON.parse(json)

    const locationQuery = (parsed.locationQuery ?? "").trim()

    const cats = parsed.categories
    return {
      locationQuery: locationQuery || extractLocationFallback(userQuery),
      nameHint:      quotedName || (parsed.nameHint ?? "").trim(),
      categories:    Array.isArray(cats) && cats.length > 0 ? cats : inferCategories(userQuery),
      freeTextHint:  parsed.freeTextHint ?? "",
    }
  } catch {
    return {
      locationQuery: extractLocationFallback(userQuery),
      nameHint:      quotedName,
      categories:    inferCategories(userQuery),
      freeTextHint:  "",
    }
  }
}

// Exported so tests can call the LLM with the base prompt (without the no-questions guard)
// and verify that the prompt structure alone produces summaries, not clarifying questions.
export function buildSummaryPrompt(places: Place[], locale: string): string {
  const isDE      = locale.startsWith("de")
  const total     = places.length
  const highConf  = places.filter((p) => p.overallConfidence >= 0.7).length
  const certified = places.filter((p) => p.primarySource === "reisen_fuer_alle").length

  const topNames = places
    .slice(0, 5)
    .map((p) => `${p.name} (${p.address.city || p.address.street})`)
    .join(", ")
  const moreHint = total > 5 ? (isDE ? ` und ${total - 5} weitere` : ` and ${total - 5} more`) : ""

  return isDE
    ? `Schreibe eine präzise 2-3-Satz-Zusammenfassung auf Deutsch für diese Suchergebnisse:\nGefundene Orte (${total}): ${topNames}${moreHint}.\n${highConf} davon sind verlässlich bewertet${certified > 0 ? `, ${certified} durch "Reisen für Alle" zertifiziert` : ""}.`
    : `Write a concise 2-3 sentence summary in English for these search results:\nFound places (${total}): ${topNames}${moreHint}.\n${highConf} have reliable ratings${certified > 0 ? `, ${certified} certified by "Reisen für Alle"` : ""}.`
}

export async function summariseResults(places: Place[], locale: string): Promise<string> {
  if (places.length === 0) return ""

  const isDE  = locale.startsWith("de")
  const guard = isDE
    ? "\nFasse zusammen was gefunden wurde. Keine Rückfragen, nur die Zusammenfassung."
    : "\nSummarise what was found. No questions, just the summary."

  try {
    const msg = await client.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 350,
      messages:   [{ role: "user", content: buildSummaryPrompt(places, locale) + guard }],
    })
    return msg.content[0].type === "text" ? msg.content[0].text.trim() : ""
  } catch {
    return ""
  }
}
