import rawData from "./generated/seo-validity.json"

const raw = rawData as Record<string, unknown>

/** ISO timestamp of the last data refresh written by the check:seo script. */
export const SEO_DATA_DATE: Date =
  typeof raw._generatedAt === "string" ? new Date(raw._generatedAt) : new Date()

const map: Record<string, boolean> = Object.fromEntries(
  Object.entries(raw).filter(([k, v]) => !k.startsWith("_") && typeof v === "boolean"),
) as Record<string, boolean>

/** Returns true when the city/category combo is known to have accessible places. */
export function hasData(citySlug: string, categorySlug: string): boolean {
  const key = `${citySlug}/${categorySlug}`
  // Unknown combos default to true (conservative — include until proven empty).
  return map[key] !== false
}

/** Set of "citySlug/categorySlug" keys that have confirmed data. */
export const VALID_SEO_PATHS = new Set(
  Object.entries(map)
    .filter(([, v]) => v)
    .map(([k]) => k),
)
