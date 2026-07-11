import type { Category, ParsedQuery } from "./types"

const CATEGORY_HINTS: Record<Category, string[]> = {
  cafe:        ["cafe", "café", "kaffee", "kaffeehaus", "bistro", "coffee", "brunch", "frühstück", "breakfast", "eisdiele", "eisdielen", "eis", "gelato", "gelateria", "ice cream", "icecream", "eiscafe", "eiscafé"],
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
  pharmacy:    ["apotheke", "pharmacy", "pharmacies"],
  doctors:     ["arzt", "arztpraxis", "praxis", "hausarzt", "facharzt", "ärztehaus", "doctor", "gp", "clinic", "klinik"],
  dentist:     ["zahnarzt", "zahnärztin", "zahnarztpraxis", "dentist", "dental"],
  veterinary:  ["tierarzt", "tierärztin", "tierarztpraxis", "tierarztpraxis", "vet", "veterinary", "veterinarian", "kleintierpraxis"],
  hospital:    ["krankenhaus", "klinikum", "klinik", "hospital", "notaufnahme", "spital"],
  chemist:     ["drogerie", "drugstore", "chemist", "rossmann", "dm ", "müller"],
  supermarket: ["supermarkt", "supermarket", "lebensmittel", "edeka", "rewe", "aldi", "lidl", "netto", "penny", "billa", "spar"],
  bakery:      ["bäckerei", "bäcker", "bakery", "backstube", "konditorei"],
  hairdresser: ["friseur", "frisör", "friseurin", "hairdresser", "hairstylist", "barbier", "barber"],
  bank:        ["bank", "sparkasse", "volksbank", "raiffeisenbank", "commerzbank", "deutsche bank"],
  post_office: ["post", "postamt", "post office", "deutsche post", "österreichische post", "briefkasten"],
  zoo:         ["zoo", "tierpark", "tierpark", "aquarium", "zoopark", "wildpark", "vogelpark", "wildgehege"],
  camp_site:       ["campingplatz", "camping", "campsite", "caravan", "wohnmobilstellplatz"],
  swimming_pool:   ["schwimmbad", "hallenbad", "freibad", "schwimmhalle", "swimming pool"],
  fitness_centre:  ["fitnessstudio", "fitness studio", "fitness center", "fitnesscenter", "sportstudio", "gym"],
  playground:      ["spielplatz", "playground"],
  // "park$" (trailing "$") opts into exact-word matching so the bare chip
  // label "Park" self-classifies without also firing on "Parkplatz" /
  // "Parkhaus" / "parking" — see the exactWord handling in matchedCategories
  // above. Deliberately NOT a bare "parking" hint: that AmenityType has its
  // own dedicated 🅿 chip, not a free-text category.
  park:            ["park$", "parkanlage", "grünanlage", "stadtpark", "volkspark", "city park", "public park"],
  physiotherapist: ["physiotherapie", "physiotherapist", "krankengymnastik", "physio"],
  medical_supply:  ["sanitätshaus", "medical supply"],
  hearing_aids:    ["hörakustiker", "hörgeräte", "hearing aids", "akustiker"],
  optician:        ["optiker", "optician", "brillengeschäft"],
  townhall:          ["rathaus", "bürgeramt", "bürgerbüro", "stadtverwaltung", "gemeindeamt", "town hall"],
  place_of_worship:  ["kirche", "moschee", "synagoge", "gotteshaus", "kapelle", "church", "mosque", "synagogue", "place of worship"],
  railway_station:   ["bahnhof", "hauptbahnhof", "train station", "railway station"],
}

export const ALL_CATEGORIES: Category[] = [
  "cafe","restaurant","bar","pub","biergarten","fast_food",
  "hotel","hostel","apartment","camp_site",
  "museum","theater","cinema","library","gallery","attraction",
  "pharmacy","doctors","dentist","veterinary","hospital",
  "chemist","supermarket","bakery","hairdresser",
  "bank","post_office","zoo",
  "swimming_pool","fitness_centre","playground","park",
  "physiotherapist","medical_supply","hearing_aids","optician",
  "townhall","place_of_worship","railway_station",
]

function normaliseForMatch(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
}

// Hints spanning multiple words ("fast food") — matched against adjacent word
// pairs in extractLocationFallback, since the per-word category check cannot
// see them. Trimmed first so hints with only a trailing space ("dm ") do not
// qualify (they would wrongly flag the following word, e.g. a city).
const MULTIWORD_HINTS: string[] = Object.values(CATEGORY_HINTS)
  .flat()
  .map((h) => normaliseForMatch(h).trim())
  .filter((h) => h.includes(" "))

// Matched categories only — [] when nothing matches (no all-categories
// fallback). Used by inferCategories and by the location fallback below to
// recognise category words.
function matchedCategories(query: string): Category[] {
  const lower = normaliseForMatch(query)
  const found: Category[] = []
  for (const [cat, hints] of Object.entries(CATEGORY_HINTS) as [Category, string[]][]) {
    if (hints.some((h) => {
      const norm = normaliseForMatch(h)
      // Short hints (≤3 chars) need a word boundary at the end to avoid false
      // positives like "bar" matching "barrierefreie". An optional trailing "s"
      // is allowed so plurals still match ("bar"→"bars", "pub"→"pubs") without
      // re-opening the "barrierefrei" false positive (the trailing \b still holds).
      // A hint ending in "$" opts a LONGER (>3 char) hint into the same
      // exact-word treatment — for words like "park" that are real category
      // terms on their own but are also a risky prefix of unrelated compounds
      // ("Parkplatz", "Parkhaus", "parking"). No existing hint contains a
      // literal "$", so this is purely additive.
      const exactWord = norm.endsWith("$")
      const stem = exactWord ? norm.slice(0, -1) : norm
      const pattern = norm.length <= 3 || exactWord ? `\\b${stem}s?\\b` : `\\b${stem}`
      return new RegExp(pattern, "i").test(lower)
    })) found.push(cat)
  }
  return found
}

export function inferCategories(query: string): Category[] {
  const found = matchedCategories(query)
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

  // Leading char class and body accept digits so postal-code locations work
  // ("Restaurants in 67433 Neustadt" — the PLZ disambiguates between the many
  // towns sharing a name; Nominatim resolves "PLZ Ort" queries natively).
  const match = stripped.match(
    /\bin\s+([A-ZÄÖÜ0-9][a-zA-Z0-9äöüÄÖÜß\s\-,]+?)(?:\s*$|\s+(?:und|oder|mit|für|nahe|near|and|or|with)\b)/i,
  )
  if (match) {
    const loc = match[1].trim()
    return cc ? `${loc} (${cc})` : loc
  }

  const words      = stripped.split(/\s+/)
  // Two tiers of category flags per word, because their certainty differs:
  //  - wordFlag: a single word matches a hint ("Arzt") — but this is AMBIGUOUS,
  //    the word can be a city that doubles as a category term ("Essen").
  //  - phraseFlag: the word is part of an adjacent pair matching a multi-word
  //    hint ("Fast Food") — near-certainly categorial, never a city name.
  const wordFlag   = words.map((w) => matchedCategories(w).length > 0)
  const phraseFlag = words.map(() => false)
  for (let i = 0; i + 1 < words.length; i++) {
    const pair = normaliseForMatch(`${words[i]} ${words[i + 1]}`)
    if (MULTIWORD_HINTS.some((h) => pair.startsWith(h))) {
      phraseFlag[i] = true
      phraseFlag[i + 1] = true
    }
  }
  // Location candidates: capitalised words plus postal codes (4 digits AT/CH,
  // 5 digits DE) — "67433 Neustadt" must reach Nominatim with the PLZ intact.
  const isLocToken  = (w: string) => /^[A-ZÄÖÜ]/.test(w) || /^\d{4,5}$/.test(w)
  const capitalised = words.filter(isLocToken)
  // Many real DACH places are literally "<Name> <generic word>" — "Görlitzer
  // Park", "Treptower Park" — where the trailing word also happens to be
  // category vocabulary (the "park" hint added for the Park category, see
  // CATEGORY_HINTS). Unlike a LEADING category word ("Arzt Frankenthal",
  // clearly a prefix, not part of the city name), a capitalised category word
  // that's the LAST token and follows another capitalised word reads as a
  // compound proper name — un-flag it so it survives into the location
  // instead of being stripped to just "Görlitzer".
  const lastIdx = words.length - 1
  if (lastIdx > 0 && wordFlag[lastIdx] && isLocToken(words[lastIdx]) && isLocToken(words[lastIdx - 1])) {
    wordFlag[lastIdx] = false
  }
  // Drop recognised category words, preferring the least-ambiguous survivors:
  //  1. tokens with no category flag at all ("Arzt Frankenthal" → "Frankenthal");
  //  2. else tokens that are only word-flagged — those may be cities like
  //     "Essen" ("Fast Food Essen" → "Essen", not "Food Essen");
  //  3. else keep everything (bare "Essen", or a pure category phrase) — a bare
  //     city name must not be stripped into an empty query.
  const unflagged  = words.filter((w, i) => isLocToken(w) && !wordFlag[i] && !phraseFlag[i])
  const wordOnly   = words.filter((w, i) => isLocToken(w) && !phraseFlag[i])
  const candidates = unflagged.length > 0 ? unflagged : wordOnly.length > 0 ? wordOnly : capitalised
  const loc        = candidates.slice(-2).join(" ") || stripped
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
