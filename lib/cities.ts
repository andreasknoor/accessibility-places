import type { Category } from "./types"

export type CitySlug =
  | "berlin" | "hamburg" | "muenchen" | "koeln" | "frankfurt"
  | "stuttgart" | "duesseldorf" | "leipzig" | "dresden" | "hannover"
  | "nuernberg" | "dortmund" | "bremen" | "bonn" | "freiburg"
  | "heidelberg" | "muenster" | "augsburg" | "karlsruhe" | "mannheim"
  | "wien" | "graz" | "salzburg" | "linz" | "innsbruck"
  | "zuerich" | "basel" | "bern" | "genf" | "lausanne" | "luzern" | "winterthur"

export interface City {
  slug:    CitySlug
  nameDe:  string
  nameEn:  string
  country: "de" | "at" | "ch"
  lat:     number
  lon:     number
}

export const CITIES: City[] = [
  // Deutschland
  { slug: "berlin",      nameDe: "Berlin",      nameEn: "Berlin",      country: "de", lat: 52.5200, lon: 13.4050 },
  { slug: "hamburg",     nameDe: "Hamburg",     nameEn: "Hamburg",     country: "de", lat: 53.5500, lon: 10.0000 },
  { slug: "muenchen",    nameDe: "München",     nameEn: "Munich",      country: "de", lat: 48.1372, lon: 11.5755 },
  { slug: "koeln",       nameDe: "Köln",        nameEn: "Cologne",     country: "de", lat: 50.9386, lon:  6.9600 },
  { slug: "frankfurt",   nameDe: "Frankfurt",   nameEn: "Frankfurt",   country: "de", lat: 50.1109, lon:  8.6821 },
  { slug: "stuttgart",   nameDe: "Stuttgart",   nameEn: "Stuttgart",   country: "de", lat: 48.7758, lon:  9.1829 },
  { slug: "duesseldorf", nameDe: "Düsseldorf",  nameEn: "Düsseldorf",  country: "de", lat: 51.2217, lon:  6.7762 },
  { slug: "leipzig",     nameDe: "Leipzig",     nameEn: "Leipzig",     country: "de", lat: 51.3397, lon: 12.3731 },
  { slug: "dresden",     nameDe: "Dresden",     nameEn: "Dresden",     country: "de", lat: 51.0504, lon: 13.7373 },
  { slug: "hannover",    nameDe: "Hannover",    nameEn: "Hanover",     country: "de", lat: 52.3759, lon:  9.7320 },
  { slug: "nuernberg",   nameDe: "Nürnberg",    nameEn: "Nuremberg",   country: "de", lat: 49.4521, lon: 11.0767 },
  { slug: "dortmund",    nameDe: "Dortmund",    nameEn: "Dortmund",    country: "de", lat: 51.5136, lon:  7.4653 },
  { slug: "bremen",      nameDe: "Bremen",      nameEn: "Bremen",      country: "de", lat: 53.0793, lon:  8.8017 },
  { slug: "bonn",        nameDe: "Bonn",        nameEn: "Bonn",        country: "de", lat: 50.7374, lon:  7.0982 },
  { slug: "freiburg",    nameDe: "Freiburg",    nameEn: "Freiburg",    country: "de", lat: 47.9990, lon:  7.8421 },
  { slug: "heidelberg",  nameDe: "Heidelberg",  nameEn: "Heidelberg",  country: "de", lat: 49.3988, lon:  8.6724 },
  { slug: "muenster",    nameDe: "Münster",     nameEn: "Münster",     country: "de", lat: 51.9607, lon:  7.6261 },
  { slug: "augsburg",    nameDe: "Augsburg",    nameEn: "Augsburg",    country: "de", lat: 48.3705, lon: 10.8978 },
  { slug: "karlsruhe",   nameDe: "Karlsruhe",   nameEn: "Karlsruhe",   country: "de", lat: 49.0069, lon:  8.4037 },
  { slug: "mannheim",    nameDe: "Mannheim",    nameEn: "Mannheim",    country: "de", lat: 49.4875, lon:  8.4660 },
  // Österreich
  { slug: "wien",        nameDe: "Wien",        nameEn: "Vienna",      country: "at", lat: 48.2082, lon: 16.3738 },
  { slug: "graz",        nameDe: "Graz",        nameEn: "Graz",        country: "at", lat: 47.0700, lon: 15.4400 },
  { slug: "salzburg",    nameDe: "Salzburg",    nameEn: "Salzburg",    country: "at", lat: 47.8095, lon: 13.0550 },
  { slug: "linz",        nameDe: "Linz",        nameEn: "Linz",        country: "at", lat: 48.3069, lon: 14.2858 },
  { slug: "innsbruck",   nameDe: "Innsbruck",   nameEn: "Innsbruck",   country: "at", lat: 47.2692, lon: 11.4041 },
  // Schweiz
  { slug: "zuerich",     nameDe: "Zürich",      nameEn: "Zurich",      country: "ch", lat: 47.3768, lon:  8.5417 },
  { slug: "basel",       nameDe: "Basel",       nameEn: "Basel",       country: "ch", lat: 47.5576, lon:  7.5923 },
  { slug: "bern",        nameDe: "Bern",        nameEn: "Bern",        country: "ch", lat: 46.9480, lon:  7.4474 },
  { slug: "genf",        nameDe: "Genf",        nameEn: "Geneva",      country: "ch", lat: 46.2044, lon:  6.1432 },
  { slug: "lausanne",    nameDe: "Lausanne",    nameEn: "Lausanne",    country: "ch", lat: 46.5197, lon:  6.6323 },
  { slug: "luzern",      nameDe: "Luzern",      nameEn: "Lucerne",     country: "ch", lat: 47.0502, lon:  8.3093 },
  { slug: "winterthur",  nameDe: "Winterthur",  nameEn: "Winterthur",  country: "ch", lat: 47.5001, lon:  8.7238 },
]

export const CITY_MAP = new Map<CitySlug, City>(CITIES.map((c) => [c.slug, c]))

// URL segment → internal Category value
export const SEO_CATEGORY_SLUGS: Record<string, Category> = {
  cafe:        "cafe",
  restaurant:  "restaurant",
  bar:         "bar",
  pub:         "pub",
  biergarten:  "biergarten",
  "fast-food": "fast_food",
  hotel:       "hotel",
  hostel:      "hostel",
  apartment:   "apartment",
  museum:      "museum",
  theater:     "theater",
  cinema:      "cinema",
  library:     "library",
  gallery:     "gallery",
  attraction:  "attraction",
}

// Internal Category value → URL slug
export const SEO_CATEGORY_TO_SLUG: Partial<Record<Category, string>> = Object.fromEntries(
  Object.entries(SEO_CATEGORY_SLUGS).map(([slug, cat]) => [cat, slug]),
) as Partial<Record<Category, string>>

// CHIPS array index in ChatPanel for visual chip pre-selection
// (undefined = no matching chip; search still works via query term)
export const SEO_CATEGORY_TO_CHIP_IDX: Partial<Record<string, number>> = {
  restaurant: 0,
  cafe:       1,
  hotel:      2,
  biergarten: 3,
  pub:        4,
  museum:     5,
  theater:    6,
  cinema:     7,
}

// Query term that parseQuery() server-side recognises for each category slug
export const SEO_CATEGORY_QUERY_TERM: Record<string, { de: string; en: string }> = {
  cafe:        { de: "Cafés",             en: "Cafés" },
  restaurant:  { de: "Restaurants",      en: "Restaurants" },
  bar:         { de: "Bar",              en: "Bar" },
  pub:         { de: "Kneipe",           en: "Pub" },
  biergarten:  { de: "Biergarten",       en: "Beer Garden" },
  "fast-food": { de: "Imbiss",           en: "Fast Food" },
  hotel:       { de: "Hotel",            en: "Hotel" },
  hostel:      { de: "Hostel",           en: "Hostel" },
  apartment:   { de: "Ferienwohnung",    en: "Apartment" },
  museum:      { de: "Museen",           en: "Museum" },
  theater:     { de: "Theater",          en: "Theater" },
  cinema:      { de: "Kino",             en: "Cinema" },
  library:     { de: "Bibliothek",       en: "Library" },
  gallery:     { de: "Galerie",          en: "Gallery" },
  attraction:  { de: "Sehenswürdigkeit", en: "Attraction" },
}

// Plural display labels for page headings
export const SEO_CATEGORY_LABEL: Record<string, { de: string; en: string }> = {
  cafe:        { de: "Cafés",               en: "Cafés" },
  restaurant:  { de: "Restaurants",         en: "Restaurants" },
  bar:         { de: "Bars",                en: "Bars" },
  pub:         { de: "Kneipen & Pubs",      en: "Pubs" },
  biergarten:  { de: "Biergärten",          en: "Beer Gardens" },
  "fast-food": { de: "Imbisse & Fast Food", en: "Fast Food Restaurants" },
  hotel:       { de: "Hotels",              en: "Hotels" },
  hostel:      { de: "Hostels",             en: "Hostels" },
  apartment:   { de: "Ferienwohnungen",     en: "Apartments" },
  museum:      { de: "Museen",              en: "Museums" },
  theater:     { de: "Theater",             en: "Theaters" },
  cinema:      { de: "Kinos",               en: "Cinemas" },
  library:     { de: "Bibliotheken",        en: "Libraries" },
  gallery:     { de: "Galerien",            en: "Galleries" },
  attraction:  { de: "Sehenswürdigkeiten",  en: "Attractions" },
}
