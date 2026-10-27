import { z } from "zod"
import { ALL_CATEGORIES } from "../llm"
import { regionForCoordinates } from "../config"
import { API_ONLY_CATEGORIES, DEFAULT_NEARBY_CATEGORIES, type ApiCategory } from "./constants"

// Query-string schemas. All values arrive as strings; numbers are coerced.

export const API_CATEGORIES: ApiCategory[] = [
  ...ALL_CATEGORIES.map((c) => (c === "theater" ? "theatre" : c) as ApiCategory),
  ...API_ONLY_CATEGORIES,
]
const CATEGORY_SET = new Set<string>(API_CATEGORIES)
const WHEELCHAIR_VALUES = ["yes", "limited", "no", "unknown"] as const

const lat = z.coerce.number().min(-90).max(90)
const lon = z.coerce.number().min(-180).max(180)
const intIn = (min: number, max: number, def: number) => z.coerce.number().int().min(min).max(max).default(def)

const inDach = (v: { lat?: number; lon?: number }) =>
  v.lat === undefined || v.lon === undefined || regionForCoordinates(v.lat, v.lon) === "dach"
const DACH_MSG = { message: "Coordinates are outside the covered area (Germany, Austria, Switzerland).", path: ["lat"] }

export const lookupSchema = z.object({
  name:    z.string().trim().min(2).max(100),
  city:    z.string().trim().min(1).max(100).optional(),
  address: z.string().trim().min(1).max(200).optional(),
  lat:     lat.optional(),
  lon:     lon.optional(),
  limit:   intIn(1, 10, 5),
}).refine((v) => (v.lat === undefined) === (v.lon === undefined), {
  message: "lat and lon must be given together.", path: ["lat"],
}).refine(inDach, DACH_MSG)

export const nearbySchema = z.object({
  lat,
  lon,
  radius:   intIn(1, 5000, 1000),
  category: z.string().optional().transform((s, ctx) => {
    if (!s) return DEFAULT_NEARBY_CATEGORIES
    const list = [...new Set(s.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean))]
    const bad = list.filter((c) => !CATEGORY_SET.has(c))
    if (bad.length) ctx.addIssue({ code: "custom", message: `Unknown category: ${bad.join(", ")}. See /api/v1/docs for the list.` })
    return list as ApiCategory[]
  }),
  wheelchair: z.string().optional().transform((s, ctx) => {
    if (!s) return undefined
    const list = [...new Set(s.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean))]
    const bad = list.filter((c) => !(WHEELCHAIR_VALUES as readonly string[]).includes(c))
    if (bad.length) ctx.addIssue({ code: "custom", message: `Invalid wheelchair value: ${bad.join(", ")} (allowed: yes, limited, no, unknown).` })
    return list as typeof WHEELCHAIR_VALUES[number][]
  }),
  limit: intIn(1, 50, 20),
}).refine(inDach, DACH_MSG)

export const toiletsSchema = z.object({
  lat,
  lon,
  radius: intIn(1, 500, 100),
}).refine(inDach, DACH_MSG)

/** Search params → plain object, minus the token. Empty values count as absent. */
export function queryObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of params) if (k !== "token" && v !== "") out[k] = v
  return out
}

export function firstIssue(err: z.ZodError): string {
  const i = err.issues[0]
  const path = i?.path.length ? `${i.path.join(".")}: ` : ""
  return `${path}${i?.message ?? "Invalid parameters."}`
}
