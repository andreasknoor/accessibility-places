"use client"

import type { AnchorHTMLAttributes } from "react"
import { openExternalUrl } from "@/lib/native/browser"
import { track } from "@/lib/analytics"

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
        try { track("external_link", { domain: new URL(href).hostname }) } catch { /* ignore malformed URLs */ }
        void openExternalUrl(href)
      }}
      {...props}
    >
      {children}
    </a>
  )
}
