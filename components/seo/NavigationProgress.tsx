"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"

export default function NavigationProgress() {
  const pathname = usePathname()
  const [pending, setPending] = useState(false)

  useEffect(() => {
    setPending(false)
  }, [pathname])

  useEffect(() => {
    function onLinkClick(e: MouseEvent) {
      const anchor = (e.target as Element).closest("a[href]") as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute("href") ?? ""
      // Only internal same-origin navigations
      if (href.startsWith("http") || href.startsWith("//") || href.startsWith("mailto:") || href.startsWith("tel:")) return
      if (href === pathname || href === "") return
      setPending(true)
    }
    document.addEventListener("click", onLinkClick)
    return () => document.removeEventListener("click", onLinkClick)
  }, [pathname])

  if (!pending) return null

  return (
    <div aria-hidden className="fixed top-0 left-0 right-0 z-50 h-1 bg-blue-100 overflow-hidden">
      <div className="h-full bg-blue-600 absolute" style={{ width: "45%", animation: "nav-progress 1.2s ease-in-out infinite" }} />
      <style>{`
        @keyframes nav-progress {
          0%   { left: -45%; }
          100% { left: 145%; }
        }
      `}</style>
    </div>
  )
}
