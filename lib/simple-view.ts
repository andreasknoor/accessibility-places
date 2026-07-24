import type { A11yValue, Category } from "@/lib/types"
import type { Translations } from "@/lib/i18n/types"

// Categories where Simple View treats a wheelchair toilet as a hard
// requirement on top of the standard entrance yes/limited preset — unlike
// entrance, "eingeschränkt nutzbar" isn't good enough here, only a plain
// "yes". Applies even during the "Alles anzeigen" search (mixed categories):
// HomeClient's post-filter only checks toilet for places whose OWN category
// is in this set, leaving every other category's results unaffected. Shared
// between HomeClient (the filter) and SimplePlaceCard (which additionally
// shows the toilet line for these categories, mirroring the entrance line).
export const SIMPLE_TOILET_REQUIRED_CATEGORIES: ReadonlySet<Category> = new Set([
  "cafe", "restaurant", "hotel",
])

// Solid dot fill per A11yValue, matching CriterionBox's CRITERION_STYLES hues
// (green/yellow/red/slate) at a stronger shade — CRITERION_STYLES itself only
// exports pastel *background* tints (bg-green-50 etc.), meant for a tinted
// panel, not a small solid indicator dot.
export const CRITERION_DOT_CLASS: Record<A11yValue, string> = {
  yes:     "bg-green-600",
  limited: "bg-yellow-600",
  no:      "bg-red-600",
  unknown: "bg-slate-400",
}

// Plain-language sentence per accessibility criterion, used by Simple View
// (components/simple/*) instead of the badge/score vocabulary the full UI
// uses elsewhere (ConfidenceBadge, A11yAttribute). Kept as a small shared
// helper so SimplePlaceCard and SimpleDetail render identical wording.
export function criterionSentence(
  t: Translations,
  key: "entrance" | "toilet" | "parking",
  value: A11yValue,
): string {
  const map: Record<"entrance" | "toilet" | "parking", Record<A11yValue, string>> = {
    entrance: { yes: t.simple.entranceGood, limited: t.simple.entranceLimited, no: t.simple.entranceBad, unknown: t.simple.entranceUnknown },
    toilet:   { yes: t.simple.toiletGood,   limited: t.simple.toiletLimited,   no: t.simple.toiletBad,   unknown: t.simple.toiletUnknown },
    parking:  { yes: t.simple.parkingGood,  limited: t.simple.parkingLimited,  no: t.simple.parkingBad,  unknown: t.simple.parkingUnknown },
  }
  return map[key][value]
}
