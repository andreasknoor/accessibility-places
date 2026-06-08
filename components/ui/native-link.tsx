"use client"

import type { AnchorHTMLAttributes } from "react"
import { openExternalUrl } from "@/lib/native/browser"

// Drop-in replacement for <a target="_blank" rel="noopener noreferrer">.
// On native Capacitor platforms, opens the URL in Chrome Custom Tabs (Android)
// or SFSafariViewController (iOS) so the user gets a built-in close button.
// On web, falls back to window.open().
type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "target" | "rel"> & {
  href: string
}

export function NativeLink({ href, onClick, children, ...props }: Props) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        onClick?.(e)
        e.preventDefault()
        void openExternalUrl(href)
      }}
      {...props}
    >
      {children}
    </a>
  )
}
