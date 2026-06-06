"use client"

import { useEffect, useRef, useState } from "react"

const RACERS = [
  { bg: "#2563eb", dot: "🔵", name: "Blau"  },
  { bg: "#16a34a", dot: "🟢", name: "Grün"  },
  { bg: "#dc2626", dot: "🔴", name: "Rot"   },
  { bg: "#9333ea", dot: "🟣", name: "Lila"  },
]

// vertical lane positions as % of overlay height (4 lanes)
const LANES = [15, 33, 53, 72]

interface Props { onDone: () => void }

export default function WheelchairRace({ onDone }: Props) {
  const [phase, setPhase]               = useState<"countdown" | "racing">("countdown")
  const [countdownNum, setCountdownNum] = useState(3)
  const [winner, setWinner]             = useState<typeof RACERS[0] | null>(null)

  // 25% slower than original: duration range [2.0, 4.25]s (was [1.6, 3.4]s)
  const durations = useRef(
    RACERS.map(() => 2.0 + Math.random() * 2.25)
  ).current

  const winnerIdx = durations.indexOf(Math.min(...durations))
  const maxDur    = Math.max(...durations)

  // Countdown: 3 → 2 → 1 → "GO!" (400 ms) → racing
  useEffect(() => {
    const t: ReturnType<typeof setTimeout>[] = []
    t.push(setTimeout(() => setCountdownNum(2),   900))
    t.push(setTimeout(() => setCountdownNum(1),  1800))
    t.push(setTimeout(() => setCountdownNum(0),  2700))
    t.push(setTimeout(() => setPhase("racing"), 3100))
    return () => t.forEach(clearTimeout)
  }, [])

  // Winner + done timers start when racing begins (not from mount)
  useEffect(() => {
    if (phase !== "racing") return
    const t1 = setTimeout(() => setWinner(RACERS[winnerIdx]), durations[winnerIdx] * 1000 + 100)
    const t2 = setTimeout(onDone,                              maxDur * 1000 + 2000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    // overflow-hidden intentionally omitted: fixed+inset-0 already clips at viewport
    // edges. With overflow-hidden the browser clips the translateX(-120px) start position.
    <div className="fixed inset-0 z-[9997] pointer-events-none" aria-hidden>

      {/* Countdown: 3 / 2 / 1 / GO! */}
      {phase === "countdown" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="bg-black/75 text-white rounded-full w-28 h-28 flex items-center justify-center shadow-2xl">
            {countdownNum === 0
              ? <span className="text-4xl font-black">GO! 🏁</span>
              : <span className="text-7xl font-black">{countdownNum}</span>
            }
          </div>
        </div>
      )}

      {/* Racers — always rendered so they stand at the start line during the countdown.
          CSS class switches from --waiting (fixed at start) to active (animating) when
          racing begins. Both classes live in globals.css so they survive Tailwind's
          prefers-reduced-motion preflight !important override on inline styles. */}
      {RACERS.map((racer, i) => (
        <div
          key={i}
          className={`absolute flex flex-col items-center gap-0.5 ${
            phase === "racing"
              ? "wheelchair-race-racer"
              : "wheelchair-race-racer--waiting"
          }`}
          style={{
            top:          `${LANES[i]}%`,
            left:         0,
            "--race-dur": `${durations[i]}s`,
          } as React.CSSProperties}
        >
          <span className="text-lg leading-none">{racer.dot}</span>
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center p-1.5"
            style={{ backgroundColor: racer.bg }}
          >
            <img src="/icons/icon-preview.svg" className="w-9 h-9 rounded-lg" alt="" />
          </div>
        </div>
      ))}

      {/* Winner banner */}
      {winner && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 pointer-events-auto bg-card border border-border rounded-2xl px-6 py-3 shadow-xl text-center">
          <p className="text-xl font-bold">{winner.dot} {winner.name} gewinnt! 🏆</p>
        </div>
      )}
    </div>
  )
}
