"use client"

import { useState, useRef, useEffect } from "react"
import { Search, Loader2, LocateFixed, X, Coffee, UtensilsCrossed, Beer, BookOpen, Hotel, Landmark, Film, Library, GalleryHorizontal, Star, IceCream, MapPin, Layers } from "lucide-react"
import { track } from "@/lib/analytics"
import { useTranslations, useLocale, getTranslations, type Locale } from "@/lib/i18n"
import { CATEGORY_ICONS } from "@/lib/category-icons"
import { useIsMobile } from "@/hooks/useIsMobile"
import { cn } from "@/lib/utils"
import { extractQuotedName, parseQuery } from "@/lib/llm"
import { loadSettings, legacyChipIdxToCat } from "@/lib/settings"
import { isReturningNow, loadSearchRun, loadActiveMode, saveNearbyLocation, loadNearbyLocation, saveSearchInput, loadSearchInput, clearSearchInput } from "@/lib/session-restore"
import { getCurrentPosition, isGeolocationAvailable, watchPosition, clearWatchPosition, type GeoWatchId } from "@/lib/native/geolocation"
import DevConsole from "@/components/easter-eggs/DevConsole"
import type { AmenityType, Category } from "@/lib/types"
import { venueViewportOrigin, amenityViewportOrigin, type ViewportOrigin } from "@/lib/search-ui"

type Coords = { lat: number; lon: number }

interface Props {
  // radiusKm is supplied only by the viewport-origin chip path (a search of the
  // visible map area); the parent then uses it as the radius AND syncs the slider.
  onSearch:          (query: string, coords?: Coords, nameHint?: string, radiusKm?: number) => void
  onPlaceSearch?:    (nameHint: string, coords?: Coords) => void
  isLoading:         boolean
  onModeChange?:     (mode: "text" | "nearby") => void
  autoFocus?:        boolean
  initialLocation?:  string
  // Stable category key of the chip to pre-select (null/undefined = "Alle"). The
  // parent passes a category — never an index — so SEO deep-links and the saved
  // default survive any chip reordering. Converted to a positional index internally.
  initialChipCat?:   Category | null
  initialMode?:      "text" | "nearby" | "place"  // "place" is treated as "text" (legacy)
  onGpsResolved?:    (coords: Coords) => void
  locateTrigger?:    number
  // Bumped by the parent when an explicit "Hier suchen" (coordinate-based area
  // search at a panned viewport) runs. Forces the panel out of nearby mode so a
  // subsequent chip pick refines the searched area via activeSearchCoords instead
  // of snapping back to the still-active GPS fix (the reported viewport bug).
  exitNearbyTrigger?: number
  biasCoords?:       Coords
  // Amenity search chips (parking / WC) — single-select, at the front of the chip
  // strip. Selecting one runs an amenity search at the current location (GPS or the
  // active area); if no location is known yet, ChatPanel auto-locates first.
  // radiusKm + panned are supplied only by the viewport-origin chip path: panned
  // (= the viewport centre) keeps the map from re-fitting and signals the parent to
  // snap + persist the amenity radius slider, mirroring "search this area".
  onAmenitySearch?:  (type: AmenityType, coords?: Coords, radiusKm?: number, panned?: Coords) => void
  // The amenity currently being searched (null = normal venue search). Drives chip
  // highlighting; owned by the parent so a venue search elsewhere clears it.
  amenityActive?:    AmenityType | null
  // Clears amenity mode without running a search (e.g. tapping "Alle"/a venue chip
  // while no location is set, so no venue search fires to clear it for us).
  onExitAmenity?:    () => void
  // Reports a category-only query reflecting the current chip selection, so the
  // map's "search here" can run even before any search has been submitted (text
  // mode, no location entered). Null chip → an all-categories query.
  onCategoryQueryChange?: (query: string) => void
  // Coordinates of the currently displayed search when it was coordinate-based
  // (e.g. "search here", nearby). Set → a chip change in text mode refines THIS
  // area in place instead of re-geocoding the (possibly stale) location textbox.
  activeSearchCoords?: Coords
  // The resolved centre of the current search, set after ANY successful search —
  // including a plain typed-area search ("Cafés in Hamburg"), which never carries
  // client-side coordinates (activeSearchCoords stays undefined for those; the
  // server resolves the location and reports it back). Amenity chips fall back to
  // this so "search elsewhere" works for the common typed-area case, not just
  // coordinate-based searches.
  searchCenter?: Coords
  // Opt-in international mode (AppSettings.internationalMode). When true the
  // autocomplete widens from DACH to the supported-country allowlist.
  international?: boolean
  // Reads the live map viewport when the user has panned (null otherwise). Called
  // at chip-click time so a category/amenity chip searches the visible area after
  // a pan. Stable identity (reads a parent ref) — no re-render on every map move.
  // Returns null on a cold map / after a search recentres / in focus mode, so the
  // chip falls through to its existing origin chain. See lib/search-ui helpers.
  getViewportOrigin?: () => ViewportOrigin | null
  // True while a genuine map pan is pending (the "search here" pill is showing —
  // same signal as getViewportOrigin, after v9.14 only real drag gestures). Used
  // to hide the green "at my location" badge while panned: the view is no longer
  // centred on the GPS fix, so showing both the badge and the "search here" pill
  // would be contradictory. Reversible — panning back / a new search recentres the
  // map, clears the pill, and the badge returns.
  panPending?: boolean
}

// Two-level category chips (drill-in, "Konzept A"): a group chip replaces the
// row with its subcategories; a "←" chip returns to the group list. Every
// Category belongs to exactly one group. Group labels are short enough that
// hardcoding them here (rather than a full i18n entry per group) mirrors the
// pre-existing precedent of the old flat CHIPS array; leaf chip text is
// derived from i18n (chipText below), never hardcoded.
interface ChipGroup {
  id:   string
  icon: string
  de:   string
  en:   string
  cats: Category[]
}

// Exported for a completeness test only (every Category must appear in
// exactly one group) — not part of the component's runtime public API.
export const CHIP_GROUPS: ChipGroup[] = [
  { id: "gastro",  icon: "🍽", de: "Gastronomie",            en: "Food & Drink",
    cats: ["restaurant", "cafe", "bar", "pub", "biergarten", "fast_food"] },
  { id: "stay",    icon: "🏨", de: "Unterkunft",             en: "Accommodation",
    cats: ["hotel", "hostel", "apartment", "camp_site"] },
  { id: "culture", icon: "🎭", de: "Kultur",                 en: "Culture",
    cats: ["museum", "theater", "cinema", "library", "gallery", "attraction", "zoo"] },
  { id: "sport",   icon: "🤸", de: "Sport & Freizeit",       en: "Sport & Leisure",
    cats: ["swimming_pool", "fitness_centre", "playground", "park"] },
  { id: "health",  icon: "🩺", de: "Gesundheit",             en: "Health",
    cats: ["pharmacy", "doctors", "dentist", "veterinary", "hospital", "chemist",
           "physiotherapist", "medical_supply", "hearing_aids", "optician"] },
  { id: "daily",   icon: "🛒", de: "Alltag",                 en: "Everyday",
    cats: ["supermarket", "bakery", "hairdresser", "bank", "post_office"] },
  { id: "public",  icon: "🏛", de: "Öffentlich & Unterwegs", en: "Public & Transit",
    cats: ["townhall", "place_of_worship", "railway_station"] },
]

// Flat, ordered list of every category chip across all groups — selectedIdx
// indexes into this exactly as it indexed into the old flat CHIPS array, so
// every persistence/deep-link/tracking call site keyed on "CHIPS[idx].cat"
// keeps working unchanged.
const CHIPS: { cat: Category }[] = CHIP_GROUPS.flatMap((g) => g.cats.map((cat) => ({ cat })))

function chipIcon(cat: Category): string {
  return CATEGORY_ICONS[cat] ?? "📍"
}

// Leaf chip text: prefers the chip-specific `chipLabels` override (the legacy
// dozen's short/plural phrasing, e.g. "Hotels"), falls back to the singular
// `categories` badge text used elsewhere in the app (e.g. "Park").
function chipText(cat: Category, loc: Locale): string {
  const t = getTranslations(loc)
  return t.chipLabels[cat] ?? t.categories[cat]
}

// Text blob representing "every category in this group" — reuses the same
// regex-based category inference the server already runs on any chip label
// (lib/llm.ts inferCategories matches each category's own hints independently,
// so a blob of every member's chip text ends up classified as all of them, no
// server-side change required). See docs: whole-group selection is transient
// UI state only — it is NOT persisted as a distinct value (session-restore /
// SEO deep-links / the settings default-chip still only know single
// categories), so it degrades gracefully to "Alle" across a reload.
function groupLabel(groupId: string, loc: Locale): string {
  const group = CHIP_GROUPS.find((g) => g.id === groupId)
  if (!group) return ""
  return group.cats.map((cat) => chipText(cat, loc)).join(" ")
}

// Chip array index for a stable category key, or -1 / undefined when the category
// has no chip (→ treated as "Alle"). The single place that converts the external
// cat-keyed contract to the internal positional selectedIdx.
function chipIdxForCat(cat: Category | null | undefined): number | undefined {
  if (cat == null) return undefined
  const i = CHIPS.findIndex((c) => c.cat === cat)
  return i >= 0 ? i : undefined
}

function groupIdForCat(cat: Category): string | undefined {
  return CHIP_GROUPS.find((g) => g.cats.includes(cat))?.id
}

const CHIP_BASE_CLS  = "shrink-0 text-xs px-2.5 py-1.5 rounded-full font-medium transition-colors whitespace-nowrap disabled:opacity-50"
const CHIP_ACTIVE_CLS = "bg-primary text-primary-foreground"
const CHIP_IDLE_CLS   = "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"

// ── Drill-in "bracket" container (visual grouping, Variante 1): the open
// group's subcategories are drawn as belonging to ONE physical object — a
// rounded, tinted pill that visually contains a dark, non-interactive group
// label (icon + name) plus "Alle" and every subcategory chip. Only the "←"
// chip stays outside; everything else is unmistakably "inside" the group.
// Deliberately NO vertical padding here: the chips/label inside already
// carry their own py-1.5 (CHIP_BASE_CLS / BRACKET_LABEL_CLS) — adding more
// on the wrapper would stack on top of that and make the whole chip row
// visibly taller only while a group is open (the row height jump this
// comment is here to prevent from regressing). Horizontal padding is fine:
// it doesn't affect row height. ──
const BRACKET_CLS       = "flex-none flex items-center gap-1.5 bg-muted border border-border rounded-full pl-1 pr-1.5"
const BRACKET_LABEL_CLS = "flex-none inline-flex items-center gap-1.5 bg-foreground text-background rounded-full px-3 py-1.5 text-xs font-bold whitespace-nowrap"
const BRACKET_CHIP_IDLE_CLS = "bg-transparent text-foreground hover:bg-background/70"

type Mode        = "text" | "nearby"
type NearbyPhase = "idle" | "locating" | { district: string; lat: number; lon: number } | "error"

// One suggestion from /api/geocode/unified-suggest — areas (cities/districts)
// and venues (POIs) arrive classified in a single ranked list, areas first.
type UnifiedSuggestion = {
  kind:     "area" | "venue"
  display:  string
  name:     string
  lat:      number | null
  lon:      number | null
  osmKey:   string | null
  osmValue: string | null
}

// Matches any quoted segment (straight, curly, German typographic, guillemets) —
// used to strip the quoted name filter before autocomplete / location parsing.
// Mirrors the quote classes in extractQuotedName (lib/llm.ts).
const QUOTE_STRIP_RE = /["'„""‟"«»‹›][^"'„""‟"«»‹›]*["'„""‟"«»‹›]?/gu

// The plain-text part of the input: quoted name removed, a leading "in " dropped
// so "…" in Berlin" doesn't produce "<Chip> in in Berlin" queries.
function locationPart(input: string): string {
  return input.replace(QUOTE_STRIP_RE, "").replace(/^\s*in\s+/i, "").trim()
}

function PlaceCategoryIcon({ osmKey, osmValue }: { osmKey: string | null; osmValue: string | null }) {
  const Icon = (() => {
    if (osmKey === "amenity") {
      switch (osmValue) {
        case "cafe":       return Coffee
        case "restaurant": return UtensilsCrossed
        case "bar":
        case "pub":
        case "biergarten": return Beer
        case "fast_food":
        case "food_court": return UtensilsCrossed
        case "cinema":     return Film
        case "library":    return Library
        case "theatre":    return Landmark
        case "ice_cream":  return IceCream
      }
    }
    if (osmKey === "tourism") {
      switch (osmValue) {
        case "hotel":
        case "motel":
        case "guest_house":
        case "hostel":
        case "apartment":  return Hotel
        case "museum":     return BookOpen
        case "gallery":
        case "arts_centre":return GalleryHorizontal
        case "attraction":
        case "theme_park": return Star
      }
    }
    return MapPin
  })()
  return <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const res = await fetch(`/api/geocode/reverse?lat=${lat}&lon=${lon}`)
  if (!res.ok) throw new Error("reverse geocode failed")
  const data = await res.json()
  return data.district ?? ""
}

// Forward-geocode a typed place to coordinates for the "Schnellsuche" amenity
// chips (e.g. "Hamburg" + 🅿 → parking in Hamburg). DACH-restricted unless the
// international flag is passed through (mirrors unified-suggest).
async function geocodeLocation(q: string, international: boolean): Promise<Coords> {
  const intlParam = international ? "&intl=1" : ""
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}${intlParam}`)
  if (!res.ok) throw new Error("geocode failed")
  const data = await res.json()
  if (typeof data.lat !== "number" || typeof data.lon !== "number") throw new Error("no coords")
  return { lat: data.lat, lon: data.lon }
}

export default function ChatPanel({ onSearch, onPlaceSearch, isLoading, onModeChange, autoFocus, initialLocation, initialChipCat, initialMode, onGpsResolved, locateTrigger, exitNearbyTrigger, biasCoords, onAmenitySearch, amenityActive, onExitAmenity, onCategoryQueryChange, activeSearchCoords, searchCenter, international, getViewportOrigin, panPending }: Props) {
  // Internal positional form of the cat-keyed prop. The mount/default effects below
  // were written against an index; deriving it here keeps that logic untouched while
  // the external contract stays category-keyed.
  const initialChipIdx = chipIdxForCat(initialChipCat)
  const t = useTranslations()
  const { locale } = useLocale()
  const isMobile = useIsMobile()
  const [mode,           setMode]           = useState<Mode>(initialMode === "place" ? "text" : (initialMode ?? "nearby"))
  const [nearbyPhase,    setNearbyPhase]    = useState<NearbyPhase>("idle")
  const [location,       setLocation]       = useState("")
  // null = "Alle" (all categories, the default) — chips are optional scope
  // shortcuts, not a mandatory pre-selection.
  const [selectedIdx,    setSelectedIdx]    = useState<number | null>(null)
  // Whole-group selection ("Alle <Gruppe>", drill-in Konzept A) — mutually
  // exclusive with selectedIdx (exactly one of the two is non-null, or both
  // null for "Alle"). Transient: never persisted as a distinct value, see
  // groupLabel's doc comment above.
  const [selectedGroup,  setSelectedGroup]  = useState<string | null>(null)
  // Which group's subcategory row is currently shown in place of the group
  // list (null = collapsed, showing "Alle" + all group chips). Purely local
  // UI state — not persisted, not read by any search/tracking logic.
  const [openGroup,      setOpenGroup]      = useState<string | null>(null)
  const [suggestions,    setSuggestions]    = useState<UnifiedSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightedIdx, setHighlightedIdx] = useState(-1)
  const [inputPulse,     setInputPulse]     = useState(false)
  // True while the input holds a venue picked from the dropdown — chips are
  // meaningless for a single-venue search and are greyed out until the user
  // edits the field again.
  const [venuePicked,    setVenuePicked]    = useState(false)
  const [showDevConsole, setShowDevConsole] = useState(false)
  // GPS acquisition for an amenity chip tap with no known location yet (finding
  // F1/F6b). Deliberately separate from `nearbyPhase`/`handleLocate` — this must
  // NOT switch the legacy Überall/In-der-Nähe mode or touch venue search state;
  // it only ever resolves into onAmenitySearch.
  const [amenityLocating,    setAmenityLocating]    = useState<AmenityType | null>(null)
  const [amenityLocateError, setAmenityLocateError] = useState<string | null>(null)
  const selectedIdxRef       = useRef<number | null>(null)
  const selectedGroupRef     = useRef<string | null>(null)
  // True once the startup category has been definitively established — by a SEO
  // deep-link, a restored last search, the user's default-category setting, or a
  // manual chip pick. Gates the async default-chip effect so it applies the
  // setting exactly once and never overrides one of the above.
  const chipResolvedRef      = useRef(false)
  const debounceRef          = useRef<ReturnType<typeof setTimeout>>(undefined)
  const suggestAbortRef      = useRef<AbortController>(undefined)
  // Cancellable handle for onBlur's dropdown-close delay (see closeDropdown
  // below) — without cancelling it, a blur→refocus within the 150ms window
  // reopens the dropdown and then the stale timer immediately closes it again
  // out from under the now-focused user.
  const blurCloseRef         = useRef<ReturnType<typeof setTimeout>>(undefined)
  const locatingRef          = useRef(false)
  // Set when an amenity chip is tapped while a "Nearby" locate (handleLocate) is
  // already in flight (nearbyPhase === "locating") — e.g. tapping "In der Nähe
  // suchen" and immediately tapping "WC" before GPS resolves. Rather than firing
  // a second, independent geolocation request that races the first one,
  // selectAmenity parks the requested type here; handleLocate's success/error
  // handler checks it and routes that one fix into an amenity search instead of
  // (not in addition to) the venue nearby-search it would otherwise run.
  const pendingAmenityTypeRef = useRef<AmenityType | null>(null)
  const watchIdRef           = useRef<GeoWatchId | null>(null)
  // Holds the location value that was set programmatically (restore, area pick,
  // venue pick). Autocomplete is suppressed as long as location equals this
  // value — survives the locale/biasCoords re-renders that fire after a search
  // completes, which a one-shot skip flag would miss (the dropdown would
  // re-open). Cleared when the user types.
  const programmaticLocRef = useRef("")
  // The venue picked from the dropdown — lets Enter re-run the place search
  // while the input still shows the picked suggestion.
  const pickedVenueRef    = useRef<{ display: string; name: string; lat: number | null; lon: number | null } | null>(null)
  const inputRef          = useRef<HTMLInputElement>(null)
  const handleLocateRef   = useRef<() => void>(() => {})
  // Mirrors exitNearbyState so the exitNearbyTrigger effect (declared before the
  // function) can call the live implementation, same pattern as handleLocateRef.
  const exitNearbyStateRef = useRef<(notifyParent?: boolean) => void>(() => {})
  // Mirrors `locale` so async GPS callbacks read the live value rather than the
  // closure-captured snapshot.
  const localeRef         = useRef(locale)

  // Precomputed (not looked up inline in JSX) so the drill-in chip row below
  // is a plain conditional, not a closure-creating IIFE.
  const openGroupDef = openGroup ? CHIP_GROUPS.find((g) => g.id === openGroup) ?? null : null
  const district = typeof nearbyPhase === "object" ? nearbyPhase.district : null
  // The green "at my location" badge reflects whether the map is currently centred on
  // the GPS fix. A pending pan (panPending) means the user has moved the search centre
  // away, so hide the badge and revert the ⌖ button to its neutral locate state — the
  // displayed mode then always matches what a chip/amenity tap will actually search
  // (the panned viewport, not the GPS fix). nearbyPhase itself is untouched, so the
  // badge returns once the pan is cleared (panned back / new search recentres the map).
  const showNearbyBadge = district !== null && !panPending
  // The visible location token (variant B): additionally steps back while the
  // user types — the field then shows only the typed text, and the token
  // returns when the field is cleared. nearbyPhase is NOT touched by typing;
  // the semantic exit still happens at submit / suggestion-pick time
  // (exitNearbyState), because exiting on the first keystroke would fire
  // onModeChange("text") → clearSearchState and wipe on-screen results.
  const showLocationToken = showNearbyBadge && !location

  // Sync mode when HomeClient corrects chatMode post-hydration via useLayoutEffect.
  // Maps legacy "place" initialMode to "text" (place mode was removed in v4.13).
  useEffect(() => {
    if (initialMode !== undefined) setMode(initialMode === "place" ? "text" : initialMode)
  }, [initialMode])

  // Restore last search on mount (chip + location, never nearby mode).
  // URL-derived initialLocation takes priority over localStorage.
  useEffect(() => {
    // applyDefaultChip only resolves when initialChipIdx is already known. At
    // mount it is usually undefined for the settings-driven default (useSettings
    // loads asynchronously) — leaving chipResolvedRef false so the reactive
    // effect below applies it once the setting arrives. For SEO deep-links
    // initialChipIdx is synchronous, so it resolves here immediately.
    const applyDefaultChip = () => {
      if (initialChipIdx !== undefined && initialChipIdx >= 0 && initialChipIdx < CHIPS.length) {
        setSelectedIdx(initialChipIdx)
        selectedIdxRef.current = initialChipIdx
        chipResolvedRef.current = true
      }
    }
    if (initialLocation) {
      programmaticLocRef.current = initialLocation
      setLocation(initialLocation)
      applyDefaultChip()
      return
    }
    try {
      const parsed = loadSearchInput()
      if (parsed) {
        const loc = parsed.loc
        // New format stores the stable category key `cat`; legacy entries stored a
        // positional `idx` — translate those once via the same table as the settings
        // migration. `cat: null` / `idx: null` means an explicit "Alle" choice.
        const hasCat = "cat" in parsed
        const savedCat: Category | null = hasCat ? (parsed.cat as Category | null) : legacyChipIdxToCat(parsed.idx)
        const explicitAlle = hasCat ? parsed.cat === null : parsed.idx === null
        const restoredIdx = chipIdxForCat(savedCat)
        if (restoredIdx !== undefined) {
          setSelectedIdx(restoredIdx)
          selectedIdxRef.current = restoredIdx
          chipResolvedRef.current = true
        } else if (explicitAlle) {
          // Explicit "Alle" from the last search wins over the default setting.
          chipResolvedRef.current = true
        } else {
          applyDefaultChip()
        }
        // Only restore the location text in text mode. In nearby mode the GPS pill
        // already conveys the active location; showing a stale city name alongside
        // the pill (e.g. "München" + "Berlin Mitte ●") is contradictory.
        const startsInNearby = initialMode !== "text"
          && (loadSettings().defaultSearchMode ?? "nearby") === "nearby"
        if (!startsInNearby && typeof loc === "string" && loc.trim()) {
          programmaticLocRef.current = loc
          setLocation(loc)
        }
      } else {
        applyDefaultChip()
      }
    } catch { applyDefaultChip() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply the user's default category once it resolves. initialChipIdx arrives
  // asynchronously (useSettings reads localStorage in an effect), so the mount
  // effect above usually can't see it yet — the bug where "Standard-Kategorie"
  // was ignored and the chip fell back to "Alle". Mirrors the initialMode
  // effect. chipResolvedRef ensures it only fills the startup default and never
  // overrides a SEO deep-link, a restored last search, or a manual pick.
  useEffect(() => {
    if (chipResolvedRef.current) return
    if (initialChipIdx === undefined || initialChipIdx < 0 || initialChipIdx >= CHIPS.length) return
    setSelectedIdx(initialChipIdx)
    selectedIdxRef.current = initialChipIdx
    chipResolvedRef.current = true
  }, [initialChipIdx])

  // Auto-trigger geolocation when starting in "nearby" mode — but NOT for a
  // first-time visitor (the welcome screen must stay until they interact).
  //
  // We read the first-visit state DIRECTLY from localStorage here rather than
  // from an isFirstVisit-derived prop. Such a prop is racy: the
  // #418 hydration fix initialises isFirstVisit=false and corrects it to true in
  // a useLayoutEffect, but React flushes this passive mount effect BEFORE that
  // correction's re-render settles — so any prop/ref read here still sees the
  // stale `false`. localStorage is the ground truth, client-side and timing-
  // independent. (Invisible on web with slow browser GPS; obvious on native.)
  useEffect(() => {
    // On a session return (home remounted after visiting a static page), HomeClient
    // restores the mode and re-runs the last search itself — do NOT also auto-locate
    // (would fire a second, unwanted nearby search). Instead, restore the located
    // nearby UI (district label + focus chips, no "locate" button) from the saved
    // location, and sync the coords up so focus mode / "search here" keep working.
    if (isReturningNow()) {
      const restoredMode = loadSearchRun()?.chatMode ?? loadActiveMode()
      if (restoredMode === "nearby") {
        const loc = loadNearbyLocation()
        if (loc) {
          setNearbyPhase({ district: loc.district, lat: loc.lat, lon: loc.lon })
          onGpsResolved?.({ lat: loc.lat, lon: loc.lon })
        }
      }
      return
    }
    const isFirstVisit = (() => {
      try { return !localStorage.getItem("ap_visited") && !localStorage.getItem("ap_welcome_dismissed") }
      catch { return false }
    })()
    // Effective startup mode. `initialMode` is racy on the iOS standalone PWA:
    // it derives from chatMode, which is seeded via a synchronous loadSettings()
    // in a useLayoutEffect that returns the default ("nearby") when localStorage
    // is not yet readable at layout-effect time — so a saved "text" preference
    // would arrive too late and this effect would wrongly auto-locate. Like the
    // isFirstVisit read above, localStorage is the ground truth at passive-effect
    // time. initialMode === "text" is never the stale value (the stale default is
    // always "nearby"), so we trust it as an override (SEO deep-link); otherwise
    // we read the resolved preference directly.
    const effectiveMode = initialMode === "text"
      ? "text"
      : (loadSettings().defaultSearchMode ?? "nearby")
    if (!isFirstVisit && effectiveMode === "nearby") {
      onModeChange?.("nearby")
      handleLocate()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Stop watchPosition and any pending dropdown-close timer on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        clearWatchPosition(watchIdRef.current)
      }
      clearTimeout(blurCloseRef.current)
    }
  }, [])

  // Show attention pulse only on the very first page visit
  useEffect(() => {
    const key = "ap_first_visit"
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, "1")
      setInputPulse(true)
    }
  }, [])

  // Keep ref pointing at latest handleLocate to avoid stale closure in the trigger effect
  useEffect(() => { handleLocateRef.current = handleLocate })
  useEffect(() => { localeRef.current = locale })

  // Fire locate when the parent bumps locateTrigger (e.g. welcome-screen dismiss)
  useEffect(() => {
    if (!locateTrigger) return
    setMode("nearby")
    onModeChange?.("nearby")
    handleLocateRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateTrigger])

  // Leave nearby mode when the parent runs an explicit "Hier suchen" at a panned
  // viewport: the results are no longer "near me", so a following chip pick must
  // refine the searched area (activeSearchCoords) rather than re-run at the GPS fix.
  useEffect(() => {
    if (!exitNearbyTrigger) return
    // notifyParent=false: the parent (HomeClient) already called setChatMode("text")
    // in the same batch as handleSearch, so onModeChange must not fire here — it
    // would trigger clearSearchState() and wipe the lastQuery that handleSearch just set.
    exitNearbyStateRef.current(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exitNearbyTrigger])


  // Fetch unified autocomplete suggestions (areas + venues, Photon via backend proxy).
  // Deliberately does NOT toggle `showSuggestions` — dropdown visibility is now
  // fully decoupled from fetch results (no-submit-button redesign): the always-
  // present freetext row must stay visible whether or not the API returns
  // anything, so opening/closing is owned by onChange/onFocus/onBlur/Escape/
  // selection/submit instead. This effect only ever updates the `suggestions`
  // data array.
  useEffect(() => {
    // Skip fetch for programmatically set values (restore / suggestion pick) —
    // stays suppressed across re-renders until the user actually edits the field.
    if (programmaticLocRef.current && location === programmaticLocRef.current) return

    // Autocomplete on the non-quoted part of the input
    const query = location.replace(QUOTE_STRIP_RE, "").trim()

    if (query.length < 2) {
      setSuggestions([])
      return
    }

    clearTimeout(debounceRef.current)
    suggestAbortRef.current?.abort()
    debounceRef.current = setTimeout(async () => {
      const ac = new AbortController()
      suggestAbortRef.current = ac
      try {
        const bias = biasCoords ? `&lat=${biasCoords.lat}&lon=${biasCoords.lon}` : ""
        const intlParam = international ? "&intl=1" : ""
        const res = await fetch(`/api/geocode/unified-suggest?q=${encodeURIComponent(query)}&lang=${locale}${bias}${intlParam}`, { signal: ac.signal })
        if (!res.ok) return
        const data: UnifiedSuggestion[] = await res.json()
        setSuggestions(data)
        setHighlightedIdx(-1)
      } catch { /* ignore — covers AbortError and network errors */ }
    }, 300)

    return () => {
      clearTimeout(debounceRef.current)
      suggestAbortRef.current?.abort()
    }
  }, [location, locale, biasCoords?.lat, biasCoords?.lon, international])

  function clearPickState() {
    programmaticLocRef.current = ""
    pickedVenueRef.current = null
    setVenuePicked(false)
  }

  // Dropdown close on blur: delayed (not immediate) so a mousedown on a
  // dropdown row — which blurs the input just before its own click handler
  // runs — doesn't close the dropdown out from under that click. Cancellable
  // via blurCloseRef so a blur→refocus within the delay window (e.g. tapping
  // another control and coming straight back) doesn't leave a stale timer
  // that force-closes a dropdown the user just reopened. Also resets
  // highlightedIdx, matching Escape's own close (line ~1041) — otherwise
  // aria-activedescendant can keep pointing at a highlighted option's id
  // after that option's <li> has unmounted.
  function scheduleDropdownClose() {
    clearTimeout(blurCloseRef.current)
    blurCloseRef.current = setTimeout(() => {
      setShowSuggestions(false)
      setHighlightedIdx(-1)
    }, 150)
  }

  function cancelDropdownClose() {
    clearTimeout(blurCloseRef.current)
  }

  function chipLabel(idx: number | null, loc: Locale = locale): string | null {
    if (idx === null) return null
    return chipText(CHIPS[idx].cat, loc)
  }

  // Resolves the active selection (single category OR whole group) to a query
  // label string. Mirrors chipLabel's signature so existing call sites only
  // need `selectedIdx` swapped for a no-arg call.
  function selectionLabel(loc: Locale = locale): string | null {
    if (selectedGroup) return groupLabel(selectedGroup, loc)
    return chipLabel(selectedIdx, loc)
  }

  // Query for a coordinates-backed nearby search. With no chip, "in <district>"
  // keeps parseQuery on the all-categories path (the location part must not
  // trigger category hints — e.g. the city "Essen"); the no-district fallback
  // is a neutral non-empty string (the route rejects empty queries).
  function nearbyQuery(label: string | null, district: string): string {
    if (label) return district ? `${label} in ${district}` : label
    if (district) return `in ${district}`
    return localeRef.current === "de" ? "Orte in der Nähe" : "places nearby"
  }

  // Category-only query for the map's "search here" when no search has run yet.
  // Coordinates from the pan are passed alongside, so the location part is ignored
  // by the route — only the category is parsed out. Null chip → all categories
  // (a neutral non-empty word that matches no category hint; route rejects empty).
  function categoryQuery(label: string | null): string {
    return label ?? (localeRef.current === "de" ? "Orte" : "places")
  }

  // Keep the parent's "search here" query in sync with the visible chip selection.
  useEffect(() => {
    onCategoryQueryChange?.(categoryQuery(selectionLabel()))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx, selectedGroup, locale])

  function switchMode(next: Mode) {
    clearPickState()
    setMode(next)
    onModeChange?.(next)
    setSuggestions([])
    setShowSuggestions(false)
    if (next !== "nearby") {
      if (watchIdRef.current !== null) {
        clearWatchPosition(watchIdRef.current)
        watchIdRef.current = null
      }
      return
    }
    // Always fetch a fresh fix on entering nearby mode. Reusing the cached
    // nearbyPhase coords here re-ran the search at an arbitrarily old position
    // ("I see an old location"); handleLocate re-locates, calls onGpsResolved
    // (so the dot is fresh too) and searches at the current coords.
    handleLocate()
  }

  // Tear down the "nearby" context: stop follow-me, drop the GPS-fix phase (which
  // also clears the location token AND any stale "locating"/"error" state), and —
  // only if we were actually in nearby mode — flip the internal mode back to text
  // so distance display / nearby semantics turn off downstream via onModeChange.
  // Called by every typed-search path (submit / suggestion pick): the old visible
  // "Überall" tab used to do this transition, the always-on field must do it too,
  // otherwise a text search inherits the previous nearby fix (stale "you are here"
  // token + distance-from-old-centre on a non-nearby result set).
  function exitNearbyState(notifyParent = true) {
    if (watchIdRef.current !== null) {
      clearWatchPosition(watchIdRef.current)
      watchIdRef.current = null
    }
    setNearbyPhase("idle")
    if (mode === "nearby") {
      setMode("text")
      if (notifyParent) onModeChange?.("text")
    }
  }
  useEffect(() => { exitNearbyStateRef.current = exitNearbyState })

  // Inline ⌖ button: express the "nearby" intent without a visible mode tab.
  // Equivalent to the old "In der Nähe" tab — switches internal mode and locates.
  // Clears any typed text first: ⌖ means "use MY location", so a leftover "Hamburg"
  // in the field would otherwise contradict the GPS results (and the location token).
  function onLocateTap() {
    if (isLoading) return
    track("locate")
    setLocation("")
    switchMode("nearby")
  }

  // ✕ on the active-location token: drop the GPS fix and return to the neutral
  // typed-search state.
  function clearLocationToken() {
    exitNearbyState()
  }

  // Amenity chip tap: run a parking/WC search at the best-known location. Order:
  // an active nearby fix → the current area's coordinates → else auto-locate (the
  // GPS fix is routed back here via pendingAmenityRef). Single-select like the
  // venue chips: the parent owns `amenityActive` and clears it on a venue search.
  // Amenity chip tap: run a parking/WC search at the best-known location.
  // Priority: an active nearby GPS fix (freshest/most specific) → the resolved
  // centre of ANY prior search (searchCenter — covers a plain typed-area search
  // like "Cafés in Hamburg", which never carries client-side coordinates) →
  // activeSearchCoords (coordinate-based searches) → else acquire GPS directly.
  //
  // Deliberately does NOT call setMode/onModeChange/handleLocate: those are tied
  // to the legacy Überall/In-der-Nähe tabs and to the venue search's
  // clearSearchState, which used to fire SYNCHRONOUSLY on tap — wiping any
  // on-screen venue results before the GPS fix even resolved, and silently
  // discarding the previously-searched area's context on locate failure. The
  // amenity chips are mode-agnostic by design (see issue #30) and must not
  // touch venue search state at all.
  function selectAmenity(type: AmenityType) {
    setSuggestions([])
    setShowSuggestions(false)
    setAmenityLocateError(null)
    // 1. An explicit, user-typed location wins — even over a live GPS fix. Typing
    // "Hamburg" while standing in Berlin means you want Hamburg ("Schnellsuche"
    // is location-neutral, not nearby-only). A picked area/venue already ran a
    // search, so its centre is covered by searchCenter in step 4 — no geocode.
    const typed = locationPart(location)
    const isUserTyped = !!location && location !== programmaticLocRef.current && !!typed
    if (isUserTyped) {
      setAmenityLocating(type)
      geocodeLocation(typed, !!international)
        .then((coords) => {
          setAmenityLocating(null)
          onAmenitySearch?.(type, coords)
        })
        .catch(() => {
          setAmenityLocating(null)
          // Geocoding a typed place failed — this is "place not found", not the
          // GPS "your location could not be determined" case.
          setAmenityLocateError(t.chat.placeNotFound)
        })
      return
    }
    // 2. The user panned the map → search the visible area. Below a typed location
    // (above) but ABOVE the active GPS fix: a visible pan ("search here" pill) is the
    // newer, explicit spatial intent and must win over the nearby fix, else a default
    // nearby search would always re-run at the GPS location and ignore the pan (the
    // reported venue-chip bug, symmetric here). `panned` = the viewport centre so the
    // parent snaps + persists the amenity radius (mirrors "search this area").
    const vp = amenityViewportOrigin(getViewportOrigin?.())
    if (vp) {
      onAmenitySearch?.(type, vp.center, vp.radiusKm, vp.center)
      return
    }
    if (typeof nearbyPhase === "object") {
      onAmenitySearch?.(type, { lat: nearbyPhase.lat, lon: nearbyPhase.lon })
      return
    }
    // A "Nearby" locate is already in flight — wait for that one fix instead of
    // starting a second, independent geolocation request (see pendingAmenityTypeRef).
    if (nearbyPhase === "locating") {
      pendingAmenityTypeRef.current = type
      setAmenityLocating(type)
      return
    }
    const known = searchCenter ?? activeSearchCoords
    if (known) {
      onAmenitySearch?.(type, known)
      return
    }
    if (!isGeolocationAvailable()) {
      setAmenityLocateError(t.chat.locationError)
      return
    }
    setAmenityLocating(type)
    getCurrentPosition({ timeout: 30_000, enableHighAccuracy: false, maximumAge: 60_000 })
      .then(({ lat, lon }) => {
        setAmenityLocating(null)
        onAmenitySearch?.(type, { lat, lon })
      })
      .catch(() => {
        setAmenityLocating(null)
        setAmenityLocateError(t.chat.locationError)
      })
  }

  // Shared selection logic for both a single-category pick (idx set, groupId
  // null) and a whole-group pick (groupId set, idx null) — exactly one is
  // non-null, or both null for "Alle". Persistence/tracking call sites read
  // `selectedIdx` only, so a whole-group pick degrades to "Alle" on reload —
  // see groupLabel's doc comment.
  function applySelection(idx: number | null, groupId: string | null) {
    const label   = groupId ? groupLabel(groupId, locale) : chipLabel(idx)
    const trackCat = groupId ? `group:${groupId}` : (idx != null ? CHIPS[idx].cat : "alle")
    track("chip_select", { category: trackCat, mode })
    // Leaving amenity mode: a venue/"Alle" chip is single-select with the amenity
    // chips. If no search ends up firing (text mode, no location), the parent still
    // needs to clear amenityActive so the highlight returns to this chip.
    onExitAmenity?.()
    // Cancel a pending amenity-locate routing (see pendingAmenityTypeRef) — the
    // user picked a venue/"Alle" chip instead, so the in-flight GPS fix (if any)
    // should land as the normal venue nearby-search, not an amenity search.
    pendingAmenityTypeRef.current = null
    setAmenityLocating(null)
    chipResolvedRef.current = true
    setSelectedIdx(idx)
    selectedIdxRef.current = idx
    setSelectedGroup(groupId)
    selectedGroupRef.current = groupId
    // Highest-priority spatial intent: the user has panned the map (the "search
    // here" pill is showing, so getViewportOrigin returns the visible viewport) and
    // wants THIS area searched — even in nearby mode, where the active GPS fix would
    // otherwise win and the pan be silently ignored (the reported bug). A freshly
    // typed location still beats the viewport (chipIsUserTyped → vp null → falls
    // through to the location branches). Leaving nearby mode is intended: the results
    // are no longer "near me", so distance-from-me display must turn off. Clears any
    // active venue pick (we're searching an area now, not "cafés near the venue").
    const chipTyped = locationPart(location)
    const chipIsUserTyped = !!location && location !== programmaticLocRef.current && !!chipTyped
    const vp = chipIsUserTyped ? null : venueViewportOrigin(getViewportOrigin?.())
    if (vp) {
      track("viewport_chip_search", { category: trackCat, radius_km: Math.round(vp.radiusKm) })
      if (mode === "nearby") exitNearbyState()
      pickedVenueRef.current = null
      setVenuePicked(false)
      setSuggestions([])
      setShowSuggestions(false)
      onSearch(categoryQuery(label), vp.center, undefined, vp.radiusKm)
      return
    }
    if (mode === "nearby" && typeof nearbyPhase === "object") {
      // Active GPS fix: fire nearby search without dropping the fix (the location
      // token should stay visible — user is still "in nearby mode").
      onSearch(nearbyQuery(label, nearbyPhase.district), { lat: nearbyPhase.lat, lon: nearbyPhase.lon })
      return
    }
    // No active GPS fix but still in nearby mode (e.g. GPS failed / idle):
    // exit nearby so mode doesn't stay stuck and distance display turns off.
    if (mode === "nearby") exitNearbyState()
    // Picking a category while a specific venue is active exits the venue lookup
    // and runs a category search around the venue's coordinates ("cafés near the
    // Philharmonie"). We deliberately do NOT call clearPickState(): leaving
    // programmaticLocRef === location keeps the autocomplete dropdown suppressed
    // until the user actually edits the field. If we have no coordinates (e.g. the
    // venue search 404'd), fall through to the location-based branches below.
    if (mode === "text" && venuePicked) {
      pickedVenueRef.current = null
      setVenuePicked(false)
      setSuggestions([])
      setShowSuggestions(false)
      if (activeSearchCoords) {
        onSearch(categoryQuery(label), activeSearchCoords)
        return
      }
    }
    if (mode === "text" && !pickedVenueRef.current && activeSearchCoords) {
      // Current results came from a coordinate-based search ("search here" /
      // nearby) — refine THIS area with the new category instead of jumping to
      // the location textbox, which may show an unrelated, stale place.
      setSuggestions([])
      setShowSuggestions(false)
      onSearch(categoryQuery(label), activeSearchCoords)
    } else if (mode === "text" && !pickedVenueRef.current && locationPart(location)) {
      setSuggestions([])
      setShowSuggestions(false)
      const quoted = extractQuotedName(location)
      const locPart = locationPart(location)
      // "in <loc>" (not raw) so a re-fired all-categories search never re-parses
      // category terms out of what is known to be a location string.
      onSearch(label ? `${label} in ${locPart}` : `in ${locPart}`, undefined, quoted || undefined)
    }
  }

  function selectChip(idx: number | null) {
    applySelection(idx, null)
  }

  function selectGroupWhole(groupId: string) {
    applySelection(null, groupId)
  }

  // Group chip tap (level 1 → level 2): opens the subcategory row. If the
  // active selection isn't already inside this group, selecting the whole
  // group is the natural default (mirrors tapping straight into "Alle X").
  function openGroupChip(groupId: string) {
    setOpenGroup(groupId)
    const activeCat = selectedIdx != null ? CHIPS[selectedIdx].cat : null
    const alreadyInGroup = selectedGroup === groupId || (activeCat != null && groupIdForCat(activeCat) === groupId)
    if (!alreadyInGroup) {
      selectGroupWhole(groupId)
    } else if (amenityActive != null) {
      // The existing selection already belongs to this group, so selection
      // itself wouldn't change — but an amenity search (parking/WC) is
      // currently showing. Re-apply the existing pick so opening the group
      // also exits amenity mode and re-fires the venue search, exactly like
      // tapping any other venue chip already does (applySelection always
      // calls onExitAmenity). Without this, opening the group leaves the
      // amenity results on screen with no way to tell they're now stale.
      if (activeCat != null) selectChip(selectedIdx)
      else selectGroupWhole(groupId)
    }
  }

  function closeGroupChip() {
    setOpenGroup(null)
  }

  function buildQuery(loc: string) {
    const label = selectionLabel()
    // No chip → send the raw text; parseQuery scopes categories from the part
    // before "in" ("Sushi in Berlin") or falls back to all categories.
    if (!label) return loc.trim()
    const trimmed = loc.trim()
    // Text that carries its own "in <location>" structure is a complete query —
    // prefixing the chip label would nest two "in"s ("Arztpraxen in Arzt in
    // Frankenthal"), and parseQuery would then geocode "Arzt in Frankenthal"
    // as the location, which fails. The typed text wins over the chip; the
    // chip prefix applies to bare location inputs only.
    if (/\bin\s+/i.test(trimmed)) return trimmed
    return trimmed ? `${label} in ${trimmed}` : label
  }

  function submit() {
    if (isLoading) return
    // No-submit-button redesign: submit() is now the only place a search
    // starts from (Enter, the freetext dropdown row, or — for the empty+GPS-fix
    // case — Enter alone). Blur on mobile only, so the on-screen keyboard closes
    // and doesn't hide the results that are about to load. Desktop keyboard/
    // screen-reader users reach submit() exclusively via Enter, and there is no
    // on-screen keyboard to dismiss there — blurring would just drop focus to
    // <body> with nothing to restore it, forcing a Tab/click back into the
    // field to refine or re-run the query.
    if (isMobile) inputRef.current?.blur()
    clearTimeout(debounceRef.current)
    suggestAbortRef.current?.abort()
    if (location.trim().toLowerCase() === "accessible places") {
      setShowDevConsole(true)
      setLocation("")
      return
    }
    if (!location.trim()) {
      // Empty field with an active GPS fix (the green location token): "Suchen"
      // re-runs the nearby search at the fix — consistent with the token saying
      // "searching around <district>". Without a fix an empty submit stays a no-op
      // (the button is disabled then; Enter can still reach this path).
      if (typeof nearbyPhase === "object" && showNearbyBadge) {
        onSearch(nearbyQuery(selectionLabel(), nearbyPhase.district), { lat: nearbyPhase.lat, lon: nearbyPhase.lon })
      }
      return
    }
    setSuggestions([])
    setShowSuggestions(false)
    // Suppress the suggestions effect from re-firing when biasCoords changes
    // after the search completes (searchCenter updates → biasCoords dep changes
    // → effect re-runs with the same input text → dropdown reappears).
    programmaticLocRef.current = location.trim()
    // A typed search is never a nearby search — leave any prior GPS context behind
    // (token, distance display, mode) so it doesn't contaminate these results.
    exitNearbyState()

    // Input still holds a picked venue → re-run the place search for it.
    const picked = pickedVenueRef.current
    if (picked && location.trim() === picked.display) {
      const coords = picked.lat != null && picked.lon != null ? { lat: picked.lat, lon: picked.lon } : undefined
      onPlaceSearch?.(picked.name, coords)
      return
    }

    const quoted = extractQuotedName(location)
    const rest   = locationPart(location)
    if (!rest) {
      // Only a quoted name, no location → search the venue by name.
      if (quoted) onPlaceSearch?.(quoted)
      return
    }
    // Default for raw free text: area search (conservative — never silently
    // routes typed text to a venue lookup; venues are reached via the dropdown).
    // Build the query with the CURRENT chip selection before touching any chip
    // state below — buildQuery's typed-text-wins guard depends on the query
    // text, not on chip state, but re-deriving it after a state change could
    // still double-prefix a query that has no "in" of its own.
    const builtQuery = buildQuery(rest)

    // Sync the chip display to what this query will actually search server-side
    // (lib/llm's parseQuery — the exact function the API route also calls, so
    // no risk of drifting from what the server infers) — otherwise a typed
    // category word ("Restaurants in Berlin Charlottenburg") leaves the chip
    // row showing "Alle" while the results are already filtered to Restaurant.
    // Only representable outcomes get a chip: exactly one category → its chip;
    // exactly one group's full member set → that group; anything else (no
    // hint matched, or a multi-category mix with no matching group) → "Alle",
    // same as today.
    const { categories: parsedCategories } = parseQuery(builtQuery)
    let targetIdx: number | null = null
    let targetGroup: string | null = null
    if (parsedCategories.length === 1) {
      const idx = chipIdxForCat(parsedCategories[0])
      if (idx !== undefined) targetIdx = idx
    } else if (parsedCategories.length > 1) {
      const set = new Set(parsedCategories)
      const matchedGroup = CHIP_GROUPS.find(
        (g) => g.cats.length === parsedCategories.length && g.cats.every((c) => set.has(c)),
      )
      if (matchedGroup) targetGroup = matchedGroup.id
    }
    setSelectedIdx(targetIdx)
    selectedIdxRef.current = targetIdx
    setSelectedGroup(targetGroup)
    selectedGroupRef.current = targetGroup
    setOpenGroup(null)

    saveSearchInput({ cat: targetIdx != null ? CHIPS[targetIdx].cat : null, loc: location.trim() })
    track("search_freetext", { category: targetGroup ? `group:${targetGroup}` : (targetIdx != null ? CHIPS[targetIdx].cat : "alle") })
    onSearch(builtQuery, undefined, quoted || undefined)
  }

  function selectSuggestion(s: UnifiedSuggestion) {
    setSuggestions([])
    setShowSuggestions(false)
    setHighlightedIdx(-1)
    track("suggest_pick", { kind: s.kind })
    // Picking an area/venue is a located (non-GPS) search — drop any prior nearby
    // context so it doesn't leak its token/distance/mode into these results.
    exitNearbyState()

    if (s.kind === "venue") {
      track("place_search")
      programmaticLocRef.current = s.display
      pickedVenueRef.current = { display: s.display, name: s.name, lat: s.lat, lon: s.lon }
      setVenuePicked(true)
      setLocation(s.display)
      const coords = s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : undefined
      onPlaceSearch?.(s.name, coords)
      return
    }

    // Area pick — preserve a quoted name filter the user already typed.
    const quoted      = extractQuotedName(location)
    const newLocation = quoted ? `"${quoted}" in ${s.display}` : s.display
    programmaticLocRef.current = newLocation
    pickedVenueRef.current = null
    setVenuePicked(false)
    setLocation(newLocation)
    saveSearchInput({ cat: selectedIdx != null ? CHIPS[selectedIdx].cat : null, loc: newLocation.trim() })
    // A picked area is known to be a pure location — "in <display>" keeps an
    // all-categories search from re-parsing category terms out of city names.
    onSearch(selectedIdx === null && selectedGroup === null ? `in ${s.display}` : buildQuery(s.display), undefined, quoted || undefined)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showDropdown) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setHighlightedIdx((i) => Math.min(i + 1, suggestions.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setHighlightedIdx((i) => Math.max(i - 1, -1))
        return
      }
      if (e.key === "Enter") {
        e.preventDefault()
        if (highlightedIdx >= 0) selectSuggestion(suggestions[highlightedIdx])
        else submit()
        return
      }
      if (e.key === "Escape") {
        setShowSuggestions(false)
        setHighlightedIdx(-1)
        return
      }
    }
    // Easter Egg #5: the "accessible places" check lives in submit() itself
    // (its own first branch) — submit() is called unconditionally here so
    // there is exactly one copy of the check, reached whether or not the
    // dropdown intercepted this Enter above.
    if (e.key === "Enter") submit()
  }

  function handleLocate() {
    if (locatingRef.current) return
    if (!isGeolocationAvailable()) { setNearbyPhase("error"); return }
    locatingRef.current = true
    setNearbyPhase("locating")
    getCurrentPosition({ timeout: 30_000, enableHighAccuracy: false, maximumAge: 60_000 })
      .then(async ({ lat, lon }) => {
        locatingRef.current = false
        try {
          const d = await reverseGeocode(lat, lon)
          setNearbyPhase({ district: d, lat, lon })
          saveNearbyLocation({ district: d, lat, lon }) // restore the located UI on a session return
          onGpsResolved?.({ lat, lon })
          // An amenity chip was tapped while this fix was still in flight — route
          // it there instead of firing the venue nearby-search (see
          // pendingAmenityTypeRef / selectAmenity's "locating" branch).
          const pendingAmenity = pendingAmenityTypeRef.current
          if (pendingAmenity) {
            pendingAmenityTypeRef.current = null
            setAmenityLocating(null)
            onAmenitySearch?.(pendingAmenity, { lat, lon })
          } else {
            // Read locale from a ref so a fix that arrives after the user switched
            // language still uses the current value.
            const label = selectedGroupRef.current
              ? groupLabel(selectedGroupRef.current, localeRef.current)
              : chipLabel(selectedIdxRef.current, localeRef.current)
            onSearch(nearbyQuery(label, d), { lat, lon })
          }
        } catch {
          setNearbyPhase("error")
          if (pendingAmenityTypeRef.current) {
            pendingAmenityTypeRef.current = null
            setAmenityLocating(null)
            setAmenityLocateError(t.chat.locationError)
          }
        }
        // Silently track position changes after the initial fix. Uses the native
        // plugin in the app (permission already granted by getCurrentPosition, so
        // no second OS dialog) and navigator.geolocation in the browser.
        if (watchIdRef.current !== null) clearWatchPosition(watchIdRef.current)
        watchPosition(
          ({ lat: wlat, lon: wlon }) => {
            setNearbyPhase((prev) =>
              typeof prev === "object" ? { ...prev, lat: wlat, lon: wlon } : prev
            )
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 30_000 },
        ).then((id) => { watchIdRef.current = id })
      })
      .catch((err) => {
        locatingRef.current = false
        setNearbyPhase("error")
        if (pendingAmenityTypeRef.current) {
          pendingAmenityTypeRef.current = null
          setAmenityLocating(null)
          setAmenityLocateError(t.chat.locationError)
        }
        const msg = (err as { message?: string; code?: number }).message ?? String(err)
        console.error("[geolocation] error", msg)
      })
  }

  // Areas render as a horizontal pill rail (Konzept C), not list rows — a
  // structurally different shape from venues so the two kinds can't be
  // confused at a glance, unlike relying on the section header alone (a venue
  // whose OSM name/city happen to read like a place, e.g. a railway station
  // literally named "Berlin-Charlottenburg", used to be visually
  // indistinguishable from the district itself). Splitting by kind here keeps
  // each suggestion's original index `i` for aria-activedescendant/keyboard
  // nav (handleKeyDown navigates the flat `suggestions` array unchanged).
  const areaEntries  = suggestions.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === "area")
  const venueEntries = suggestions.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === "venue")

  // No-submit-button redesign: the dropdown's first row is always "run this
  // input as typed" (mirrors Enter, which already falls through to submit()
  // whenever nothing is highlighted — see handleKeyDown). It renders whenever
  // there is text to search for, independent of whether the suggest API
  // returned anything — an empty/failed fetch must not remove the only visible
  // way for a mouse/touch user to trigger a search. `showSuggestions` is the
  // open/closed switch (set by onChange/onFocus/onBlur/Escape/selection/submit);
  // suggestion data arriving no longer opens or closes it (see the fetch effect).
  // showDropdown reduces to `showSuggestions && freetextEligible`: `suggestions`
  // can only be non-empty for a query of (quote-stripped) length >= 2, which
  // always implies `freetextEligible` — onChange sets `location` and
  // `showSuggestions` together, so there's no render where stale non-empty
  // suggestions combine with showSuggestions=true and freetextEligible=false.
  const trimmedLocation = location.trim()
  const freetextEligible = trimmedLocation.length > 0
  const showDropdown = showSuggestions && freetextEligible

  return (
    <>
    {showDevConsole && <DevConsole onClose={() => setShowDevConsole(false)} />}
    <div className="flex flex-col gap-3 p-4 border-b border-border bg-card relative z-20">

      {/* ── Unified search field (always visible). No submit button (Google Maps
          model, replacing the earlier docked "Suchen" button): a search starts
          from Enter, the always-present "search for <text>" dropdown row, a
          venue/area suggestion, a category chip, or "Hier suchen" on the map —
          submit() is the single function all of these funnel into. The old
          top-level mode tabs (Überall / In der Nähe) are gone too — the
          "nearby" intent is the inline ⌖ action below; typing/picking a
          suggestion expresses "search there". Internal `mode` state is
          unchanged (issue #28). ── */}
      <div className="relative">
            {inputPulse && (
              <span
                className="absolute inset-0 rounded-md ring-2 ring-primary animate-pulse pointer-events-none z-10"
                style={{ animationIterationCount: 2 }}
                onAnimationEnd={() => setInputPulse(false)}
                aria-hidden
              />
            )}
            <div
              className={cn(
                "flex items-center gap-1.5 h-[38px] w-full rounded-md border bg-background pl-3 pr-1.5",
                "focus-within:ring-1 focus-within:ring-ring",
                isMobile ? "border-primary" : "border-input",
                isLoading && "opacity-50",
              )}
            >
            {venuePicked && (
              <MapPin className="w-4 h-4 text-primary shrink-0" aria-hidden />
            )}
            {/* Active GPS fix as a readable location token IN the field. Hidden
                (not cleared) while text is typed or a pan is pending — same
                reversible pattern as the old badge: nearbyPhase stays untouched,
                only the visible signal steps back so the display always matches
                what a search would actually use. */}
            {/* No dark: variants here — the app is light-only (no .dark theme in
                globals.css), and Tailwind's default dark: fires on the OS setting,
                which would render this token dark inside the light UI. */}
            {showLocationToken && (
              <span
                className="flex items-center gap-0.5 shrink-0 max-w-[60%] rounded-full border border-green-200 bg-green-50 text-green-700 pr-0.5 py-0.5 text-xs font-medium"
              >
                {/* Re-runs the nearby search at the fix — the empty-field "Suchen"
                    equivalent (submit()'s own empty+GPS-fix branch), now reachable
                    as a labelled, Tab-focusable/clickable control instead of only
                    via Enter (the docked "Suchen" button used to be enabled, and
                    therefore Tab-reachable, in exactly this state). */}
                {/* Live pulse — the learned "live location" metaphor. The GPS-active
                    signal lives in this dot + the short label; the district is a
                    de-emphasised suffix, dropped entirely on narrow screens (the
                    tooltip/SR text above keeps the full wording). */}
                {/* blue-500 = the map's user-location dot (#3b82f6, MapView) — the
                    pulse IS that dot, so the two surfaces read as one signal. */}
                <button
                  type="button"
                  onClick={submit}
                  disabled={isLoading}
                  title={t.chat.locationActive(district!)}
                  aria-label={t.chat.locationActive(district!)}
                  className="flex items-center gap-1.5 min-w-0 rounded-full pl-2 pr-1 py-0.5 hover:bg-green-100 transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <span className="relative flex w-2 h-2 shrink-0" aria-hidden>
                    <span className="absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75 animate-ping motion-reduce:animate-none" />
                    <span className="relative inline-flex w-2 h-2 rounded-full bg-blue-500" />
                  </span>
                  <span className="truncate">
                    {t.chat.nearbyAction}
                    <span className="hidden sm:inline font-normal text-green-700/60"> · {district}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={clearLocationToken}
                  disabled={isLoading}
                  aria-label={t.chat.clearLocation}
                  className="shrink-0 rounded-full p-0.5 hover:bg-green-100 transition-colors disabled:opacity-50"
                >
                  <X className="w-3 h-3" aria-hidden />
                </button>
              </span>
            )}
            <input
              ref={inputRef}
              value={location}
              onChange={(e) => {
                clearPickState()
                const v = e.target.value
                setLocation(v)
                setHighlightedIdx(-1)
                // Open (or close, if cleared back to empty) the dropdown immediately —
                // don't wait for the suggest fetch, so the freetext row is available
                // to a mouse/touch user the instant there's something to search for.
                setShowSuggestions(v.trim().length > 0)
              }}
              onKeyDown={handleKeyDown}
              onBlur={scheduleDropdownClose}
              onFocus={() => { cancelDropdownClose(); if (freetextEligible) setShowSuggestions(true) }}
              placeholder={showLocationToken ? t.chat.nearbyTokenPlaceholder : t.chat.unifiedPlaceholder}
              disabled={isLoading}
              autoFocus={autoFocus}
              // "search" so mobile keyboards label the return key accordingly —
              // there is no other submit affordance left to label.
              enterKeyHint="search"
              role="combobox"
              aria-expanded={showDropdown}
              aria-controls="unified-suggest-list"
              aria-autocomplete="list"
              aria-activedescendant={
                highlightedIdx >= 0 ? `unified-opt-${highlightedIdx}`
                : showDropdown && freetextEligible ? "unified-opt-freetext"
                : undefined
              }
              className={cn(
                // text-base (16px) on mobile prevents iOS Safari/WKWebView from
                // auto-zooming the viewport on focus (it zooms any input < 16px and
                // does not reliably reset the scale afterwards — manifests as the
                // whole app being ~20% too wide with the footer clipped). Desktop
                // keeps the denser 14px. Do NOT "fix" this with maximum-scale/
                // user-scalable=no — pinch-zoom must stay enabled (WCAG 1.4.4).
                // Border/ring live on the flex container (focus-within) so the
                // token and inline action sit inside the visual field.
                "flex-1 min-w-0 h-full bg-transparent text-base md:text-sm",
                "placeholder:text-muted-foreground focus:outline-none disabled:opacity-50",
              )}
            />
            {/* Right-side field action — exactly one of three, in priority order:
                a spinner while the search that just started is in flight (no
                submit button left to carry that state); else the ✕ once there's
                text to clear; else the labelled inline "In der Nähe" GPS action,
                which only renders on a genuinely empty field (with text present
                the ✕ takes its place, so tapping it can never silently discard a
                typed query — the old ⌖ bug). */}
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            ) : location ? (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  clearPickState()
                  setLocation("")
                  setSuggestions([])
                  setShowSuggestions(false)
                  clearSearchInput()
                  inputRef.current?.focus()
                }}
                className="shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={t.chat.clearInput}
              >
                <X className="w-3.5 h-3.5" aria-hidden />
              </button>
            ) : !showLocationToken ? (
              <button
                type="button"
                onClick={onLocateTap}
                disabled={isLoading}
                aria-label={t.chat.useLocation}
                aria-busy={nearbyPhase === "locating"}
                className="shrink-0 flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-primary-strong hover:bg-primary/10 transition-colors disabled:opacity-50"
              >
                {nearbyPhase === "locating"
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                  : <LocateFixed className="w-3.5 h-3.5" aria-hidden />}
                {t.chat.nearbyAction}
              </button>
            ) : null}
            </div>

            {/* Grouped autocomplete dropdown: an always-present "search for <text>"
                row first (the mouse/touch equivalent of Enter — see submit()),
                then areas, then venues. The freetext row renders independent of
                the suggest API result, so a mouse/touch user always has a visible
                way to trigger a search even with no suggestions (empty result,
                failed fetch, or a query too short to look up). */}
            {showDropdown && (
              <ul
                role="listbox"
                id="unified-suggest-list"
                className="absolute z-50 top-full left-0 right-0 mt-1 bg-card border border-border rounded-md shadow-lg overflow-hidden"
              >
                {freetextEligible && (
                  <li
                    id="unified-opt-freetext"
                    role="option"
                    aria-selected={highlightedIdx === -1}
                    onMouseDown={(e) => { e.preventDefault(); submit() }}
                    className={cn(
                      "px-3 py-2 text-sm cursor-pointer transition-colors flex items-center gap-2",
                      highlightedIdx === -1
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted",
                      suggestions.length > 0 && "border-b border-border",
                    )}
                  >
                    <Search className="w-3.5 h-3.5 shrink-0" aria-hidden />
                    <span className="flex-1 truncate">{t.chat.suggestSearchFor(trimmedLocation)}</span>
                    <span
                      className={cn(
                        "text-xs shrink-0",
                        highlightedIdx === -1 ? "text-primary-foreground/70" : "text-muted-foreground",
                      )}
                      aria-hidden
                    >
                      ↵
                    </span>
                  </li>
                )}
                {areaEntries.length > 0 && (
                  <li role="presentation" className="px-3 pt-2 pb-2 border-b border-border">
                    <span className="block mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground select-none">
                      {t.chat.suggestGroupAreas}
                    </span>
                    <span role="group" aria-label={t.chat.suggestGroupAreas} className="flex flex-wrap gap-1.5">
                      {areaEntries.map(({ s, i }) => {
                        const commaIdx = s.display.indexOf(",")
                        const splitAt  = commaIdx !== -1 ? commaIdx : s.display.lastIndexOf(" (")
                        const bold     = splitAt !== -1 ? s.display.slice(0, splitAt) : s.display
                        const rest     = splitAt !== -1 ? s.display.slice(splitAt)    : ""
                        return (
                          <button
                            key={`${s.kind}-${s.display}`}
                            type="button"
                            id={`unified-opt-${i}`}
                            role="option"
                            aria-selected={i === highlightedIdx}
                            onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s) }}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm cursor-pointer transition-colors",
                              i === highlightedIdx
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-muted/60 border-border hover:bg-muted",
                            )}
                          >
                            <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden />
                            <span className="whitespace-nowrap">
                              <span className="font-semibold">{bold}</span>{rest}
                            </span>
                          </button>
                        )
                      })}
                    </span>
                  </li>
                )}
                {venueEntries.length > 0 && (
                  <li role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground select-none">
                    {t.chat.suggestGroupVenues}
                  </li>
                )}
                {venueEntries.map(({ s, i }) => {
                  const commaIdx = s.display.indexOf(",")
                  const splitAt  = commaIdx !== -1 ? commaIdx : s.display.lastIndexOf(" (")
                  const bold     = splitAt !== -1 ? s.display.slice(0, splitAt) : s.display
                  const rest     = splitAt !== -1 ? s.display.slice(splitAt)    : ""
                  return (
                    <li
                      key={`${s.kind}-${s.display}`}
                      id={`unified-opt-${i}`}
                      role="option"
                      aria-selected={i === highlightedIdx}
                      onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s) }}
                      className={cn(
                        "px-3 py-2 text-sm cursor-pointer transition-colors",
                        i === highlightedIdx
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <PlaceCategoryIcon osmKey={s.osmKey} osmValue={s.osmValue} />
                        <span>
                          <span className="font-semibold">{bold}</span>{rest}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
      </div>

      {/* Search-in-progress indicator — replaces the old button's spinner+label
          now that there is no button to carry it. Indeterminate sliding bar
          (same .animate-loading-bar keyframes MobileLayout used for its own,
          now-redundant copy — removed there in favour of this single instance,
          which covers both the mobile and desktop ChatPanel instantiation).
          role="status" gives it an implicit polite live region, announced once
          when isLoading turns true; completion is announced separately by
          ResultsList's own live region. */}
      {isLoading && (
        <div className="h-0.5 overflow-hidden rounded-full bg-primary/15" role="status" aria-label={t.chat.thinking}>
          <div className="h-full w-1/4 rounded-full bg-primary animate-loading-bar" />
        </div>
      )}

      {nearbyPhase === "locating" && (
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
          {t.chat.locateButton} …
        </p>
      )}
      {nearbyPhase === "error" && (
        <p role="alert" className="text-xs text-destructive">{t.chat.locationError}</p>
      )}

      {/* ── Chip strip (B2, issue #28; drill-in "Konzept A" for categories added
          v9.55): two visually distinct rows so the three kinds of control no
          longer read as one undifferentiated scroll. Row 1 = venue categories
          ("what kind of place"), two levels: level 1 shows "Alle" + one chip
          per group; tapping a group chip REPLACES the row with that group's
          subcategories ("Alle <Gruppe>" first, then each category) plus a
          leading "←" chip back to level 1. Row 2 = amenity quick-find actions
          (parking / WC). Layout only. Chips are identified by their `cat` key,
          so `CHIPS` / `SETTING_CHIPS` order is cosmetic (no positional index
          contract); amenity chips and „Alle" stay pseudo-chips outside `CHIPS`.
          Each row is its own single-select radiogroup — the level switch does
          not change that, it just changes which chips it contains. ── */}

      {/* Row 1 — venue categories (drill-in) */}
      <div
        role="radiogroup"
        aria-label={t.chat.chipsGroupLabel}
        className="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] -mx-4 px-4"
      >
        {openGroup === null ? (
          <>
            <button
              key="all"
              role="radio"
              onClick={() => selectChip(null)}
              disabled={isLoading}
              aria-checked={amenityActive == null && selectedIdx === null && selectedGroup === null}
              className={cn(
                CHIP_BASE_CLS,
                amenityActive == null && selectedIdx === null && selectedGroup === null
                  ? CHIP_ACTIVE_CLS
                  : CHIP_IDLE_CLS,
              )}
            >
              {t.chat.chipAll}
            </button>
            {CHIP_GROUPS.map((group) => {
              const activeCat = selectedIdx != null ? CHIPS[selectedIdx].cat : null
              const catInGroup = activeCat != null && group.cats.includes(activeCat)
              const isActive = amenityActive == null && (selectedGroup === group.id || catInGroup)
              const groupText = locale === "de" ? group.de : group.en
              const label = catInGroup ? `${groupText} · ${chipText(activeCat!, locale)}` : groupText
              return (
                <button
                  key={group.id}
                  role="radio"
                  onClick={() => openGroupChip(group.id)}
                  disabled={isLoading}
                  aria-checked={isActive}
                  className={cn(CHIP_BASE_CLS, isActive ? CHIP_ACTIVE_CLS : CHIP_IDLE_CLS)}
                >
                  {group.icon} {label} <span aria-hidden="true">›</span>
                </button>
              )
            })}
          </>
        ) : openGroupDef ? (
          <>
            <button
              key="back"
              type="button"
              onClick={closeGroupChip}
              disabled={isLoading}
              aria-label={t.chat.chipBack}
              className={cn(CHIP_BASE_CLS, CHIP_IDLE_CLS, "font-semibold")}
            >
              ←
            </button>
            <div className={BRACKET_CLS}>
              <span className={BRACKET_LABEL_CLS}>
                {openGroupDef.icon} {locale === "de" ? openGroupDef.de : openGroupDef.en}
              </span>
              <button
                key="group-all"
                role="radio"
                onClick={() => selectGroupWhole(openGroupDef.id)}
                disabled={isLoading}
                aria-checked={amenityActive == null && selectedGroup === openGroupDef.id}
                className={cn(
                  CHIP_BASE_CLS,
                  amenityActive == null && selectedGroup === openGroupDef.id ? CHIP_ACTIVE_CLS : BRACKET_CHIP_IDLE_CLS,
                )}
              >
                {t.chat.chipAll}
              </button>
              {openGroupDef.cats.map((cat) => {
                const idx = chipIdxForCat(cat)
                if (idx === undefined) return null
                const isActive = amenityActive == null && selectedIdx === idx
                return (
                  <button
                    key={cat}
                    role="radio"
                    onClick={() => selectChip(idx)}
                    disabled={isLoading}
                    aria-checked={isActive}
                    className={cn(CHIP_BASE_CLS, isActive ? CHIP_ACTIVE_CLS : BRACKET_CHIP_IDLE_CLS)}
                  >
                    {chipIcon(cat)} {chipText(cat, locale)}
                  </button>
                )
              })}
            </div>
          </>
        ) : null}
      </div>

      {/* Row 2 — amenity quick-find actions (parking / WC). The labelled lead-in
          tells first-timers these search around a location, they don't filter
          venues. Location-neutral: a typed place is honoured (selectAmenity §2). */}
      {onAmenitySearch && (
        <div className="flex items-center gap-2 -mt-0.5">
          <span id="amenity-row-label" className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground select-none">
            {t.chat.amenityRowLabel}
          </span>
          <div
            role="radiogroup"
            aria-labelledby="amenity-row-label"
            className="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
          >
            {([
              { type: "parking" as const, icon: "🅿", label: t.chat.chipParking, activeCls: "bg-blue-600 text-white border-blue-600", idleCls: "border-blue-600/40 text-blue-700 dark:text-blue-400" },
              { type: "toilet"  as const, icon: "🚻", label: t.chat.chipToilet,  activeCls: "bg-green-700 text-white border-green-700", idleCls: "border-green-700/40 text-green-700 dark:text-green-400" },
            ]).map(({ type, icon, label, activeCls, idleCls }) => {
              const loading = amenityLocating === type
              return (
                <button
                  key={type}
                  role="radio"
                  onClick={() => selectAmenity(type)}
                  disabled={isLoading}
                  aria-checked={amenityActive === type}
                  aria-busy={loading}
                  className={cn(
                    "shrink-0 text-xs px-2.5 py-1.5 rounded-full font-medium border transition-colors whitespace-nowrap disabled:opacity-50",
                    amenityActive === type ? activeCls : cn("bg-card hover:bg-muted", idleCls),
                  )}
                >
                  {loading
                    ? <Loader2 className="inline w-3 h-3 mr-1 animate-spin" aria-hidden />
                    : `${icon} `
                  }
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {amenityLocateError && (
        <p role="alert" className="text-xs text-destructive -mt-1">{amenityLocateError}</p>
      )}

    </div>
    </>
  )
}
