"use client"

import { Fragment } from "react"
import { X } from "lucide-react"
import { SOURCE_LABELS } from "@/lib/config"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Place } from "@/lib/types"

interface Props {
  place:   Place
  onClose: () => void
}

const VALUE_COLORS: Record<string, string> = {
  yes:     "text-green-700",
  limited: "text-yellow-700",
  no:      "text-red-700",
  unknown: "text-zinc-400",
}

export default function PlaceDebugSheet({ place, onClose }: Props) {
  const t = useTranslations()
  const criteria = [
    { key: "entrance" as const, label: t.criteria.entrance, attr: place.accessibility.entrance },
    { key: "toilet"   as const, label: t.criteria.toilet,   attr: place.accessibility.toilet   },
    { key: "parking"  as const, label: t.criteria.parking,  attr: place.accessibility.parking  },
    ...(place.accessibility.seating
      ? [{ key: "seating" as const, label: t.criteria.seating, attr: place.accessibility.seating }]
      : []),
  ]

  const addr = [place.address.street, place.address.houseNumber, place.address.city]
    .filter(Boolean).join(" ")

  return (
    <>
      <div className="fixed inset-0 z-[1050] bg-black/25" onClick={onClose} />
      <div className="fixed right-0 top-0 z-[1051] h-full w-[520px] max-w-full bg-white shadow-2xl border-l border-border flex flex-col">

        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{place.name}</p>
            {addr && <p className="text-xs text-muted-foreground mt-0.5 truncate">{addr}</p>}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6 text-xs">

          {/* ── Accessibility criteria ── */}
          <section>
            <p className="font-semibold text-sm mb-3">Accessibility attributes</p>
            <div className="space-y-5">
              {criteria.map(({ key, label, attr }) => (
                <div key={key}>
                  <div className="flex items-baseline gap-2 mb-1.5">
                    <span className="font-semibold">{label}</span>
                    <span className={cn("font-medium", VALUE_COLORS[attr.value] ?? "")}>
                      {attr.value}
                    </span>
                    <span className="text-muted-foreground">
                      {Math.round(attr.confidence * 100)}% confidence
                    </span>
                    {attr.conflict && (
                      <span className="text-orange-600 font-medium">⚠ conflict</span>
                    )}
                  </div>

                  {attr.sources.length > 0 ? (
                    <div className="space-y-3 pl-3 border-l-2 border-border">
                      {attr.sources.map((src, i) => (
                        <div key={i} className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-foreground">
                              {SOURCE_LABELS[src.sourceId]}
                            </span>
                            <span className={cn("font-medium", VALUE_COLORS[src.value] ?? "")}>
                              {src.value}
                            </span>
                            <span className="text-muted-foreground">
                              {Math.round(src.reliabilityWeight * 100)}% weight
                            </span>
                          </div>
                          {src.rawValue && (
                            <p className="text-muted-foreground">
                              Raw value:{" "}
                              <code className="font-mono bg-muted px-1 py-0.5 rounded text-[11px]">
                                {src.rawValue}
                              </code>
                            </p>
                          )}
                          {src.details && Object.entries(src.details).filter(([, v]) => v != null).length > 0 && (
                            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mt-1">
                              {Object.entries(src.details)
                                .filter(([, v]) => v != null)
                                .map(([k, v]) => (
                                  <Fragment key={k}>
                                    <span className="text-muted-foreground">{k}:</span>
                                    <span className="font-mono">{String(v)}</span>
                                  </Fragment>
                                ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground pl-3">No sources</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ── Raw source records ── */}
          <section>
            <p className="font-semibold text-sm mb-3">Raw data ({place.sourceRecords.length} source{place.sourceRecords.length !== 1 ? "s" : ""})</p>
            <div className="space-y-4">
              {place.sourceRecords.map((rec, i) => (
                <div key={i} className="border border-border rounded-md overflow-hidden">
                  <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/50 flex-wrap">
                    <span className="font-medium">{SOURCE_LABELS[rec.sourceId]}</span>
                    <code className="font-mono text-muted-foreground text-[11px]">#{rec.externalId}</code>
                    <span className="text-muted-foreground text-[11px] ml-auto">
                      {new Date(rec.fetchedAt).toLocaleString()}
                    </span>
                  </div>
                  <pre className="font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-all p-2 max-h-48 overflow-y-auto text-muted-foreground">
                    {JSON.stringify(rec.raw, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </section>

        </div>
      </div>
    </>
  )
}
