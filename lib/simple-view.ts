import type { A11yValue, Category } from "@/lib/types"
import type { Translations } from "@/lib/i18n/types"
import type { JudgmentFilters, JudgmentStatus } from "@/lib/reliability"

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

// Quickstart's actual fixed preset (mirrors SIMPLE_FILTERS_OVERRIDE +
// HomeClient's client-side toilet post-filter): entrance always required,
// toilet strictly "yes" only for the categories where Quickstart enforces it.
// Almost always "pass"/"pass_limited" since the place already survived that
// preset — except a deep-linked place, which can legitimately fail it
// (docs/plans/quickstart-mode-default.md). Shared by the result card, the
// detail view and the map popup so all three state the same verdict.
export function quickstartJudgmentFilters(category: Category): JudgmentFilters {
  return {
    entrance: true,
    toilet:   SIMPLE_TOILET_REQUIRED_CATEGORIES.has(category),
    parking:  false,
    seating:  false,
    acceptUnknown: false,
  }
}

// Fixed, absolute headline (decision 7, v13) — Quickstart's preset is fixed by
// app design, unlike Expert Mode's user-chosen filters, so this states the
// judgement outright. Deliberately NOT results.judgmentFail/Unverified for
// the fallback: those say "deine Kriterien", which would mislead here.
export function quickstartHeadline(t: Translations, status: JudgmentStatus): string {
  return status === "pass"
    ? t.simple.accessibleHeadline
    : status === "pass_limited"
      ? t.simple.accessibleHeadlineCaveat
      : status === "fail"
        ? t.simple.notAccessibleHeadline
        : t.simple.unverifiedHeadline
}
