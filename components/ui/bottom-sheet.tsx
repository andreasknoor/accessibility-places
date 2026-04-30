"use client"

import { useEffect } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  open:     boolean
  onClose:  () => void
  title?:   string
  children: React.ReactNode
  className?: string
}

export function BottomSheet({ open, onClose, title, children, className }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    // stopPropagation prevents clicks inside the portal from bubbling through
    // the React component tree to parent handlers (e.g. PlaceCard onClick).
    <div onClick={(e) => e.stopPropagation()}>
      <div
        className="fixed inset-0 z-[1060] bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "fixed bottom-0 left-0 right-0 z-[1061] bg-white rounded-t-2xl shadow-xl p-4 pb-8 max-h-[80vh] overflow-y-auto",
          className,
        )}
      >
        <div className="flex items-center justify-between mb-3">
          {title && <p className="font-semibold text-sm">{title}</p>}
          <button
            onClick={onClose}
            className="ml-auto p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Schließen"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
