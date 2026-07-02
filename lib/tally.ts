import { openExternalUrl } from "./native/browser"

// Programmatic access to the Tally popup widget (tally.so/widgets/embed.js,
// loaded lazily in HomeClient and MobileLayout). The declarative
// `data-tally-open` attribute cannot carry per-click hidden-field values, so
// prefilled forms (e.g. the data-error report) go through this wrapper.
//
// Hidden fields must exist in the Tally form ("Hidden fields" block) under the
// exact same names, or Tally silently drops them.

declare global {
  interface Window {
    Tally?: {
      openPopup: (formId: string, options?: { hiddenFields?: Record<string, string> }) => void
    }
  }
}

export function openTallyPopup(formId: string, hiddenFields: Record<string, string>): void {
  if (window.Tally?.openPopup) {
    window.Tally.openPopup(formId, { hiddenFields })
    return
  }
  // Widget not loaded (script blocked, or a page without the embed) — fall back
  // to the hosted form; Tally reads hidden fields from query params too.
  const qs = new URLSearchParams(hiddenFields)
  void openExternalUrl(`https://tally.so/r/${formId}?${qs}`)
}
