"use client"

// Native-aware sharing. In the Capacitor app the @capacitor/share plugin opens
// the native iOS/Android share sheet. On the web it uses the Web Share API when
// available (most mobile browsers), otherwise copies the URL to the clipboard.
//
// Returns how the share was handled so the caller can show the right feedback
// ("geteilt" vs "Link kopiert").

import { Capacitor } from "@capacitor/core"

export type ShareOutcome = "shared" | "copied" | "failed"

export interface ShareInput {
  title?: string
  text?:  string
  url:    string
  /** Android-only dialog title for the chooser. */
  dialogTitle?: string
}

export async function shareOrCopy(input: ShareInput): Promise<ShareOutcome> {
  // Native share sheet
  if (Capacitor.isNativePlatform()) {
    try {
      const { Share } = await import("@capacitor/share")
      await Share.share({
        title:       input.title,
        text:        input.text,
        url:         input.url,
        dialogTitle: input.dialogTitle,
      })
      return "shared"
    } catch (err) {
      // User cancelled the share sheet → not an error worth surfacing.
      if (isCancellation(err)) return "failed"
      // Unexpected plugin error → fall through to web paths below.
    }
  }

  // Web Share API (most mobile browsers, incl. iOS Safari/PWA)
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: input.title, text: input.text, url: input.url })
      return "shared"
    } catch (err) {
      if (isCancellation(err)) return "failed"
      // fall through to clipboard
    }
  }

  // Clipboard fallback (desktop browsers without Web Share)
  try {
    await navigator.clipboard.writeText(input.url)
    return "copied"
  } catch {
    return "failed"
  }
}

function isCancellation(err: unknown): boolean {
  const msg = (err as { message?: string })?.message?.toLowerCase() ?? ""
  const name = (err as { name?: string })?.name ?? ""
  return name === "AbortError" || msg.includes("cancel") || msg.includes("abort")
}
