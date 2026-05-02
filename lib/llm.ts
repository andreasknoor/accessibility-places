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
  bar:         ["bar", "cocktail"],
  pub:         ["pub", "kneipe"],
  biergarten:  ["biergarten", "bier"],
  fast_food:   ["fast food", "fastfood", "imbiss", "döner", "burger", "pizza"],
  hotel:       ["hotel", "motel", "unterkunft", "übernachtung", "pension", "gästehaus", "lodge"],
  hostel:      ["hostel"],
  apartment:   ["apartment", "ferienwohnung", "fewo"],
  museum:      ["museum", "museen"],
  theater:     ["theater", "theatre", "oper", "schauspiel"],
  cinema:      ["kino", "cinema"],
  library:     ["bibliothek", "bücherei", "library"],
  gallery:     ["galerie", "gallery", "kunsthalle", "ausstellung"],
  attraction:  ["sehenswürdigkeit", "attraktion", "attraction", "freizeitpark", "zoo"],
}

const ALL_CATEGORIES: Category[] = [
  "cafe","restaurant","bar","pub","biergarten","fast_food",
  "hotel","hostel","apartment",
  "museum","theater","cinema","library","gallery","attraction",
]

function normaliseForMatch(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
}

export function inferCategories(query: string): Category[] {
  const lower = normaliseForMatch(query)
  const found: Category[] = []
  for (const [cat, hints] of Object.entries(CATEGORY_HINTS) as [Category, string[]][]) {
    if (hints.some((h) => new RegExp(`\\b${normaliseForMatch(h)}\\b`, "i").test(lower))) found.push(cat)
  }
  return found.length > 0 ? found : [...ALL_CATEGORIES]
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

  const allCatsJson = JSON.stringify(ALL_CATEGORIES)

  const prompt = `Analyse this accessibility search query and extract structured fields.

Rules:
- "locationQuery": ONLY the city, district, or address — no category words, no "in", no "barrierefreie"
- "nameHint": specific business name the user is asking about; empty string if searching by category only.
  IMPORTANT: treat unusual or abstract-sounding words as potential business names (e.g. "et cetera", "Zur Eiche", "No Name Bar").
- "categories": infer from context. Be specific — distinguish bar / pub / biergarten, theater / cinema, hotel / hostel / apartment.
  For named places (nameHint set), make a best guess from the name (e.g. "Brauhaus X" → ["pub","biergarten"], "Café X" → ["cafe"], "Hotel X" → ["hotel"]).
  Only return ALL categories if the name gives absolutely no hint about its type.
  Allowed values: ${allCatsJson}.
- "freeTextHint": extra context like dietary preferences, atmosphere, etc.

Examples:
  - "Finde Restaurants in Spandau" → locationQuery:"Spandau", nameHint:"", categories:["restaurant"]
  - "Biergärten in München" → locationQuery:"München", nameHint:"", categories:["biergarten"]
  - "Kino in Berlin Mitte" → locationQuery:"Berlin Mitte", nameHint:"", categories:["cinema"]
  - "Hostel in Hamburg" → locationQuery:"Hamburg", nameHint:"", categories:["hostel"]
  - "Pubs in Köln" → locationQuery:"Köln", nameHint:"", categories:["pub"]
  - "et cetera in Potsdam" → locationQuery:"Potsdam", nameHint:"et cetera", categories:${allCatsJson}
  - "Ist das Brauhaus Georgbräu in Berlin barrierefrei?" → locationQuery:"Berlin", nameHint:"Brauhaus Georgbräu", categories:["restaurant","pub","biergarten"]
  - "Wilhelms Burger Gleimstraße Berlin" → locationQuery:"Berlin", nameHint:"Wilhelms Burger", categories:["fast_food","restaurant"]
  - "Rollstuhlgerechte Cafés in Berlin Mitte" → locationQuery:"Berlin Mitte", nameHint:"", categories:["cafe"]
  - "Barrierefreie Museen München" → locationQuery:"München", nameHint:"", categories:["museum"]

Query: ${JSON.stringify(userQuery)}

Return JSON:
{
  "locationQuery": "<city or district only>",
  "nameHint": "<specific business name or empty string>",
  "categories": ${allCatsJson},
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

