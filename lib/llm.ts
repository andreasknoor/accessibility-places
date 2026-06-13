import type { Category, ParsedQuery } from "./types"

const CATEGORY_HINTS: Record<Category, string[]> = {
  cafe:        ["cafe", "café", "kaffee", "kaffeehaus", "bistro", "coffee", "brunch", "frühstück", "breakfast"],
  restaurant:  ["restaurant", "essen", "speiselokal", "gastronomie", "gastro", "lokal", "sushi", "pizzeria", "ristorante", "trattoria", "steakhouse", "brasserie"],
  bar:         ["bar", "cocktail", "weinbar", "wine bar"],
  pub:         ["pub", "kneipe", "brauhaus"],
  biergarten:  ["biergarten", "beer garden", "bier"],
  fast_food:   ["fast food", "fastfood", "imbiss", "döner", "burger", "pizza", "kebab", "currywurst", "snack"],
  hotel:       ["hotel", "motel", "unterkunft", "übernachtung", "übernachten", "pension", "gästehaus", "lodge"],
  hostel:      ["hostel"],
  apartment:   ["apartment", "ferienwohnung", "fewo"],
  museum:      ["museum", "museen"],
  theater:     ["theater", "theatre", "oper", "schauspiel", "musical", "bühne"],
  cinema:      ["kino", "cinema", "filmtheater", "lichtspielhaus", "movie"],
  library:     ["bibliothek", "bücherei", "library", "stadtbibliothek", "stadtbücherei", "mediathek"],
  gallery:     ["galerie", "gallery", "kunsthalle", "ausstellung"],
  attraction:  ["sehenswürdigkeit", "attraktion", "attraction", "freizeitpark", "ausflugsziel"],
  ice_cream:   ["eisdiele", "eisdielen", "eis", "gelato", "gelateria", "ice cream", "icecream", "eiscafe", "eiscafé"],
  pharmacy:    ["apotheke", "pharmacy"],
  doctors:     ["arzt", "arztpraxis", "praxis", "hausarzt", "facharzt", "ärztehaus", "doctor", "gp", "clinic", "klinik"],
  dentist:     ["zahnarzt", "zahnärztin", "zahnarztpraxis", "dentist", "dental"],
  veterinary:  ["tierarzt", "tierärztin", "tierarztpraxis", "tierarztpraxis", "vet", "veterinary", "kleintierpraxis"],
  hospital:    ["krankenhaus", "klinikum", "klinik", "hospital", "notaufnahme", "spital"],
  chemist:     ["drogerie", "drugstore", "chemist", "rossmann", "dm ", "müller"],
  supermarket: ["supermarkt", "supermarket", "lebensmittel", "edeka", "rewe", "aldi", "lidl", "netto", "penny", "billa", "spar"],
  bakery:      ["bäckerei", "bäcker", "bakery", "backstube", "konditorei"],
  hairdresser: ["friseur", "frisör", "friseurin", "hairdresser", "hairstylist", "barbier", "barber"],
  bank:        ["bank", "sparkasse", "volksbank", "raiffeisenbank", "commerzbank", "deutsche bank"],
  post_office: ["post", "postamt", "post office", "deutsche post", "österreichische post", "briefkasten"],
  zoo:         ["zoo", "tierpark", "tierpark", "aquarium", "zoopark", "wildpark", "vogelpark", "wildgehege"],
}

const ALL_CATEGORIES: Category[] = [
  "cafe","restaurant","bar","pub","biergarten","fast_food",
  "hotel","hostel","apartment",
  "museum","theater","cinema","library","gallery","attraction","ice_cream",
  "pharmacy","doctors","dentist","veterinary","hospital",
  "chemist","supermarket","bakery","hairdresser",
  "bank","post_office","zoo",
]

function normaliseForMatch(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
}

export function inferCategories(query: string): Category[] {
  const lower = normaliseForMatch(query)
  const found: Category[] = []
  for (const [cat, hints] of Object.entries(CATEGORY_HINTS) as [Category, string[]][]) {
    if (hints.some((h) => {
      const norm = normaliseForMatch(h)
      // Short hints (≤3 chars) need a word boundary at the end to avoid false
      // positives like "bar" matching "barrierefreie".
      const pattern = norm.length <= 3 ? `\\b${norm}\\b` : `\\b${norm}`
      return new RegExp(pattern, "i").test(lower)
    })) found.push(cat)
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
  // The geocode-suggest endpoint appends "(CC)" country codes to display labels
  // (e.g. "Basel (CH)"). Strip it before matching so the character-class regex
  // doesn't fail, then reattach so Nominatim still gets the disambiguation hint.
  const ccMatch    = query.match(/\s*\(([A-Z]{2,3})\)\s*$/)
  const cc         = ccMatch?.[1] ?? ""
  const stripped   = cc ? query.slice(0, query.lastIndexOf(ccMatch![0])).trimEnd() : query

  const match = stripped.match(
    /\bin\s+([A-ZÄÖÜ][a-zA-ZäöüÄÖÜß\s\-,]+?)(?:\s*$|\s+(?:und|oder|mit|für|nahe|near|and|or|with)\b)/i,
  )
  if (match) {
    const loc = match[1].trim()
    return cc ? `${loc} (${cc})` : loc
  }

  const words      = stripped.split(/\s+/)
  const capitalised = words.filter((w) => /^[A-ZÄÖÜ]/.test(w))
  const loc        = capitalised.slice(-2).join(" ") || stripped
  return cc ? `${loc} (${cc})` : loc
}

/**
 * Deterministic query parser — no LLM involved.
 *
 * The UI sends either "<ChipLabel> in <Location>" (chip selected), raw user
 * text ("Sushi in Berlin"), or "in <Location>" (all-categories search).
 * Categories are inferred only from the part BEFORE the first "in" — city
 * and district names must not trigger category hints (the city "Essen"
 * matches the restaurant hint "essen" otherwise). A query without "in"
 * is scanned as a whole, as before. No category hint → all categories.
 * Name filtering is handled separately as a post-filter on results.
 */
export function parseQuery(userQuery: string): ParsedQuery {
  const locationQuery = extractLocationFallback(userQuery).trim() || userQuery.trim()

  const inIdx        = userQuery.search(/\bin\s/i)
  const categoryPart = inIdx >= 0 ? userQuery.slice(0, inIdx) : userQuery

  return {
    locationQuery,
    categories: inferCategories(categoryPart),
    freeTextHint: "",
  }
}
