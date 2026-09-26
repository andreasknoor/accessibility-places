import { ArrowUpRight } from "lucide-react"
import { cn } from "@/lib/utils"

// The ↗ "this leaves the app" marker for links that open a website in the
// browser (or an external maps site). Same arrow the Route button carries
// (components/ui/navigate-button.tsx), so one symbol means one thing
// everywhere. Deliberately NOT used for tel:/mailto: links or the share
// sheet — those open a system action, not a different website.
//
// No hooks, so it also works in the server-rendered static/SEO pages, which
// pass their own (inline bilingual) screen-reader text.
//
// `badge` — for icon-only links: a small arrow pinned to the icon's top-right
// corner (the link needs `relative`). Otherwise an inline arrow after the
// link text.
export default function ExternalMark({ srLabel, badge, className }: { srLabel?: string; badge?: boolean; className?: string }) {
  return (
    <>
      {/* For inline text links the separating space sits BEFORE the arrow
          ("App Store ↗"): after it, the underline would run on past the
          arrow; inside the sr-only span it would be trimmed away by
          accessible-name computation ("Website(öffnet …)"). */}
      {srLabel && !badge && " "}
      <ArrowUpRight
        aria-hidden
        strokeWidth={2.6}
        className={cn(
          badge
            ? "absolute -top-1 -right-1.5 w-2.5 h-2.5"
            : "inline-block w-3 h-3 align-[-1px] shrink-0",
          className,
        )}
      />
      {srLabel && <span className="sr-only">{srLabel}</span>}
    </>
  )
}
