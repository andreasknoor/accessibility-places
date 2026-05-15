import data from "./generated/seo-validity.json"

const map = data as Record<string, boolean>

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
