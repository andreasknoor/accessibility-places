import type { GlyphSpec } from "@/lib/amenities/badge-scene"

// SVG rendering of a canvas GlyphSpec (badge-scene.ts), so the map markers
// (drawn on canvas) and DOM surfaces — criterion glyphs in the result list,
// detail view and the hand-built map-popup HTML — share one definition of
// e.g. the restroom pictogram instead of two drifting copies. Colour comes
// from `currentColor`, so callers tint it via CSS `color`.
export function glyphSvgString(glyph: GlyphSpec, size: number): string {
  const fills = glyph.fills
    .map((f) => `<path d="${f.d}"${f.opacity != null ? ` opacity="${f.opacity}"` : ""}/>`)
    .join("")
  const strokes = glyph.strokes
    .map((s) => `<path d="${s.d}" fill="none" stroke="currentColor" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${fills}${strokes}</svg>`
}
