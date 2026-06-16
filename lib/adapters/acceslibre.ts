/**
 * AccèsLibre adapter — https://acceslibre.beta.gouv.fr/api/erps/
 * French government accessibility database. REST API, Api-Key auth.
 * Set ACCESLIBRE_API_KEY in .env.local (request at acceslibre.beta.gouv.fr).
 * Coverage: France only. Only runs when international mode is active and the
 * search centre is inside the FR bounding box.
 */
import type { Place, SearchParams, A11yValue, Category, EntranceDetails } from "../types"
import { buildAttribute } from "../matching/merge"
import { RELIABILITY_WEIGHTS, INTL_COUNTRIES, CATEGORY_OSM_TAGS } from "../config"
import { nanoid } from "../utils"

const ENDPOINT = "https://acceslibre.beta.gouv.fr/api/erps/"
const MAX_PAGES  = 2
const PAGE_SIZE  = 50
// Cap the per-category fan-out so a multi-category search can't explode into
// dozens of upstream calls. A selected category maps to ≤3 AccèsLibre slugs, so
// this comfortably covers a handful of categories at once.
const MAX_SLUGS = 12
// Total distinct categories the app knows about. When the search asks for (close
// to) all of them — the "Alle" default — fanning out per slug would mean ~50
// calls; instead we fall back to a single unfiltered nearest-N fetch.
const ALL_CATEGORY_COUNT = Object.keys(CATEGORY_OSM_TAGS).length

// ─── FR bounding box ──────────────────────────────────────────────────────────
// Taken from INTL_COUNTRIES in config.ts: { code: "FR", bbox: [-5.14, 41.33, 9.56, 51.09] }
// [minLon, minLat, maxLon, maxLat]
const FR_BBOX = INTL_COUNTRIES.find((c) => c.code === "FR")!.bbox

function isInFrance(lat: number, lon: number): boolean {
  const [minLon, minLat, maxLon, maxLat] = FR_BBOX
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat
}

// ─── Category mapping (AccèsLibre activite slug → our Category) ──────────────
const FROM_ACCESLIBRE: Partial<Record<string, Category>> = {
  "restaurant":                        "restaurant",
  "hotel-restaurant":                  "restaurant",
  "restaurant-scolaire":               "restaurant",
  "cafeteria":                         "cafe",
  "salon-de-the":                      "cafe",
  "cafe-et-thes":                      "cafe",
  "bar-tabac":                         "bar",
  "discotheque":                       "bar",
  "karaoke":                           "bar",
  "restauration-rapide":               "fast_food",
  "hotel":                             "hotel",
  "pension-gite":                      "hotel",
  "auberge-de-jeunesse":               "hostel",
  "residence-de-tourisme":             "apartment",
  "hebergement-insolite":              "apartment",
  "village-de-vacances":               "hotel",
  "musee":                             "museum",
  "monument-historique":               "attraction",
  "lieu-de-visite":                    "attraction",
  "theatre":                           "theater",
  "opera":                             "theater",
  "salle-de-spectacle":                "theater",
  "salle-de-concert":                  "theater",
  "cinema":                            "cinema",
  "bibliotheque-mediatheque":          "library",
  "salle-dexposition":                 "gallery",
  "parc-dattraction-et-parc-a-theme": "attraction",
  "aquarium":                          "zoo",
  "jardin-botanique-etou-zoologique":  "zoo",
  "pharmacie":                         "pharmacy",
  "medecin-generaliste":               "doctors",
  "cabinet-medical":                   "doctors",
  "maison-de-sante-ou-centre-de-sante": "doctors",
  "chirurgien-dentiste":               "dentist",
  "veterinaire":                       "veterinary",
  "hopital":                           "hospital",
  "clinique":                          "hospital",
  "etablissement-de-sante":            "hospital",
  "droguerie":                         "chemist",
  "supermarche":                       "supermarket",
  "hypermarche":                       "supermarket",
  "superette":                         "supermarket",
  "boulangerie-patisserie":            "bakery",
  "coiffure":                          "hairdresser",
  "barbier":                           "hairdresser",
  "banques-caisses-depargne":          "bank",
  "bureau-de-poste":                   "post_office",
  "glacier":                           "ice_cream",
  "confiserie":                        "ice_cream",
}

// Reverse map (our Category → AccèsLibre activite slugs), derived from
// FROM_ACCESLIBRE so the two can never drift apart. Used to push the category
// filter up to the API via `activite=<slug>` instead of fetching the nearest
// results of every type and discarding most of them downstream.
const TO_ACCESLIBRE: Partial<Record<Category, string[]>> = {}
for (const [slug, cat] of Object.entries(FROM_ACCESLIBRE) as [string, Category][]) {
  ;(TO_ACCESLIBRE[cat] ??= []).push(slug)
}

// ─── API response types ───────────────────────────────────────────────────────

interface AccesLibreEntree {
  entree_plain_pied:    boolean | null
  entree_marches:       number  | null
  entree_marches_rampe: string  | null  // "aucune" | "fixe" | "amovible" | null
  entree_ascenseur:     boolean | null
  entree_pmr:           boolean | null
  entree_largeur_mini:  number  | null
  entree_porte_type:    string  | null  // "automatique" | "manuelle" | null
}

interface AccesLibreAccueil {
  sanitaires_presence: boolean | null
  sanitaires_adaptes:  boolean | null
}

interface AccesLibreTransport {
  stationnement_pmr:     boolean | null
  stationnement_ext_pmr: boolean | null
}

interface AccesLibreItem {
  uuid:          string
  web_url:       string
  nom:           string
  adresse:       string
  commune:       string
  code_postal:   string
  site_internet: string | null
  activite:      { nom: string; slug: string } | null
  geom:          { type: "Point"; coordinates: [number, number] }  // [lon, lat]
  accessibilite: {
    entree?:    AccesLibreEntree
    accueil?:   AccesLibreAccueil
    transport?: AccesLibreTransport
  } | null
}

interface AccesLibrePage {
  count:   number
  next:    string | null
  results: AccesLibreItem[]
}

// ─── Value derivation ─────────────────────────────────────────────────────────

function deriveEntrance(e: AccesLibreEntree | undefined): { value: A11yValue; details: EntranceDetails } {
  const details: EntranceDetails = {
    isLevel:          e?.entree_plain_pied   ?? undefined,
    stepCount:        e?.entree_marches      ?? undefined,
    hasRamp:          e?.entree_marches_rampe
                        ? e.entree_marches_rampe !== "aucune"
                        : undefined,
    hasHoist:         e?.entree_ascenseur    ?? undefined,
    doorWidthCm:      e?.entree_largeur_mini ?? undefined,
    hasAutomaticDoor: e?.entree_porte_type === "automatique"
                        ? true
                        : e?.entree_porte_type === "manuelle"
                          ? false
                          : undefined,
  }

  if (!e) return { value: "unknown", details }

  // Step 1: base value from plain-pied / steps
  let value: A11yValue = "unknown"
  if (e.entree_plain_pied === true) {
    value = "yes"
  } else if (e.entree_marches != null && e.entree_marches > 0) {
    const hasOvercome =
      (e.entree_marches_rampe != null && e.entree_marches_rampe !== "aucune") ||
      e.entree_ascenseur === true
    value = hasOvercome ? "limited" : "no"
  }

  // Step 2: PMR entrance can only upgrade (never downgrade)
  if (e.entree_pmr === true && value === "unknown") {
    value = "limited"
  }

  return { value, details }
}

function deriveToilet(a: AccesLibreAccueil | undefined): A11yValue {
  if (!a) return "unknown"
  if (a.sanitaires_adaptes === true)                                         return "yes"
  if (a.sanitaires_presence === true && a.sanitaires_adaptes === false)      return "no"
  return "unknown"
}

function deriveParking(t: AccesLibreTransport | undefined): A11yValue {
  if (!t) return "unknown"
  if (t.stationnement_pmr === true)     return "yes"
  if (t.stationnement_ext_pmr === true) return "limited"
  return "unknown"
}

// ─── Bbox helper ──────────────────────────────────────────────────────────────

function searchBbox(lat: number, lon: number, radiusKm: number): string {
  const latDeg = radiusKm / 111.32
  const lonDeg = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180))
  const minLon = lon - lonDeg
  const minLat = lat - latDeg
  const maxLon = lon + lonDeg
  const maxLat = lat + latDeg
  return `${minLon},${minLat},${maxLon},${maxLat}`
}

// ─── Fetch one page ───────────────────────────────────────────────────────────

async function fetchPage(
  apiKey: string,
  around: string,
  zone: string,
  page: number,
  activite?: string,
  signal?: AbortSignal,
): Promise<AccesLibrePage> {
  const url = new URL(ENDPOINT)
  url.searchParams.set("around",    around)
  url.searchParams.set("zone",      zone)
  url.searchParams.set("page",      String(page))
  url.searchParams.set("page_size", String(PAGE_SIZE))
  if (activite) url.searchParams.set("activite", activite)

  const res = await fetch(url.toString(), {
    method:  "GET",
    headers: {
      "Accept":        "application/json",
      "Authorization": `Api-Key ${apiKey}`,
    },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  })

  if (!res.ok) throw new Error(`AccèsLibre API error: ${res.status}`)
  return res.json() as Promise<AccesLibrePage>
}

// ─── Map one result item → Place ──────────────────────────────────────────────

function itemToPlace(item: AccesLibreItem): Place | null {
  const slug = item.activite?.slug ?? ""
  const category = FROM_ACCESLIBRE[slug]
  if (!category) return null  // unmapped activite — skip

  // geom.coordinates is [lon, lat] — swap to [lat, lon]
  const [lon, lat] = item.geom.coordinates

  const acc = item.accessibilite ?? {}
  const { value: entranceValue, details: entranceDetails } = deriveEntrance(acc.entree)
  const toiletValue   = deriveToilet(acc.accueil)
  const parkingValue  = deriveParking(acc.transport)

  const rawValue = item.uuid

  const attr = (value: A11yValue) =>
    buildAttribute("acceslibre", value, rawValue, {}, false, 1, undefined, false)

  const entranceAttr = buildAttribute(
    "acceslibre",
    entranceValue,
    rawValue,
    entranceDetails,
    false,
    1,
    undefined,
    false,
  )

  return {
    id:           `acceslibre:${item.uuid}`,
    name:         item.nom,
    category,
    address: {
      street:      item.adresse ?? "",
      houseNumber: "",
      postalCode:  item.code_postal ?? "",
      city:        item.commune     ?? "",
      country:     "FR",
    },
    coordinates:      { lat, lon },
    website:          item.site_internet ?? undefined,
    acceslibreUrl:    item.web_url,
    accessibility: {
      entrance: entranceAttr,
      toilet:   attr(toiletValue),
      parking:  attr(parkingValue),
    },
    overallConfidence: 0,
    primarySource:     "acceslibre",
    sourceRecords: [{
      sourceId:   "acceslibre",
      externalId: item.uuid,
      fetchedAt:  new Date().toISOString(),
      metadata: {
        name:       item.nom,
        activite:   item.activite?.slug,
        address:    item.adresse,
        commune:    item.commune,
        web_url:    item.web_url,
        entree:     acc.entree    ?? null,
        accueil:    acc.accueil   ?? null,
        transport:  acc.transport ?? null,
      },
      raw: item,
    }],
  }
}

// ─── Main fetch ───────────────────────────────────────────────────────────────

export async function fetchAccesLibre(params: SearchParams): Promise<Place[]> {
  const apiKey = process.env.ACCESLIBRE_API_KEY
  if (!apiKey) {
    console.warn("[adapter:acceslibre] No API key — skipping")
    return []
  }

  // Only run in international mode and when the search is inside France
  if (!params.international) return []
  if (!isInFrance(params.location.lat, params.location.lon)) return []

  const around = `${params.location.lat},${params.location.lon}`
  const zone   = searchBbox(params.location.lat, params.location.lon, params.radiusKm)

  // Map the requested categories to AccèsLibre activite slugs. When the search
  // asks for (nearly) all categories — the "Alle" default — fanning out per slug
  // would mean dozens of calls, so fall back to a single unfiltered nearest-N
  // fetch that naturally returns a mix of types. Otherwise query each relevant
  // slug so the 100-result budget is spent on the categories the user wants,
  // not on whatever happens to be geographically nearest (the bug that made a
  // wheelchair-filtered restaurant search collapse to a couple of hits).
  const isAllCategories = params.categories.length >= ALL_CATEGORY_COUNT
  const slugs = isAllCategories
    ? []
    : [...new Set(params.categories.flatMap((c) => TO_ACCESLIBRE[c] ?? []))].slice(0, MAX_SLUGS)

  async function fetchAllPages(activite?: string): Promise<AccesLibreItem[]> {
    const items: AccesLibreItem[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await fetchPage(apiKey!, around, zone, page, activite, params.signal)
      items.push(...data.results)
      if (!data.next) break
    }
    return items
  }

  let allItems: AccesLibreItem[]
  if (slugs.length === 0) {
    // All-categories mode (or no category maps to AccèsLibre): unfiltered nearest.
    allItems = await fetchAllPages(undefined)
  } else {
    const perSlug = await Promise.all(slugs.map((slug) => fetchAllPages(slug)))
    allItems = perSlug.flat()
  }

  // A place can be returned by more than one slug query (rare) — dedupe by uuid.
  const seen = new Set<string>()
  const places: Place[] = []
  for (const item of allItems) {
    if (seen.has(item.uuid)) continue
    seen.add(item.uuid)
    const place = itemToPlace(item)
    if (place) places.push(place)
  }
  return places
}
