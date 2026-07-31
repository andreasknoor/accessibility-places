// Canvas-rasterised marker images for MapLibre's native symbol layers (issue
// #48, R1 — chosen over HTML markers + manual cluster sync for GPU-scaled
// performance up to the OSM `out 2000` result cap). Every unique combination
// of (shape, colour, glyph, size) is rendered once to an offscreen canvas and
// registered via map.addImage(); MapLibre then draws it like any raster
// sprite. Emoji glyphs are used for category icons (matches today's
// CATEGORY_ICONS — see the design-decision note in MapViewGL.tsx for why a
// dedicated vector icon set was deferred rather than invented here).
//
// Visual spec: variant "B.3" from the map-elements redesign prototype —
// classic teardrop pins, confidence-coloured fill, self-shade border (a
// darkened tone of the marker's own fill, chosen live against 3 alternatives
// during prototyping) — plus the "D" unified popup design (lib/map/popup-content.ts).

const DPR = typeof window !== "undefined" ? Math.max(1, Math.min(3, window.devicePixelRatio || 1)) : 1

function darken(hex: string, amount: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!m) return hex
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => Math.round(parseInt(h, 16) * (1 - amount)))
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

// Teardrop path in a 26×34 box, tip at (13, 32.5) — matches svgMarker's
// existing path in MapViewLeaflet.tsx so both engines draw the same shape.
const PIN_PATH = new Path2D("M13,1.5 C7.2,1.5 2.5,6.2 2.5,12 C2.5,19.5 13,32.5 13,32.5 C13,32.5 23.5,19.5 23.5,12 C23.5,6.2 18.8,1.5 13,1.5 Z")

function makeCanvas(wCss: number, hCss: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const w = Math.round(wCss * DPR)
  const h = Math.round(hCss * DPR)
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h })
  if (!(canvas instanceof OffscreenCanvas)) {
    canvas.width = w
    canvas.height = h
  }
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D
  ctx.scale(DPR, DPR)
  return { canvas, ctx }
}

export interface RasterImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

function toRasterImage(canvas: OffscreenCanvas | HTMLCanvasElement, wCss: number, hCss: number): RasterImage {
  const w = Math.round(wCss * DPR)
  const h = Math.round(hCss * DPR)
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D
  const imgData = ctx.getImageData(0, 0, w, h)
  return { data: imgData.data, width: w, height: h }
}

// Canvas `textAlign:"center"`/`textBaseline:"middle"` centres against the
// FONT's em-box, not the emoji glyph's actual painted pixels — colour emoji
// glyphs commonly sit high and to the left within that em-box, so naive
// center/middle text reads as "anchored top-left" instead of centred (this
// is a well-known cross-browser canvas quirk, not specific to one engine).
// Measuring `actualBoundingBox*` and offsetting by the glyph's own visual
// centre fixes it regardless of the font's internal metrics.
function fillEmojiCentered(ctx: CanvasRenderingContext2D, emoji: string, cx: number, cy: number): void {
  ctx.textAlign = "left"
  ctx.textBaseline = "alphabetic"
  const m = ctx.measureText(emoji)
  const glyphW = (m.actualBoundingBoxLeft ?? 0) + (m.actualBoundingBoxRight ?? m.width)
  const glyphH = (m.actualBoundingBoxAscent ?? 0) + (m.actualBoundingBoxDescent ?? 0)
  const x = cx - glyphW / 2 - (m.actualBoundingBoxLeft ?? 0)
  const y = cy + glyphH / 2 - (m.actualBoundingBoxDescent ?? 0)
  ctx.fillText(emoji, x, y)
}

// Venue teardrop pin — fill = confidence colour, border = self-shade (25%
// darker than fill), category emoji centred in the head. `selected` scales
// up and swaps the border to a dark slate ring (matches the pre-migration
// Leaflet selection treatment — never blue, which collides with the parking
// marker colour).
export function drawPlacePin(fillColor: string, emoji: string, selected: boolean): RasterImage {
  const w = selected ? 46 : 40
  const h = selected ? 60 : 52
  const { canvas, ctx } = makeCanvas(w, h)
  ctx.save()
  ctx.scale(w / 26, h / 34)
  ctx.shadowColor = "rgba(0,0,0,.3)"
  ctx.shadowBlur = 3
  ctx.shadowOffsetY = 1.5
  ctx.fillStyle = fillColor
  ctx.fill(PIN_PATH)
  ctx.shadowColor = "transparent"
  ctx.lineWidth = 2.2
  ctx.strokeStyle = selected ? "#0f172a" : darken(fillColor, 0.28)
  ctx.stroke(PIN_PATH)
  ctx.restore()
  ctx.font = `${Math.round(w * 0.4)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
  fillEmojiCentered(ctx, emoji, w / 2, h * 0.28)
  return toRasterImage(canvas, w, h)
}

// NOTE: cluster badges are NOT rasterised here. Unlike the place/parking/WC
// markers, a cluster ring is a plain circle + text label — MapLibre's native
// circle-layer + symbol-layer (text-field) paint expressions handle that
// directly with data-driven colouring (see the "clusters"/"cluster-count"
// layers in MapViewGL.tsx), which is both simpler and avoids pre-rendering
// one raster image per possible child count.

// Parking badge — rounded square (strong/reserved tier) or pill (weak tier,
// same shape-plus-colour encoding as the Leaflet svgParkingMarker so the two
// tiers stay distinguishable without relying on hue alone, WCAG 1.4.1).
export function drawParkingBadge(tier: "strong" | "weak"): RasterImage {
  const fill = tier === "strong" ? "#2979ff" : "#ff9100"
  const textColor = tier === "strong" ? "#ffffff" : "#1f2937"
  const rx = tier === "weak" ? 12 : 5
  const w = 26, h = 26
  const { canvas, ctx } = makeCanvas(w, h)
  ctx.save()
  ctx.shadowColor = "rgba(0,0,0,.3)"
  ctx.shadowBlur = 3
  ctx.shadowOffsetY = 1
  roundRect(ctx, 1.5, 1.5, w - 3, h - 3, rx)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.shadowColor = "transparent"
  ctx.lineWidth = 1.8
  ctx.strokeStyle = "#fff"
  roundRect(ctx, 1.5, 1.5, w - 3, h - 3, rx)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = textColor
  ctx.font = "bold 15px sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText("P", w / 2, h / 2 + 1)
  return toRasterImage(canvas, w, h)
}

// Toilet badge — solid magenta (standalone public WC) vs. light fill with
// magenta border (WC inside a venue). Euro-key spots get a wider pill with a
// second 🔑 glyph (form + colour + symbol encoding, matches parking's
// square-vs-pill distinction).
export function drawToiletBadge(host: "standalone" | "venue", euroKey: boolean): RasterImage {
  const fill   = host === "standalone" ? "#be185d" : "#fce7f3"
  const stroke = host === "standalone" ? "#9d174d" : "#be185d"
  const strokeW = host === "standalone" ? 3 : 2.5
  const w = euroKey ? 40 : 28
  const h = euroKey ? 30 : 28
  const rx = euroKey ? 14 : 6
  const { canvas, ctx } = makeCanvas(w, h)
  ctx.save()
  ctx.shadowColor = "rgba(0,0,0,.3)"
  ctx.shadowBlur = 3
  ctx.shadowOffsetY = 1
  roundRect(ctx, 1.5, 1.5, w - 3, h - 3, rx)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.shadowColor = "transparent"
  ctx.lineWidth = strokeW
  ctx.strokeStyle = stroke
  roundRect(ctx, 1.5, 1.5, w - 3, h - 3, rx)
  ctx.stroke()
  ctx.restore()
  ctx.font = `${euroKey ? 15 : 16}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
  if (euroKey) {
    fillEmojiCentered(ctx, "🚻", w * 0.31, h / 2)
    ctx.strokeStyle = stroke
    ctx.globalAlpha = 0.35
    ctx.beginPath()
    ctx.moveTo(w / 2, 6)
    ctx.lineTo(w / 2, h - 6)
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.font = "13px sans-serif"
    fillEmojiCentered(ctx, "🔑", w * 0.73, h / 2)
  } else {
    fillEmojiCentered(ctx, "🚻", w / 2, h / 2)
  }
  return toRasterImage(canvas, w, h)
}

// GPS dot — pulsing ring + solid inner dot (static raster; the pulse
// animation, if wanted later, would need a DOM marker instead — out of scope
// for the initial port, matches today's app in not animating the Leaflet dot).
export function drawGpsDot(): RasterImage {
  const size = 22
  const { canvas, ctx } = makeCanvas(size, size)
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2)
  ctx.fillStyle = "rgba(37,99,235,0.18)"
  ctx.fill()
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, 5, 0, Math.PI * 2)
  ctx.fillStyle = "#2563eb"
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = "#fff"
  ctx.stroke()
  return toRasterImage(canvas, size, size)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export { DPR as MARKER_PIXEL_RATIO }
