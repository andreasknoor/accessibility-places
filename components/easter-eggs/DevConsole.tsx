"use client"

import { APP_VERSION } from "@/lib/config"

interface Props { onClose: () => void }

const ASCII_WHEELCHAIR = `
    o
   ─┤
   ─┤──╮
    │  │
   ◯  ◯╯
`

export default function DevConsole({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
      aria-label="Easter Egg schließen"
    >
      <div
        className="w-full max-w-sm rounded-xl border border-green-500/40 bg-[#0d1117] p-5 font-mono text-sm text-green-400 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-green-300 font-bold text-center mb-3 tracking-widest">
          ✦ ACCESSIBLE PLACES ✦
        </p>
        <p className="text-center text-green-500 mb-4 text-xs tracking-widest">
          ★ DU HAST EIN EASTER EGG GEFUNDEN ★
        </p>

        <pre className="text-green-400 text-xs leading-tight mb-4 text-center whitespace-pre">
          {ASCII_WHEELCHAIR}
        </pre>

        <div className="border-t border-green-500/30 pt-3 space-y-1 text-xs">
          <p className="text-green-300">Made with ♥ by Andreas Knoor</p>
          <p className="text-green-600 mt-2">Daten von:</p>
          <p>▸ OpenStreetMap Community</p>
          <p>▸ Wheelmap / accessibility.cloud</p>
          <p>▸ Reisen für Alle / DSFT</p>
          <p>▸ Ginto (Schweiz)</p>
          <p>▸ Google Places</p>
        </div>

        <div className="border-t border-green-500/30 mt-3 pt-3 flex items-center justify-between text-xs text-green-600">
          <span>v{APP_VERSION}</span>
          <button
            className="text-green-400 hover:text-green-200 transition-colors"
            onClick={onClose}
          >
            [ESC] Schließen
          </button>
        </div>
      </div>
    </div>
  )
}
