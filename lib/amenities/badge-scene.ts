// Single source of truth for the parking / WC badge artwork. The map draws it
// onto a canvas (lib/map/marker-images.ts), the result cards render it as SVG
// (components/results/AmenityBadgeIcon.tsx) — both consume the same scene, so
// a marker and its list card can never drift apart.
//
// Encoding (WCAG 1.4.1 — never colour alone):
//  · parking: shape (square = designated bay, pill = general lot) + colour,
//    plus a ♿ plaque on designated bays
//  · toilet: fill (solid = standalone, light = inside a venue), wide pill +
//    key = Euro key, plus a ♿ plaque on designated wheelchair WCs

import type { AmenityTier } from "@/lib/types"

// Darker than the previous #2979ff so the white "P" clears 4.5:1 (was ~4.0:1).
export const PARKING_STRONG = "#1d4ed8"
export const PARKING_WEAK   = "#ff9100"
export const PARKING_WEAK_TEXT = "#1f2937"
export const TOILET_STRONG  = "#be185d"
export const TOILET_STROKE  = "#9d174d"
export const TOILET_TINT    = "#fce7f3"

export interface GlyphSpec {
  /** filled shapes (SVG path data, 24×24 box) */
  fills:   { d: string; opacity?: number }[]
  /** stroked shapes, drawn with round caps/joins */
  strokes: { d: string; width: number }[]
}

// circle as path data so canvas Path2D and SVG <path> share one definition
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`
const rect = (x: number, y: number, w: number, h: number) => `M${x},${y}h${w}v${h}h${-w}z`

export const WHEELCHAIR_GLYPH: GlyphSpec = {
  fills:   [{ d: circle(11, 4.2, 1.7) }],
  strokes: [
    { d: "M11 7.5v6.5h5l2.5 5", width: 2.4 },
    { d: "M11 10.5h5", width: 2.4 },
    { d: "M8.6 10.6a5.6 5.6 0 1 0 7.2 8", width: 2.4 },
  ],
}

export const RESTROOM_GLYPH: GlyphSpec = {
  fills: [
    { d: circle(7, 5.2, 1.9) }, { d: rect(4.6, 8, 4.8, 8.4) },
    { d: rect(5.6, 15.4, 1.3, 5) }, { d: rect(7.1, 15.4, 1.3, 5) },
    { d: circle(17, 5.2, 1.9) }, { d: "M17 8 l4 8.2 h-8 z" },
    { d: rect(15.9, 15.4, 1.3, 5) }, { d: rect(17.2, 15.4, 1.3, 5) },
    { d: rect(11.5, 4, 1, 16.5), opacity: 0.55 },
  ],
  strokes: [],
}

export const KEY_GLYPH: GlyphSpec = {
  fills: [],
  strokes: [
    { d: circle(6.5, 12, 3.4), width: 2 },
    { d: "M10 12h10M16.5 12v3.4M19.6 12v2.6", width: 2 },
  ],
}

export type SceneOp =
  | { t: "rrect"; x: number; y: number; w: number; h: number; rx: number; fill: string; stroke: string; sw: number; shadow?: boolean }
  | { t: "circle"; cx: number; cy: number; r: number; fill: string; stroke: string; sw: number }
  | { t: "text"; x: number; y: number; size: number; fill: string; text: string }
  | { t: "glyph"; glyph: GlyphSpec; x: number; y: number; size: number; color: string }

export interface BadgeScene { w: number; h: number; ops: SceneOp[] }

export type BadgeSpec =
  | { kind: "parking"; tier: AmenityTier }
  | { kind: "toilet";  tier: AmenityTier; host: "standalone" | "venue"; euroKey: boolean }

/** Stable cache key for a spec (used to register canvas images once each). */
export function badgeKey(spec: BadgeSpec): string {
  return spec.kind === "parking"
    ? `parking__${spec.tier}`
    : `toilet__${spec.host}__${spec.euroKey ? "euro" : "plain"}__${spec.tier}`
}

/**
 * @param size edge length of the badge body in px. The scene is padded on every
 * side so the ♿ plaque (which overhangs the bottom-right corner) is never
 * clipped and the body stays centred on the icon anchor.
 */
export function buildBadgeScene(spec: BadgeSpec, size: number): BadgeScene {
  const S = size
  const pad = Math.ceil(S * 0.16) + 1
  const ops: SceneOp[] = []
  const strong = spec.tier === "strong"

  let bodyW = S
  let accent: string

  if (spec.kind === "parking") {
    accent = PARKING_STRONG
    ops.push({
      t: "rrect", x: pad, y: pad, w: S, h: S, rx: strong ? S * 5 / 26 : S * 12 / 26,
      fill: strong ? PARKING_STRONG : PARKING_WEAK, stroke: "#ffffff", sw: 1.6, shadow: true,
    })
    ops.push({ t: "text", x: pad + S / 2, y: pad + S / 2 + 0.5, size: S * 0.58,
      fill: strong ? "#ffffff" : PARKING_WEAK_TEXT, text: "P" })
  } else {
    accent = TOILET_STRONG
    const standalone = spec.host === "standalone"
    const fg = standalone ? "#ffffff" : TOILET_STRONG
    bodyW = spec.euroKey ? Math.round(S * 1.5) : S
    ops.push({
      t: "rrect", x: pad, y: pad, w: bodyW, h: S, rx: spec.euroKey ? S / 2 : S * 6 / 28,
      fill: standalone ? TOILET_STRONG : TOILET_TINT, stroke: standalone ? TOILET_STROKE : TOILET_STRONG,
      sw: standalone ? 2.4 : 2, shadow: true,
    })
    if (spec.euroKey) {
      ops.push({ t: "glyph", glyph: RESTROOM_GLYPH, x: pad + S * 0.1, y: pad + S * 0.16, size: S * 0.66, color: fg })
      const k = S * 0.52
      ops.push({ t: "glyph", glyph: KEY_GLYPH, x: pad + S * 0.78 + (bodyW - S * 0.86 - k) / 2, y: pad + S * 0.24, size: k, color: fg })
    } else {
      ops.push({ t: "glyph", glyph: RESTROOM_GLYPH, x: pad + S * 0.16, y: pad + S * 0.16, size: S * 0.68, color: fg })
    }
  }

  if (strong) {
    const b = S * 0.5
    const cx = pad + bodyW - b * 0.2
    const cy = pad + S - b * 0.2
    ops.push({ t: "circle", cx, cy, r: b / 2, fill: "#ffffff", stroke: accent, sw: 1.6 })
    ops.push({ t: "glyph", glyph: WHEELCHAIR_GLYPH, x: cx - b * 0.37, y: cy - b * 0.37, size: b * 0.74, color: accent })
  }

  return { w: bodyW + 2 * pad, h: S + 2 * pad, ops }
}
