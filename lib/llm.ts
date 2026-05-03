import type { Category, ParsedQuery } from "./types"

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
  ice_cream:   ["eisdiele", "eisdielen", "eis", "gelato", "gelateria", "ice cream", "icecream"],
}

const ALL_CATEGORIES: Category[] = [
  "cafe","restaurant","bar","pub","biergarten","fast_food",
  "hotel","hostel","apartment",
  "museum","theater","cinema","library","gallery","attraction","ice_cream",
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

// Supports straight, curly, German typographic and guillemet quote styles.
// Character class uses Unicode code-point escapes to avoid encoding issues.
// “ U+0022  ' U+0027  „ U+201E  “ U+201C  “ U+201D  ‟ U+201F  « U+00AB  » U+00BB  ‹ U+2039  › U+203A
const QUOTE_CLASS = '[\\u0022\\u0027\\u201E\\u201C\\u201D\\u201F\\u00AB\\u00BB\\u2039\\u203A]'
const QUOTE_INNER = '[^\\u0022\\u0027\\u201E\\u201C\\u201D\\u201F\\u00AB\\u00BB\\u2039\\u203A]'
const QUOTE_RE    = new RegExp(`${QUOTE_CLASS}(${QUOTE_INNER}+)${QUOTE_CLASS}`, 'u')

export function extractQuotedName(query: string): string {
  const m = query.match(QUOTE_RE)
  return m ? m[1].trim() : ''
}

export function extractLocationFallback(query: string): string {
  const match = query.match(
    /\bin\s+([A-ZÄÖÜ][a-zA-ZäöüÄÖÜß\s\-,]+?)(?:\s*$|\s+(?:und|oder|mit|für|nahe|near|and|or|with)\b)/i,
  )
  if (match) return match[1].trim()

  const words = query.split(/\s+/)
  const capitalised = words.filter((w) => /^[A-ZÄÖÜ]/.test(w))
  return capitalised.slice(-2).join(" ") || query
}

/**
 * Deterministic query parser — no LLM involved.
 *
 * The UI always sends: "<ChipLabel> in <LocationInput>"
 * where <LocationInput> may contain a quoted name like "Goldener Löwe".
 *
 * Rules:
 *   - Quoted text → nameHint (signals a named-place search)
 *   - Remaining text after stripping quotes → location for Nominatim
 *   - Categories inferred from chip label via CATEGORY_HINTS regex
 */
export function parseQuery(userQuery: string): ParsedQuery {
  const nameHint = extractQuotedName(userQuery)

  const withoutName = nameHint
    ? userQuery.replace(QUOTE_RE, "").replace(/\s+/g, " ").trim()
    : userQuery

  const locationQuery = extractLocationFallback(withoutName).trim() || withoutName.trim()

  return {
    locationQuery,
    nameHint,
    categories: inferCategories(userQuery),
    freeTextHint: "",
  }
}
