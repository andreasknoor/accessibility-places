"use client"

import { useEffect, useRef, useState } from "react"

const RACERS = [
  { bg: "#2563eb", dot: "🔵", name: "Blau"  },
  { bg: "#16a34a", dot: "🟢", name: "Grün"  },
  { bg: "#dc2626", dot: "🔴", name: "Rot"   },
  { bg: "#ca8a04", dot: "🟡", name: "Gelb"  },
  { bg: "#9333ea", dot: "🟣", name: "Lila"  },
]

// vertical lanes as % of overlay height
const LANES = [12, 27, 42, 58, 73]

interface Props { onDone: () => void }

export default function WheelchairRace({ onDone }: Props) {
  const [winner, setWinner] = useState<typeof RACERS[0] | null>(null)

  // Generate durations once per mount, stable across re-renders
  const durations = useRef(
    RACERS.map(() => 1.6 + Math.random() * 1.8)
  ).current

  const winnerIdx = durations.indexOf(Math.min(...durations))
  const maxDur    = Math.max(...durations)

  useEffect(() => {
    const t1 = setTimeout(() => setWinner(RACERS[winnerIdx]), durations[winnerIdx] * 1000 + 100)
    const t2 = setTimeout(onDone,                              maxDur * 1000 + 2000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-[9997] pointer-events-none overflow-hidden" aria-hidden>
      {RACERS.map((racer, i) => (
        <div
          key={i}
          className="absolute flex flex-col items-center gap-0.5"
          style={{
            top:       `${LANES[i]}%`,
            left:      0,
            animation: `wheelchair-race ${durations[i]}s linear forwards`,
          }}
        >
          <span className="text-xs leading-none">{racer.dot}</span>
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-2xl"
            style={{ backgroundColor: racer.bg }}
          >
            🦽
          </div>
        </div>
      ))}

      {winner && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 pointer-events-auto bg-card border border-border rounded-2xl px-6 py-3 shadow-xl text-center">
          <p className="text-xl font-bold">{winner.dot} {winner.name} gewinnt! 🏆</p>
        </div>
      )}
    </div>
  )
}
