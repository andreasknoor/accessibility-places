import { useEffect, useRef } from "react"

// Focus management for modal dialogs (WCAG 2.1.2 No Keyboard Trap / 2.4.3 Focus
// Order): on open, move focus into the panel; trap Tab/Shift+Tab within it; close
// on Escape; and restore focus to the previously focused element (the trigger) on
// close. Attach the returned ref to the dialog container.
//
// Used by PlaceDebugSheet and SettingsSheet (identical right-side sheet pattern).
const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function useFocusTrap<T extends HTMLElement>(onClose: () => void, active = true) {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (!active) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = ref.current
    const focusables = () =>
      panel
        ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => el.offsetParent !== null)
        : []

    // Move focus inside on open (first focusable, else the panel itself).
    ;(focusables()[0] ?? panel)?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return }
      if (e.key !== "Tab" || !panel) return
      const items = focusables()
      if (items.length === 0) { e.preventDefault(); panel.focus(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [onClose, active])

  return ref
}
