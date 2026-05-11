import type { Category } from "./types"

export type CitySlug =
  | "berlin" | "hamburg" | "muenchen" | "koeln" | "frankfurt"
  | "wien" | "graz" | "zuerich" | "basel" | "bern"

export interface City {
  slug:    CitySlug
  nameDe:  string
  nameEn:  string
  country: "de" | "at" | "ch"
  lat:     number
  lon:     number
}

export const CITIES: City[] = [
  { slug: "berlin",    nameDe: "Berlin",    nameEn: "Berlin",    country: "de", lat: 52.5200, lon: 13.4050 },
  { slug: "hamburg",   nameDe: "Hamburg",   nameEn: "Hamburg",   country: "de", lat: 53.5500, lon: 10.0000 },
  { slug: "muenchen",  nameDe: "München",   nameEn: "Munich",    country: "de", lat: 48.1372, lon: 11.5755 },
  { slug: "koeln",     nameDe: "Köln",      nameEn: "Cologne",   country: "de", lat: 50.9386, lon:  6.9600 },
  { slug: "frankfurt", nameDe: "Frankfurt", nameEn: "Frankfurt", country: "de", lat: 50.1109, lon:  8.6821 },
  { slug: "wien",      nameDe: "Wien",      nameEn: "Vienna",    country: "at", lat: 48.2082, lon: 16.3738 },
  { slug: "graz",      nameDe: "Graz",      nameEn: "Graz",      country: "at", lat: 47.0700, lon: 15.4400 },
  { slug: "zuerich",   nameDe: "Zürich",    nameEn: "Zurich",    country: "ch", lat: 47.3768, lon:  8.5417 },
  { slug: "basel",     nameDe: "Basel",     nameEn: "Basel",     country: "ch", lat: 47.5576, lon:  7.5923 },
  { slug: "bern",      nameDe: "Bern",      nameEn: "Bern",      country: "ch", lat: 46.9480, lon:  7.4474 },
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
