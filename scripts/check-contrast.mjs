#!/usr/bin/env node
// WCAG contrast checker for the design tokens in app/globals.css (Phase 3).
//
// Contrast is deterministic maths (WCAG 2.x relative-luminance formula), so this
// runs without a browser or a human. It parses the :root HSL tokens, computes the
// ratio for each meaningful foreground/background pair, and fails (exit 1) when a
// pair is below its threshold — suitable as a CI gate.
//
// LIMITS (cannot be checked here, need a browser tool + human eyes):
//   • semi-transparent colours composited over photos / map tiles / gradients
//     (e.g. confidence pins on Leaflet tiles, text over place photos),
//   • whether a pair is actually rendered together at runtime.
// See docs/wcag-accessibility-plan.md.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const cssPath = join(__dirname, "..", "app", "globals.css")
const css = readFileSync(cssPath, "utf8")

// ── Parse :root HSL triplets like `--muted-foreground: 215.4 16.3% 46.9%;` ──
const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")))
const tokens = {}
for (const m of root.matchAll(/--([\w-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*;/g)) {
  tokens[m[1]] = { h: +m[2], s: +m[3], l: +m[4] }
}

// ── Colour maths: HSL → sRGB → relative luminance → contrast ratio ──
function hslToRgb({ h, s, l }) {
  s /= 100; l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0), f(8), f(4)] // 0..1
}
function relLuminance(rgb) {
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}
function ratio(a, b) {
  const la = relLuminance(hslToRgb(a))
  const lb = relLuminance(hslToRgb(b))
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

// ── Pairs to check. kind: "text" → 4.5:1 (normal text), "ui" → 3:1 (large text,
// icons, focus rings, component boundaries). ──
const TEXT = 4.5
const UI = 3.0
const pairs = [
  ["foreground", "background", TEXT, "body text"],
  ["card-foreground", "card", TEXT, "card text"],
  ["popover-foreground", "popover", TEXT, "popover text"],
  ["primary-foreground", "primary", TEXT, "text on primary buttons"],
  ["secondary-foreground", "secondary", TEXT, "text on secondary"],
  ["accent-foreground", "accent", TEXT, "text on accent"],
  ["muted-foreground", "muted", TEXT, "muted text on muted bg"],
  ["muted-foreground", "background", TEXT, "muted text on page bg"],
  ["muted-foreground", "card", TEXT, "muted text on card"],
  ["destructive-foreground", "destructive", TEXT, "text on destructive"],
  ["destructive", "background", TEXT, "error text on page bg"],
  ["primary", "background", UI, "primary icons/links on bg"],
  ["ring", "background", UI, "focus ring on bg"],
]

// Informational only — NOT gating. The default border is a light divider used
// mostly decoratively. WCAG 1.4.11 requires 3:1 only for graphical objects /
// component boundaries that are the *sole* visual indicator of a control (e.g. an
// unfilled input). Decorative dividers are exempt, so blanket-darkening every
// border would harm the design without being required. Sole-indicator boundaries
// are a per-component design/human review item, hence reported but not enforced.
const reviewPairs = [
  ["border", "background", UI, "decorative border on bg (review sole-indicator boundaries)"],
]

const pad = (s, n) => String(s).padEnd(n)

function evaluate(list) {
  return list.flatMap(([fg, bg, threshold, label]) => {
    if (!tokens[fg] || !tokens[bg]) { console.warn(`  ? missing token: ${fg} / ${bg}`); return [] }
    const r = ratio(tokens[fg], tokens[bg])
    return [{ label, pair: `${fg} on ${bg}`, ratio: r, need: threshold, pass: r >= threshold }]
  })
}

function printRows(rows) {
  console.log(`  ${pad("PAIR", 42)} ${pad("RATIO", 7)} ${pad("NEED", 6)} RESULT`)
  for (const row of rows) {
    console.log(`  ${pad(row.pair, 42)} ${pad(row.ratio.toFixed(2), 7)} ${pad(row.need.toFixed(1), 6)} ${row.pass ? "PASS" : "FAIL ✗"}  ${row.pass ? "" : "(" + row.label + ")"}`)
  }
}

const rows = evaluate(pairs)
const failures = rows.filter((r) => !r.pass).length

console.log(`\nWCAG contrast — app/globals.css (light theme)\n`)
printRows(rows)

const review = evaluate(reviewPairs)
console.log(`\nReview only (not gating — decorative; see note in script):`)
printRows(review)

console.log(
  failures === 0
    ? `\n✓ All ${rows.length} gating token pairs meet their WCAG threshold.\n`
    : `\n✗ ${failures} of ${rows.length} gating pairs below threshold. Fix the tokens in app/globals.css.\n`,
)
process.exit(failures === 0 ? 0 : 1)
