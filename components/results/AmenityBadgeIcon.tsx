import { buildBadgeScene, type BadgeSpec } from "@/lib/amenities/badge-scene"

// SVG twin of the map's canvas marker (drawAmenityBadge) — both render the same
// scene from lib/amenities/badge-scene.ts. Decorative: the card's text carries
// the meaning, so the icon is aria-hidden.
export default function AmenityBadgeIcon({ spec, size = 28 }: { spec: BadgeSpec; size?: number }) {
  const { w, h, ops } = buildBadgeScene(spec, size)
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden focusable="false" className="shrink-0">
      {ops.map((op, i) => {
        if (op.t === "rrect") {
          const inset = op.sw / 2
          return (
            <rect key={i} x={op.x + inset} y={op.y + inset} width={op.w - op.sw} height={op.h - op.sw}
              rx={Math.max(0, op.rx - inset)} fill={op.fill} stroke={op.stroke} strokeWidth={op.sw} />
          )
        }
        if (op.t === "circle") {
          return <circle key={i} cx={op.cx} cy={op.cy} r={op.r - op.sw / 2} fill={op.fill} stroke={op.stroke} strokeWidth={op.sw} />
        }
        if (op.t === "text") {
          return (
            <text key={i} x={op.x} y={op.y} textAnchor="middle" dominantBaseline="central" fill={op.fill}
              fontFamily="system-ui, sans-serif" fontWeight={700} fontSize={op.size}>{op.text}</text>
          )
        }
        return (
          <g key={i} transform={`translate(${op.x} ${op.y}) scale(${op.size / 24})`}>
            {op.glyph.fills.map((f, j) => <path key={`f${j}`} d={f.d} fill={op.color} opacity={f.opacity} />)}
            {op.glyph.strokes.map((st, j) => (
              <path key={`s${j}`} d={st.d} fill="none" stroke={op.color} strokeWidth={st.width}
                strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </g>
        )
      })}
    </svg>
  )
}
