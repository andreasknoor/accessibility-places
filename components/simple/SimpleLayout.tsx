"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import dynamic from "next/dynamic"
import { ChevronLeft, LocateFixed, Search as SearchIcon, Loader2, Settings as SettingsIcon } from "lucide-react"
import { useTranslations, useLocale } from "@/lib/i18n"
import { getBestPosition } from "@/lib/native/geolocation"
import { haversineMetres } from "@/lib/matching/match"
import { CATEGORY_ICONS } from "@/lib/category-icons"
import { SIMPLE_CATEGORIES } from "@/lib/settings"
import { hapticLight } from "@/lib/native/haptics"
import { track } from "@/lib/analytics"
import { amenitySpotKey } from "@/lib/search-ui"
import { SettingsPanel } from "@/components/settings/SettingsSheet"
import LanguageSwitcher from "@/components/LanguageSwitcher"
import SimplePlaceCard from "@/components/simple/SimplePlaceCard"
import SimpleDetail from "@/components/simple/SimpleDetail"
import AmenityCard from "@/components/results/AmenityCard"
import type { Place, Category, AmenityType, AmenityFeature, ParkingSpot } from "@/lib/types"
import type { AppSettings } from "@/lib/settings"

const MapView = dynamic(() => import("@/components/map/MapView"), { ssr: false })

type Screen = "start" | "tiles" | "locating" | "results" | "venue" | "detail"

// One suggestion from /api/geocode/unified-suggest — mirrors ChatPanel's own
// local definition (that route lives under app/api and isn't meant to be
// imported into client components even as a type-only import).
type UnifiedSuggestion = {
  kind:     "area" | "venue"
  display:  string
  name:     string
  lat:      number | null
  lon:      number | null
  osmKey:   string | null
  osmValue: string | null
}

interface Props {
  places:      Place[]
  isLoading:   boolean
  error?:      string
  searchCenter?: { lat: number; lon: number }
  gpsCoords?:  { lat: number; lon: number } | null
  selectedId?: string
  onSelect:    (place: Place) => void
  // Reports a freshly-resolved GPS fix back to HomeClient so it can update
  // its own gpsCoords state — the ONLY thing that feeds MapView's
  // `userLocation` prop (the blue dot). SimpleLayout's own selectCategory/
  // selectAmenity resolve coords locally via getBestPosition() for the
  // search itself, but without this callback HomeClient never learns about
  // that fix, so gpsCoords stays null/stale and the results map never shows
  // the user's own location (reported live).
  onGpsResolved: (coords: { lat: number; lon: number }) => void
  // Fires a nearby search with a fixed accessibility-first filter preset and a
  // 5 km radius, bypassing HomeClient's shared `filters`/`radiusKm` state
  // entirely (see the comment on AppSettings.simpleView in lib/settings.ts) —
  // so nothing here can ever clobber the user's real, persisted full-UI prefs.
  onSimpleNearbySearch: (query: string, coords: { lat: number; lon: number }) => void
  onPlaceSearch: (nameHint: string, coords?: { lat: number; lon: number }) => void
  // Parking/WC as a first-class search, exactly like the two amenity chips in
  // the full UI (docs: lib/amenities architecture) — reuses HomeClient's own
  // handleAmenitySearch, amenitySpots and the already-type-filtered
  // parkingSpots/toiletSpots arrays (visibleParkingSpots/visibleToiletSpots),
  // so no new search/filter logic is introduced here at all.
  onAmenitySearch: (type: AmenityType, coords: { lat: number; lon: number }) => void
  amenityResults?: AmenityFeature[]
  amenityHint?:    string
  parkingSpots?:   ParkingSpot[]
  toiletSpots?:    AmenityFeature[]
  // "Hier suchen" — MapView's own built-in pill (rendered whenever these two
  // are passed and `hideSearchHereButton` is left at its default `false`, so
  // no new UI needs building here). onSearchHere re-runs the current
  // category/all-places query at the panned map centre; onFocusSearchHere is
  // its amenity-mode equivalent ("search this area" for the active Parken/WC
  // search) and is already filter-agnostic in HomeClient, so it's passed
  // straight through with no Simple-View-specific wrapper needed.
  onSearchHere: (coords: { lat: number; lon: number }, viewportRadiusKm: number) => void
  onFocusSearchHere: (coords: { lat: number; lon: number }, viewportRadiusKm: number) => void
  // "Suchradius vergrößern" on the empty-state message — mirrors the full
  // UI's own expand-radius buttons (ResultsList). onExpandRadius doubles
  // Simple View's own tracked radius and re-runs the last category/all-
  // places query; onAmenityExpandRadius is HomeClient's existing
  // handleAmenityExpandRadius, already filter-agnostic, passed straight
  // through with no wrapper (same pattern as onFocusSearchHere above).
  onExpandRadius: () => void
  onAmenityExpandRadius: () => void
  settings:        AppSettings
  onUpdateSettings: (patch: Partial<AppSettings>) => void
}

// Module-level (not defined inside SimpleLayout's body) so its identity is
// stable across renders — a component re-created on every render remounts
// its subtree each time, which would drop focus from the venue search input
// on every keystroke.
//
// `onOpenSettings` is a quiet gear icon reachable from every screen that uses
// this Header — the return path to the full UI (the settings toggle) must be
// reachable from wherever the user currently is, not just from the start
// screen a few back-taps away. LanguageSwitcher sits next to it for the same
// reason — Simple View had no DE/EN control at all before, forcing a detour
// through the full UI just to change language.
function Header({ title, backLabel, settingsLabel, onBack, onOpenSettings }: { title?: string; backLabel: string; settingsLabel: string; onBack?: () => void; onOpenSettings: () => void }) {
  return (
    // pt-safe-3, not pt-3: this row sits flush at the very top of the h-svh
    // root (no browser chrome/native title bar above it, unlike MobileLayout's
    // header which happens to have the same need — see its own pt-safe-3).
    // Without the safe-area padding, the back/settings buttons render under
    // the iPhone notch/status bar and become untappable (reported live on a
    // real device: the top row was visible but its buttons didn't respond).
    <div className="flex items-center gap-2 px-3 pt-safe-3 pb-1 shrink-0 min-h-9">
      {onBack ? (
        <button onClick={onBack} className="flex items-center gap-1 text-sm font-medium text-primary py-1.5 pr-2 -ml-1">
          <ChevronLeft className="w-4 h-4" />
          {backLabel}
        </button>
      ) : <span className="w-4" />}
      {title && <p className="flex-1 text-center text-sm font-semibold px-1 truncate">{title}</p>}
      {!title && <span className="flex-1" />}
      <LanguageSwitcher />
      <button
        onClick={onOpenSettings}
        aria-label={settingsLabel}
        className="p-1.5 -mr-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-md"
      >
        <SettingsIcon className="w-4 h-4" />
      </button>
    </div>
  )
}

export default function SimpleLayout({
  places, isLoading, error, searchCenter, gpsCoords, selectedId, onSelect,
  onSimpleNearbySearch, onPlaceSearch, onAmenitySearch, amenityResults, amenityHint,
  parkingSpots, toiletSpots, onSearchHere, onFocusSearchHere, onGpsResolved,
  onExpandRadius, onAmenityExpandRadius, settings, onUpdateSettings,
}: Props) {
  const t = useTranslations()
  const { locale } = useLocale()

  const [screen, setScreen] = useState<Screen>("start")
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  // Mutually exclusive with selectedCategory — set by selectAmenity, cleared by
  // selectCategory — mirrors how HomeClient's own places/amenitySpots state is
  // mutually exclusive (handleSearch clears amenitySearch, handleAmenitySearch
  // clears places). Kept as separate local state (rather than derived from the
  // amenityResults prop) so the results screen's title/list branch is correct
  // even the instant a search starts, before any prop has actually arrived.
  const [selectedAmenityType, setSelectedAmenityType] = useState<AmenityType | null>(null)
  const [selectedAmenityKey, setSelectedAmenityKey] = useState<string | undefined>(undefined)
  const [amenityPanTarget, setAmenityPanTarget] = useState<{ lat: number; lon: number } | null>(null)
  const [amenityPanTrigger, setAmenityPanTrigger] = useState(0)
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null)
  const [locateError, setLocateError] = useState<string | null>(null)

  // Map/list split (results screen) — a freely drag-resizable divider, like
  // Google Maps' bottom sheet, rather than a binary strip/fullscreen toggle.
  // Height is tracked in px (not a %) because drag deltas are naturally px;
  // null until the container's first real measurement is available, at
  // which point it's seeded to 40% map / 60% list.
  const resultsSplitRef = useRef<HTMLDivElement>(null)
  const [mapHeightPx, setMapHeightPx] = useState<number | null>(null)
  // Mirrors the split container's own clientHeight, but as state rather than
  // a ref read during render — reading a ref's `.current` while rendering is
  // an anti-pattern (it isn't guaranteed to reflect the latest committed DOM
  // under all rendering modes) and is what the aria-valuenow percentage below
  // needs. Set alongside mapHeightPx at both seed and drag-start time.
  const [containerHeightPx, setContainerHeightPx] = useState<number | null>(null)
  const splitDragRef = useRef<{ startY: number; startHeight: number; containerHeight: number } | null>(null)

  // Map ↔ list cross-highlighting on the results screen's hybrid split:
  //  - tapping a marker already opens its Leaflet popup natively; onSelect
  //    (below) additionally scrolls the matching SimplePlaceCard into view
  //    and highlights it (via the shared selectedId → isSelected prop).
  //  - tapping a card's own map-pin button (SimplePlaceCard's onShowOnMap)
  //    selects the same place, which MapView already turns into "pan/zoom to
  //    marker + enlarge it + open its popup" — mapPanTrigger forces that pan
  //    to re-fire even when the tapped card is already the selected one
  //    (mirrors MobileLayout's identical panTrigger bump on list select).
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [mapPanTrigger, setMapPanTrigger] = useState(0)
  function selectAndScrollToCard(place: Place) {
    onSelect(place)
    // behavior: "auto", not "smooth" — verified live in a real browser that a
    // smooth scroll queued from a marker's click handler gets silently
    // interrupted (never completes) here, most likely by the layout changes
    // the SAME click also triggers (Leaflet's popup opening/autopan on the
    // map above). "auto" (an instant jump) is unaffected and reliable.
    // block: "start", not "nearest" — the user explicitly asked for the
    // selected card to land flush under the map (reading as "the first
    // result"), not merely "somewhere visible" (which "nearest" only
    // guarantees — a card already partly on screen wouldn't move at all).
    // Optional-called, not just optional-chained on the element: scrollIntoView
    // isn't implemented in jsdom (and, defensively, may be absent on very old
    // browsers) — skip silently rather than throwing either way.
    itemRefs.current.get(place.id)?.scrollIntoView?.({ behavior: "auto", block: "start" })
  }
  function selectAndPanMap(place: Place) {
    onSelect(place)
    setMapPanTrigger((n) => n + 1)
  }

  // Neither pane may fully vanish — that would strand the user with no
  // visible handle to drag it back with — but within that guard "beliebig
  // klein und groß" (arbitrarily small/large) is honoured for the rest of
  // the range.
  const SPLIT_PANE_MIN_PX = 90

  function clampSplitHeight(px: number, containerHeight: number): number {
    const max = Math.max(SPLIT_PANE_MIN_PX, containerHeight - SPLIT_PANE_MIN_PX)
    return Math.min(Math.max(px, SPLIT_PANE_MIN_PX), max)
  }

  function beginSplitDrag(clientY: number) {
    const el = resultsSplitRef.current
    if (!el || mapHeightPx == null) return
    setContainerHeightPx(el.clientHeight)
    splitDragRef.current = { startY: clientY, startHeight: mapHeightPx, containerHeight: el.clientHeight }
  }
  function updateSplitDrag(clientY: number) {
    const d = splitDragRef.current
    if (!d) return
    setMapHeightPx(clampSplitHeight(d.startHeight + (clientY - d.startY), d.containerHeight))
  }
  function endSplitDrag() {
    splitDragRef.current = null
  }

  // Seed the default 40/60 split once the results screen's split container
  // can actually be measured (it renders with height 0 the instant "results"
  // becomes the active screen, before layout settles). useLayoutEffect, not
  // useEffect: this is a layout measurement (same reasoning as useIsMobile's
  // own useLayoutEffect) — a passive effect is scheduled asynchronously and
  // can be deferred under scheduler pressure, which showed up as a genuine,
  // reproducible race in tests (mapHeightPx still null when the very next
  // interaction fired). useLayoutEffect runs synchronously in the same
  // commit, before paint, eliminating that race rather than just masking it.
  useLayoutEffect(() => {
    if (screen !== "results" || mapHeightPx != null) return
    const el = resultsSplitRef.current
    if (!el) return
    const h = el.clientHeight
    if (h > 0) {
      setMapHeightPx(clampSplitHeight(h * 0.4, h))
      setContainerHeightPx(h)
    }
  }, [screen, mapHeightPx])

  const [hasSearchedNearby, setHasSearchedNearby] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Venue-search sub-flow
  const [venueQuery,       setVenueQuery]       = useState("")
  const [venueSuggestions, setVenueSuggestions] = useState<UnifiedSuggestion[]>([])
  const [venuePending,     setVenuePending]      = useState(false)
  const [venueNotFound,    setVenueNotFound]      = useState(false)
  // State, not a ref: read during render (the venue-detail distance suppression
  // below) as well as in the onBack handler — a ref's `.current` must never be
  // read during render (its value isn't guaranteed stable across render
  // attempts under all rendering modes).
  const [detailReturnTo, setDetailReturnTo] = useState<"results" | "venue">("results")
  const venueDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const venueAbortRef    = useRef<AbortController | undefined>(undefined)
  // getBestPosition has no AbortSignal support, so a user who backs out of the
  // "locating" screen while it's still pending (GPS/permission dialog can take
  // up to ~20s) can't actually cancel the in-flight request — only suppress
  // its effect once it eventually settles. Without this flag, a request that
  // resolves after the user has already navigated elsewhere would still fire
  // onSimpleNearbySearch and force-navigate to "results", overriding whatever
  // screen the user is actually on.
  const locateCancelledRef = useRef(false)

  const categoryLabel = (cat: Category | null): string =>
    cat ? (t.chipLabels[cat] ?? t.categories[cat]) : (locale === "de" ? "Orte" : "places")

  async function selectCategory(cat: Category | null) {
    hapticLight()
    setSelectedCategory(cat)
    setSelectedAmenityType(null)
    setLocateError(null)
    locateCancelledRef.current = false
    setScreen("locating")
    try {
      const coords = await getBestPosition({ timeout: 20_000, windowMs: 4_000, desiredAccuracyM: 50 })
      if (locateCancelledRef.current) return
      track("simple_nearby_search", { category: cat ?? "all" })
      setHasSearchedNearby(true)
      onGpsResolved(coords)
      onSimpleNearbySearch(categoryLabel(cat), coords)
      setScreen("results")
    } catch {
      if (locateCancelledRef.current) return
      setLocateError(t.simple.locateError)
      setScreen("tiles")
    }
  }

  const amenityLabel = (type: AmenityType): string => type === "parking" ? t.chat.chipParking : t.chat.chipToilet

  async function selectAmenity(type: AmenityType) {
    hapticLight()
    setSelectedCategory(null)
    setSelectedAmenityType(type)
    setLocateError(null)
    locateCancelledRef.current = false
    setScreen("locating")
    try {
      const coords = await getBestPosition({ timeout: 20_000, windowMs: 4_000, desiredAccuracyM: 50 })
      if (locateCancelledRef.current) return
      track("simple_amenity_search", { type })
      setHasSearchedNearby(true)
      onGpsResolved(coords)
      onAmenitySearch(type, coords)
      setScreen("results")
    } catch {
      if (locateCancelledRef.current) return
      setLocateError(t.simple.locateError)
      setScreen("tiles")
    }
  }

  function cancelLocating() {
    locateCancelledRef.current = true
    setScreen("tiles")
  }

  // Marker → list (amenity mirror of selectAndScrollToCard): a parking/WC
  // marker click has no stable Place id, so it's keyed via amenitySpotKey
  // (osmId, falling back to lat/lon) — same key scheme ResultsList/MapView
  // already use for the full UI's amenity chips.
  function handleAmenityMarkerClick(spot: { osmId?: string; lat: number; lon: number }) {
    const key = amenitySpotKey(spot)
    setSelectedAmenityKey(key)
    // block: "start" — see selectAndScrollToCard's comment; same "reads as the
    // first result" requirement applies to amenity cards.
    itemRefs.current.get(key)?.scrollIntoView?.({ behavior: "auto", block: "start" })
  }
  // List → marker (amenity mirror of selectAndPanMap).
  function selectAndPanAmenity(spot: AmenityFeature) {
    setSelectedAmenityKey(amenitySpotKey(spot))
    setAmenityPanTarget({ lat: spot.lat, lon: spot.lon })
    setAmenityPanTrigger((n) => n + 1)
  }

  function openDetail(place: Place, returnTo: "results" | "venue") {
    setSelectedPlace(place)
    onSelect(place)
    setDetailReturnTo(returnTo)
    setScreen("detail")
  }

  // Venue autocomplete — mirrors ChatPanel's own unified-suggest debounce
  // (300 ms, abort-on-supersede), filtered to venue-kind results only.
  useEffect(() => {
    const query = venueQuery.trim()
    if (query.length < 2) { setVenueSuggestions([]); return }
    clearTimeout(venueDebounceRef.current)
    venueAbortRef.current?.abort()
    venueDebounceRef.current = setTimeout(async () => {
      const ac = new AbortController()
      venueAbortRef.current = ac
      try {
        const bias = searchCenter ? `&lat=${searchCenter.lat}&lon=${searchCenter.lon}` : gpsCoords ? `&lat=${gpsCoords.lat}&lon=${gpsCoords.lon}` : ""
        const intl = settings.internationalMode ? "&intl=1" : ""
        const res = await fetch(`/api/geocode/unified-suggest?q=${encodeURIComponent(query)}&lang=${locale}${bias}${intl}`, { signal: ac.signal })
        if (!res.ok) return
        const data: UnifiedSuggestion[] = await res.json()
        setVenueSuggestions(data.filter((s) => s.kind === "venue"))
      } catch { /* ignore — AbortError or network error */ }
    }, 300)
    return () => { clearTimeout(venueDebounceRef.current); venueAbortRef.current?.abort() }
  }, [venueQuery, locale, searchCenter, gpsCoords, settings.internationalMode])

  function pickVenue(s: UnifiedSuggestion) {
    hapticLight()
    setVenueNotFound(false)
    setVenuePending(true)
    track("simple_venue_search")
    const coords = s.lat != null && s.lon != null ? { lat: s.lat, lon: s.lon } : undefined
    onPlaceSearch(s.name, coords)
  }

  // Once a venue search settles, jump straight to its detail screen (the
  // whole point of "check a place" is a single answer, not a results list).
  // Two guards, both defending against a user who navigates away while the
  // request is still in flight:
  //  - `screen !== "venue"` — the only path that sets venuePending=true is
  //    from the venue screen; if the user has since gone back to "start" (or
  //    anywhere else), this search is stale and must not force-navigate them
  //    into a detail screen for a lookup they may have abandoned.
  //  - `error` (not just `places.length`) — handlePlaceSearch has two
  //    early-return failure paths (geocode 404 / network error) that set
  //    `error` + isLoading(false) WITHOUT ever calling handleSearch, so
  //    `places` is never cleared and could still hold the PREVIOUS venue's
  //    results. Relying on places.length alone would silently reopen the old
  //    venue's detail instead of reporting "not found" for the new one.
  useEffect(() => {
    if (!venuePending || isLoading) return
    setVenuePending(false)
    if (screen !== "venue") return
    if (!error && places.length > 0) {
      openDetail(places[0], "venue")
    } else {
      setVenueNotFound(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venuePending, isLoading, places, error, screen])

  const distanceFor = (place: Place): number | undefined =>
    searchCenter ? haversineMetres(searchCenter, place.coordinates) : undefined

  // Memoized — NOT just a plain re-sort on every render. MapView's own
  // marker-building effect depends on this array by reference ([places,
  // mapReady, focusMode]); an unmemoized [...places].sort(...) creates a new
  // array on every render, including ones that only change `selectedId`
  // (e.g. clicking a marker). That made MapView see "places changed", tear
  // down and rebuild every marker/cluster from scratch right after a click —
  // destroying the just-opened popup and re-clustering at the current zoom
  // (reported live: click a cluster to expand it, click a now-visible place,
  // its popup opens and immediately collapses back into the cluster).
  // MobileLayout never hit this because it passes HomeClient's `places`
  // state directly, with no re-sort in between.
  const sortedPlaces = useMemo(() => (
    searchCenter
      ? [...places].sort((a, b) => haversineMetres(searchCenter, a.coordinates) - haversineMetres(searchCenter, b.coordinates))
      : places
  ), [places, searchCenter])

  // Amenity results, always distance-sorted (mirrors ResultsList's own
  // displayedAmenities memo) — the only meaningful order for "nearest
  // parking/WC". Same by-reference memoization reasoning as sortedPlaces.
  const sortedAmenities = useMemo(() => {
    const list = amenityResults ?? []
    if (!searchCenter) return list
    return [...list].sort((a, b) => haversineMetres(searchCenter, a) - haversineMetres(searchCenter, b))
  }, [amenityResults, searchCenter])

  return (
    <div className="flex flex-col h-svh overflow-hidden bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:px-4 focus-visible:py-2 focus-visible:rounded-md focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:shadow-lg"
      >
        {t.common.skipToContent}
      </a>

      <main id="main-content" className="flex-1 min-h-0 flex flex-col">

        {/* ── Start: the two core jobs ── */}
        {screen === "start" && (
          // pt-safe-3, not the top half of py-3 — this screen has no shared
          // <Header>, so its own top row (the language switcher) needs the
          // same safe-area treatment directly; see Header's own comment.
          <div className="flex-1 flex flex-col px-5 pt-safe-3 pb-3">
            <div className="flex justify-end">
              <LanguageSwitcher />
            </div>
            <div className="flex-1 flex flex-col justify-center gap-3">
            <div className="flex items-center gap-2.5 justify-center mb-4">
              <img src="/icons/icon-preview.svg" className="w-8 h-8 rounded-lg" alt="" aria-hidden />
              <span className="font-bold text-base">{t.app.title}</span>
            </div>
            <p className="text-center font-semibold text-lg mb-2">{t.simple.startTitle}</p>

            <button
              onClick={() => { setLocateError(null); setScreen("tiles") }}
              className="flex items-center gap-3 rounded-xl bg-primary text-primary-foreground px-4 py-4 shadow-sm hover:bg-primary/90 transition-colors text-left"
            >
              <span className="w-11 h-11 rounded-full bg-primary-foreground/15 flex items-center justify-center shrink-0">
                <LocateFixed className="w-5 h-5" aria-hidden />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold">{t.simple.startNearby}</span>
                <span className="block text-xs opacity-90 mt-0.5">{t.simple.startNearbyHint}</span>
              </span>
            </button>

            <button
              onClick={() => { setVenueNotFound(false); setVenueQuery(""); setScreen("venue") }}
              className="flex items-center gap-3 rounded-xl border border-card-border bg-card px-4 py-4 hover:bg-muted transition-colors text-left"
            >
              <span className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <SearchIcon className="w-5 h-5 text-primary" aria-hidden />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold">{t.simple.startVenue}</span>
                <span className="block text-xs text-muted-foreground mt-0.5">{t.simple.startVenueHint}</span>
              </span>
            </button>

            <button
              onClick={() => setSettingsOpen(true)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2 mt-3 mx-auto"
            >
              {t.simple.showFullApp}
            </button>
            </div>
          </div>
        )}

        {/* ── Category tiles ── */}
        {screen === "tiles" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <Header title={t.simple.tilesTitle} backLabel={t.simple.back} settingsLabel={t.settings.title} onBack={() => setScreen("start")} onOpenSettings={() => setSettingsOpen(true)} />
            {locateError && (
              <p role="alert" className="mx-4 mt-1 mb-0 text-xs text-destructive">{locateError}</p>
            )}
            <div className="grid grid-cols-2 gap-2.5 p-4 overflow-y-auto">
              {SIMPLE_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => selectCategory(cat)}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-card-border bg-card py-5 hover:bg-muted transition-colors"
                >
                  <span className="text-2xl" aria-hidden>{CATEGORY_ICONS[cat] ?? "📍"}</span>
                  <span className="text-xs font-semibold">{t.chipLabels[cat] ?? t.categories[cat]}</span>
                </button>
              ))}
              {/* Parking/WC — the same two amenity chips as the full UI, as a
                  first-class "what to search for" choice rather than a hidden
                  focus mode (mirrors issue #30's reasoning for the full UI). */}
              <button
                onClick={() => selectAmenity("parking")}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-card-border bg-card py-5 hover:bg-muted transition-colors"
              >
                <span className="text-2xl" aria-hidden>🅿</span>
                <span className="text-xs font-semibold">{t.chat.chipParking}</span>
              </button>
              <button
                onClick={() => selectAmenity("toilet")}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-card-border bg-card py-5 hover:bg-muted transition-colors"
              >
                <span className="text-2xl" aria-hidden>🚻</span>
                <span className="text-xs font-semibold">{t.chat.chipToilet}</span>
              </button>
              <button
                onClick={() => selectCategory(null)}
                className="col-span-2 rounded-xl border border-dashed border-card-border py-3.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                {t.simple.tileAll}
              </button>
            </div>
          </div>
        )}

        {/* ── Locating ── */}
        {screen === "locating" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
            <Loader2 className="w-6 h-6 animate-spin text-primary" aria-hidden />
            <p className="text-sm text-muted-foreground">{t.simple.locating}</p>
            <button
              onClick={cancelLocating}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2 mt-2"
            >
              {t.simple.back}
            </button>
          </div>
        )}

        {/* ── Results (map strip + single scroll) ── */}
        {screen === "results" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <Header title={t.simple.resultsTitle(selectedAmenityType ? amenityLabel(selectedAmenityType) : categoryLabel(selectedCategory))} backLabel={t.simple.back} settingsLabel={t.settings.title} onBack={() => setScreen("tiles")} onOpenSettings={() => setSettingsOpen(true)} />
            {error && <p role="alert" className="mx-4 mb-1 text-xs text-destructive">{error}</p>}

            {/* Search-in-progress indicator, directly above the map — same
                indeterminate sliding bar as the full UI's ChatPanel (reuses
                its .animate-loading-bar keyframes from globals.css) so a
                running search reads identically across both UIs. */}
            {isLoading && (
              <div className="h-0.5 mx-3 mt-1 overflow-hidden rounded-full bg-primary/15 shrink-0" role="status" aria-label={t.chat.thinking}>
                <div className="h-full w-1/4 rounded-full bg-primary animate-loading-bar" />
              </div>
            )}

            {/* Map and list share the remaining space in a freely resizable
                split (like Google Maps' bottom sheet) — drag the handle to
                make either pane arbitrarily small or large. Defaults to
                40% map / 60% list on first measurement. */}
            <div ref={resultsSplitRef} data-testid="results-split" className="flex-1 min-h-0 flex flex-col">
              <div
                className="shrink-0 relative overflow-hidden border border-border mx-3 mt-1 rounded-xl"
                style={{ height: mapHeightPx ?? 96 }}
              >
                <MapView
                  places={sortedPlaces}
                  // Always passed through — HomeClient's simpleParkingSpots/
                  // simpleToiletSpots are already `undefined` outside Simple
                  // View's OWN active parking/WC search (never the full UI's
                  // independent "always show this layer" preference, which
                  // Simple View has no Ebenen-pill control to turn back off —
                  // see the comment there). No local filtering needed here.
                  parkingSpots={parkingSpots}
                  toiletSpots={toiletSpots}
                  amenityType={selectedAmenityType}
                  // Drives which of MapView's two "search here" pills can show
                  // (venue vs. the amenity "search this area") — see onSearchHere/
                  // onFocusSearchHere below.
                  focusMode={selectedAmenityType != null}
                  amenityPanTarget={amenityPanTarget}
                  amenityPanTrigger={amenityPanTrigger}
                  onAmenityMarkerClick={handleAmenityMarkerClick}
                  // "Hier suchen" — MapView renders its own centred pill for
                  // whichever of these two is active (never both at once,
                  // gated by focusMode above); no `hideSearchHereButton` is
                  // passed, so we get MapView's default floating-pill UI for
                  // free, same as the desktop full-UI map.
                  onSearchHere={onSearchHere}
                  onFocusSearchHere={onFocusSearchHere}
                  center={searchCenter ?? gpsCoords ?? undefined}
                  userLocation={gpsCoords ?? undefined}
                  selectedId={selectedId}
                  panTrigger={mapPanTrigger}
                  onSelect={selectAndScrollToCard}
                  onShowInResults={(p) => openDetail(p, "results")}
                  // Without this, the popup's own "Details" chip ignores
                  // onShowInResults entirely and always opens the full,
                  // rich PlaceDebugSheet — see MapView's onOpenDetails prop.
                  onOpenDetails={(p) => openDetail(p, "results")}
                  isFullscreen={false}
                  onToggleFullscreen={() => {}}
                  showFullscreenToggle={false}
                  visible={screen === "results"}
                  isLoading={isLoading}
                />
              </div>

              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label={t.simple.resizeHandle}
                aria-valuenow={mapHeightPx != null && containerHeightPx ? Math.round((mapHeightPx / containerHeightPx) * 100) : undefined}
                aria-valuemin={0}
                aria-valuemax={100}
                tabIndex={0}
                className="shrink-0 flex items-center justify-center h-6 cursor-row-resize touch-none select-none focus-visible:outline-none"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture?.(e.pointerId)
                  beginSplitDrag(e.clientY)
                }}
                onPointerMove={(e) => updateSplitDrag(e.clientY)}
                onPointerUp={endSplitDrag}
                onPointerCancel={endSplitDrag}
                onKeyDown={(e) => {
                  const el = resultsSplitRef.current
                  if (!el || mapHeightPx == null) return
                  const step = 32
                  if (e.key === "ArrowUp")   { e.preventDefault(); setMapHeightPx(clampSplitHeight(mapHeightPx - step, el.clientHeight)) }
                  if (e.key === "ArrowDown") { e.preventDefault(); setMapHeightPx(clampSplitHeight(mapHeightPx + step, el.clientHeight)) }
                }}
              >
                <span className="w-10 h-1.5 rounded-full bg-border" aria-hidden />
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-4 pt-1 flex flex-col gap-2.5">
                {isLoading && (
                  <div className="flex-1 flex items-center justify-center py-10">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-hidden />
                  </div>
                )}
                {!isLoading && !error && selectedAmenityType == null && places.length === 0 && hasSearchedNearby && (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 py-10 text-center px-4">
                    <div className="flex flex-col items-center gap-1.5">
                      <p className="text-sm font-medium">{t.simple.noResultsTitle}</p>
                      <p className="text-xs text-muted-foreground">{t.simple.noResultsHint}</p>
                    </div>
                    <button
                      onClick={onExpandRadius}
                      className="px-3 py-1.5 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted transition-colors"
                    >
                      {t.results.expandRadius}
                    </button>
                  </div>
                )}
                {!isLoading && selectedAmenityType == null && places.length > 0 && (
                  <>
                    <p className="text-xs text-muted-foreground px-0.5">{t.simple.resultsCount(places.length)}</p>
                    {sortedPlaces.map((p) => (
                      <div key={p.id} ref={(el) => { if (el) itemRefs.current.set(p.id, el); else itemRefs.current.delete(p.id) }}>
                        <SimplePlaceCard
                          place={p}
                          distanceM={distanceFor(p)}
                          isSelected={p.id === selectedId}
                          onOpen={() => openDetail(p, "results")}
                          onShowOnMap={() => selectAndPanMap(p)}
                        />
                      </div>
                    ))}
                  </>
                )}
                {!isLoading && selectedAmenityType != null && sortedAmenities.length === 0 && hasSearchedNearby && (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 py-10 text-center px-4">
                    <div className="flex flex-col items-center gap-1.5">
                      <p className="text-sm font-medium">{t.simple.noResultsTitle}</p>
                      <p className="text-xs text-muted-foreground">{amenityHint ?? t.simple.noResultsHint}</p>
                    </div>
                    <button
                      onClick={onAmenityExpandRadius}
                      className="px-3 py-1.5 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted transition-colors"
                    >
                      {t.results.expandRadius}
                    </button>
                  </div>
                )}
                {!isLoading && selectedAmenityType != null && sortedAmenities.length > 0 && (
                  <>
                    <p className="text-xs text-muted-foreground px-0.5">{t.results.amenityCount(sortedAmenities.length)}</p>
                    {sortedAmenities.map((spot) => {
                      const key = amenitySpotKey(spot)
                      return (
                        <div key={key} ref={(el) => { if (el) itemRefs.current.set(key, el); else itemRefs.current.delete(key) }}>
                          <AmenityCard
                            spot={spot}
                            amenityType={selectedAmenityType}
                            isSelected={key === selectedAmenityKey}
                            distanceM={searchCenter ? haversineMetres(searchCenter, spot) : undefined}
                            onClick={() => selectAndPanAmenity(spot)}
                          />
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Venue search ── */}
        {screen === "venue" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <Header backLabel={t.simple.back} settingsLabel={t.settings.title} onBack={() => setScreen("start")} onOpenSettings={() => setSettingsOpen(true)} />
            <div className="px-4 pb-2">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2.5">
                <SearchIcon className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
                <input
                  autoFocus
                  value={venueQuery}
                  onChange={(e) => { setVenueQuery(e.target.value); setVenueNotFound(false) }}
                  placeholder={t.simple.venuePlaceholder}
                  aria-label={t.simple.venuePlaceholder}
                  // text-base (16px) on mobile, not text-sm — same fix as
                  // ChatPanel's own search input (see its comment): iOS Safari/
                  // WKWebView auto-zooms the viewport on focus for any input
                  // under 16px and does not reliably reset the scale
                  // afterwards. With `autoFocus` here, that zoom fires the
                  // instant this screen mounts — reported live on a real
                  // iPhone as "everything ~10% too wide, back button missing
                  // its first letter", persisting even after navigating back.
                  className="flex-1 min-w-0 bg-transparent text-base md:text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-2">
              {venuePending && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-hidden />
                </div>
              )}
              {!venuePending && venueNotFound && (
                <p className="text-sm text-muted-foreground text-center py-6">{t.simple.venueNoMatches}</p>
              )}
              {!venuePending && !venueNotFound && venueQuery.trim().length < 2 && (
                <p className="text-sm text-muted-foreground text-center py-6">{t.simple.venueHint}</p>
              )}
              {!venuePending && venueSuggestions.map((s, i) => (
                <button
                  key={`${s.name}-${i}`}
                  onClick={() => pickVenue(s)}
                  className="flex items-center gap-2.5 rounded-lg border border-card-border bg-card px-3 py-2.5 text-left hover:bg-muted transition-colors"
                >
                  <span className="text-base shrink-0" aria-hidden>📍</span>
                  <span className="text-sm font-medium truncate">{s.display}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Detail ── */}
        {screen === "detail" && selectedPlace && (
          <SimpleDetail
            place={selectedPlace}
            // A venue-search lookup centres `searchCenter` on the found place
            // itself (mirrors the full app's own place-search behaviour) — a
            // "0 m entfernt" distance to itself is meaningless, so only show
            // distance when this detail came from the nearby-search results.
            distanceM={detailReturnTo === "venue" ? undefined : distanceFor(selectedPlace)}
            onBack={() => setScreen(detailReturnTo)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}

      </main>

      {settingsOpen && createPortal(
        <SettingsPanel settings={settings} onUpdate={onUpdateSettings} onClose={() => setSettingsOpen(false)} simple />,
        document.body,
      )}
    </div>
  )
}
