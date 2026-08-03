import type { Category } from "../types"

export interface Translations {
  app: {
    title:     string
    subtitle:  string
    srHeading: string
  }
  metadata: {
    title:               string
    titleTemplate:       string
    description:         string
    manifestDescription: string
  }
  common: {
    close:       string
    loading:     string
    dismissHint: string
    copied:      string
    skipToContent: string
  }
  chat: {
    // Accessible name for the unified search field (aria-label) — distinct from
    // the placeholder, which disappears on input and isn't a valid WCAG label.
    searchFieldLabel: string
    unifiedPlaceholder: string
    suggestGroupAreas:  string
    suggestGroupVenues: string
    // Always-present first dropdown row (no-submit-button redesign): runs the
    // exact input as typed, same as pressing Enter. `q` is the raw field value.
    suggestSearchFor:   (q: string) => string
    chipAll:            string
    // Drill-in category chips (Konzept A): a group chip opens its subcategories
    // in place of the row; "←" returns to the group list.
    chipBack:            string
    // Amenity search chips (single-select, at the front of the chip strip).
    chipParking:        string
    chipToilet:         string
    chipsGroupLabel:    string
    // Amenity quick-find row (B2 layout): label + the inline location affordance.
    amenityRowLabel:    string
    clearLocation:      string
    clearInput:         string
    locationActive:     (district: string) => string
    // Variant-B search row: inline "Nearby" action inside the field + the
    // short placeholder shown while the green location token occupies the field.
    nearbyAction:       string
    // Freestanding circular button next to the search field (v10.1) — one tap
    // locates and immediately runs a nearby search using the active chip.
    nearbySearchButton: string
    nearbyTokenPlaceholder: string
    thinking:      string
    noResults:        string
    noSearchYetTitle:      string
    noSearchYet:           string
    errorGeneric:  string
    errorTimeout:  string
    errorLocationNotFound:      string
    errorGeocodingUnavailable:  string
    modeText:      string
    modeNearby:    string
    modeTextSub:   string
    modeNearbySub: string
    locateButton:  string
    locationError: string
    parkingModeToggle:    string
    parkingNoneFound:     string
    toiletModeToggle:     string
    toiletsNoneFound:     string
    focusLabel:           string
    focusChipParking:     string
    focusChipToilet:      string
    focusExit:            string
    placeNotFound:     string
    placeNoData:       (name: string) => string
    placeLinkNotFound: (name: string) => string
    welcomeTitle:       string
    welcomeSubtitle:    string
    welcomeNearbyCard:     string
    welcomeNearbyCardHint: string
    welcomeOrDivider:   string
    welcomeTextCard:     string
    welcomeTextCardHint: string
    welcomeDismiss:      string
    welcomeViewLabel:    string
    welcomeViewList:     string
    welcomeViewMap:      string
  }
  filters: {
    title:               string
    sources:             string
    criteria:            string
    radius:              string
    radiusLabel:         (km: number) => string
    radiusSliderLabel:   string
    acceptUnknown:       string
    sourceCountTooltip:  (raw: number, final: number) => string
    criteriaItems: {
      entrance:      string
      toilet:        string
      parking:       string
      parkingNearby: string
      seating:       string
      onlyVerified:  string
    }
  }
  results: {
    title:              string
    titleRadius:        (radiusLabel: string) => string
    radiusPickerLabel:  (radiusLabel: string) => string
    count:              (n: number) => string
    resultsAnnounce:    (n: number) => string
    parkingCount:       (n: number) => string
    showMap:     string
    tier: {
      sehr_hoch: string
      gut:       string
      gering:    string
      keine:     string
    }
    reliabilityNote: (tier: "sehr_hoch" | "gut" | "gering" | "keine", verifiedLabel?: string) => string
    joinCriteria:    (labels: string[]) => string
    // Split into pre/criteria/post (rather than one string) so the caller
    // (JudgmentLine) can render "criteria" as a separate, optionally
    // clickable span — the link that jumps to the filter view. `n` is the
    // count of currently active filter criteria ("deine 2 Kriterien").
    judgmentPass:            (n: number) => { pre: string; criteria: string; post: string }
    judgmentPassAllNote:     string
    judgmentPassLimitedNote: (criteria: string) => string
    judgmentUnverified:      string
    judgmentUnverifiedNote:  (criteria: string) => string
    judgmentFail:            (n: number) => { pre: string; criteria: string; post: string }
    judgmentFailNote:        (criteria: string) => string
    judgmentNone:            string
    // Accessible name for the "Kriterien" link inside the judgement headline
    // — opens an inline popover naming the active criteria (2026-08-03: no
    // longer jumps straight to the filter view, since that silently failed
    // on mobile, where the Info-Sheet is a full-screen overlay and the tab
    // switch happened invisibly behind it). Separate from the visible text
    // since the link is just a few words inside a longer sentence.
    judgmentShowCriteria:    string
    // Popover heading + the secondary button that performs the actual
    // navigation to the filter view (a deliberate, separate click from the
    // headline link above).
    judgmentActiveCriteria:  string
    judgmentEditFilters:     string
    seoJudgmentFixed:  string
    rerun:             string
    retry:             string
    expandRadius:      string
    amenityAllFiltered: string
    expandRadiusYes:   string
    conflict:          string
    primarySource:     string
    noData:            string
    websiteLink:       string
    phoneLink:         string
    wheelmapLink:      string
    gintoLink:         string
    acceslibreLink:    string
    googleMapsLink:    string
    navigateHere:       string
    navigateWith:       string
    navigateGoogleMaps: string
    navigateOtherApp:   string
    verifiedRecently:  string
    verifiedAt:        (date: string, sources: string[]) => string
    verifiedAge:       (date: string) => string
    allowsDogs:        string
    noDogs:            string
    vegetarian:        string
    vegan:             string
    showOnMap:         string
    mapHint:           string
    placeSearchBanner: (name: string) => string
    // Reliability table (Info-Sheet "Barrierefreiheit" section, 2026-08-03
    // redesign) — Kriterium | Wert | Gefiltert | Verlässl. | Quelle.
    scoreCriterionCol:    string
    tableValueCol:        string
    tableFilteredCol:     string
    tableReliabilityCol:  string
    tableSourceCol:       string
    // aria-labels for the "Gefiltert" column's checkmark/dot (no visible
    // text in the cell itself, so the accessible name must state the yes/no
    // both ways rather than only labelling the positive case).
    tableFilteredYes:     string
    tableFilteredNo:      string
    showRawData:          string
    detailsExpand:        string
    detailsCollapse:      string
    noResultsArea:        string
    networkError:         string
    sourceRateLimited:    string
    intlNotice:           string
    noResultsFiltered:    (n: number) => string
    filterBlockedBy:      string
    sortByConfidence:     string
    sortByDistance:       string
    adjustFilters:        string
    adjustFiltersHint:    string
    distanceFromHere:     (m: number) => string
    // Bare distance, no "away"/"entfernt" suffix — the parking popup's
    // Entfernung row (MapView.tsx) supplies its own label, so appending the
    // suffix again read redundant once split from the nearest-place name.
    distanceShort:        (m: number) => string
    amenityParkingLabel:  string
    amenityToiletLabel:   string
    amenityCapacity:      (n: number) => string
    amenityCount:         (n: number) => string
    openDetails:          (name: string) => string
    showNearbyParking:    string
    copyLink:             string
    linkCopied:           string
    linkShared:           string
  }
  a11y: {
    yes:        string
    yesNearby:  string
    limited:    string
    no:         string
    unknown:    string
  }
  criteria: {
    entrance: string
    toilet:   string
    parking:  string
    seating:  string
    // Short noun form of filters.criteriaItems.onlyVerified, for joining into
    // "Betrifft: Eingang, …"-style judgement reasoning (JudgmentLine,
    // popup-content.ts) — the full checkbox sentence reads oddly mid-list.
    verifiedOnly: string
  }
  details: {
    entrance: {
      isLevel:          string
      hasRamp:          string
      rampSlopePercent: string
      doorWidthCm:      string
      stepCount:        string
      stepHeightCm:     string
      hasAutomaticDoor: string
      hasHoist:         string
      description:      string
    }
    toilet: {
      isDesignated:           string
      hasGrabBars:            string
      grabBarsOnBothSides:    string
      grabBarsFoldable:       string
      turningRadiusCm:        string
      doorWidthCm:            string
      hasEmergencyPullstring: string
      isInside:               string
    }
    parking: {
      hasWheelchairSpaces:      string
      spaceCount:               string
      distanceToEntranceM:      string
      nearbyParkingDistanceM:   string
    }
    seating: {
      isAccessible: string
    }
    units: {
      cm:      string
      m:       string
      percent: string
    }
  }
  map: {
    regionLabel:            string
    searchHereFocus:        string
    fullscreen:             string
    exitFullscreen:         string
    source:                 string
    judgmentPass:           string
    judgmentCaveat:         string
    judgmentUnknown:        string
    // Distinct from judgmentUnknown (used for "no active filter"/"unverified")
    // — this is specifically the confirmed-violation case, only reachable via
    // a deep-linked place that bypassed the normal filter.
    judgmentFail:           string
    showInResults:          string
    showDetails:            string
    // Short chip labels for the map marker popup footers (parking/WC/venue —
    // MapView.tsx's POPUP_CHIP row). Deliberately shorter than the sentence-
    // style results.navigateHere/googleMapsLink/wheelmapLink and map.showDetails/
    // showInResults/parkingReportButton used as aria-label/title/button text
    // elsewhere: the popup's max-width (250px) doesn't fit two full-sentence
    // chips side by side, which defeated the point of the pill-chip footer
    // redesign (docs/prototypes/navigate-here-popup-footer-variants.html).
    popupChipNavigate:      string
    popupChipGoogleMaps:    string
    popupChipWheelmap:      string
    popupChipResults:       string
    popupChipDetails:       string
    popupChipReport:        string
    // Footer toggle label on the map popup's quick view (issue: popup covered
    // 40–90% of the map on small phones) — visible text doubles as the
    // accessible name, swapped on expand/collapse (see popupLess).
    popupMore:              string
    popupLess:              string
    // Shortened criteria labels for the venue popup's entrance/toilet/parking
    // pills (lib/map/popup-content.ts chipD) — the pills are packed inline
    // (not one-third-width columns), so the sentence-style criteria.toilet
    // ("Toilette") / criteria.parking ("Parkplatz") no longer fit three abreast.
    criteriaShortToilet:    string
    criteriaShortParking:   string
    parkingSpot:            string
    parkingSpots:           (n: number) => string
    parkingAccessible:      string
    parkingReservedBadge:    string
    parkingNotReservedBadge: string
    parkingReservedLabel:    string
    parkingDedicatedLabel:   string
    toggleParking:          string
    // Short group label for the map's layer toggle box ("Ebenen" + the two
    // checkbox-style items below it — see focusChipParking/focusChipToilet).
    layersLabel:            string
    // aria-labels for the collapse/expand toggle on the layer box (issue: keep
    // a compact active-layers summary visible when collapsed).
    layersExpand:           string
    layersCollapse:         string
    nearbyParking:          string
    parkingFree:            string
    parkingPaid:            string
    parkingMaxstay:         string
    parkingFeeLabel:        string
    parkingDistanceLabel:   string
    parkingAccessLabel:     string
    parkingPrivate:         string
    parkingCustomers:       string
    legend:                 string
    legendDisabled:         string
    legendAccessible:       string
    legendToilet:           string
    legendToiletStandalone: string
    legendToiletVenue:      string
    legendToiletEuroKey:    string
    // Indented sub-row label under the Entfernung row, naming the nearest
    // place ("↳ bei Kulturhaus …") — kept on its own row so a long name can
    // never wrap the Entfernung row itself (see truncateName in MapView.tsx).
    parkingNearLabel:       string
    parkingReportButton:    string
    parkingReportDone:      string
    parkingReportError:     string
    toiletDesignated:       string
    toiletAccessible:       string
    toiletEuroKey:          string
    toiletChangingTable:    string
    toiletCustomers:        string
    toiletAssociatedPlace:  string
    toiletVenueGeneric:     string
    toiletWheelchairLabel:  string
    toiletDesignatedValue:  string
    toiletAccessLabel:      string
    searchHere:             string
    locate:                 string
    locateError:            string
  }
  categories: {
    cafe:        string
    restaurant:  string
    bar:         string
    pub:         string
    biergarten:  string
    fast_food:   string
    hotel:       string
    hostel:      string
    apartment:   string
    museum:      string
    theater:     string
    cinema:      string
    library:     string
    gallery:     string
    attraction:  string
    pharmacy:    string
    doctors:     string
    dentist:     string
    veterinary:  string
    hospital:    string
    chemist:     string
    supermarket: string
    bakery:      string
    hairdresser: string
    bank:        string
    post_office: string
    zoo:         string
    camp_site:       string
    swimming_pool:   string
    fitness_centre:  string
    playground:      string
    park:            string
    physiotherapist: string
    medical_supply:  string
    hearing_aids:    string
    optician:        string
    townhall:          string
    place_of_worship:  string
    railway_station:   string
    fuel:              string
    shoes:             string
    clothes:           string
    convenience:       string
    bicycle:           string
    furniture:         string
    butcher:           string
    florist:           string
    laundry:           string
    books:             string
    rehabilitation:    string
    sports_centre:     string
  }
  // Chip-specific short/plural phrasing for the legacy chip set (the original
  // 12 pre-drill-in chips) — distinct from `categories` above, which is
  // singular "category badge" wording (e.g. "Hotel" vs. chip "Hotels").
  // Categories without an entry here fall back to `categories[cat]`. Typed
  // over the full Category union (not just the legacy 12) so callers can
  // index it directly with any Category — no `as keyof typeof` cast needed.
  chipLabels: Partial<Record<Category, string>>
  info: {
    basicInfo:      string
    address:        string
    phone:          string
    website:        string
    category:       string
    email:          string
    openingHours:   string
    offer:          string
    cuisine:        string
    stars:          string
    rating:         string
    reviews:        string
    priceLevel:     string
    diet:           string
    vegetarian:     string
    vegan:          string
    dogs:           string
    dogsYes:        string
    dogsNo:         string
    dogsLeashed:    string
    dogsOutside:    string
    takeaway:       string
    takeawayOnly:   string
    delivery:       string
    wifi:           string
    yes:            string
    accessibility:  string
    reliability:    string
    description:    string
    externalLinks:  string
    showRawData:    string
    hideRawData:    string
    rawDataLoading:     string
    rawDataUnavailable: string
    reportDataError:    string
    // Shown instead of reportDataError when entrance/toilet is "unknown" (not
    // "no") — see reportButtonMode in components/results/PlaceDebugSheet.tsx.
    contributeDataInfo: string
  }
  impressum: {
    title:      string
    back:       string
    operator:   string
    contact:    string
    version:    string
    disclaimer: string
    linkLabel:  string
  }
  faq: {
    title:         string
    back:          string
    linkLabel:     string
    feedbackLabel: string
  }
  about: {
    linkLabel: string
  }
  privacy: {
    linkLabel: string
  }
  intlHint: {
    titleFull:      string
    bodyFull:       string
    titleLimited:   string
    bodyLimited:    string
    activate:       string
    dontShowAgain:  string
  }
  settings: {
    title:             string
    autoSaveHint:      string
    done:              string
    sectionGeneral:    string
    sectionMap:        string
    sectionResults:    string
    sectionMobile:     string
    searchMode:        string
    searchModeDefault: string
    searchModeText:    string
    searchModeNearby:  string
    defaultCategory:   string
    categoryNone:      string
    sortOrder:         string
    sortConfidence:    string
    sortDistance:      string
    showWeakParking:     string
    showWeakParkingHint: string
    publicToiletsOnly:     string
    publicToiletsOnlyHint: string
    euroKeyOnly:           string
    euroKeyOnlyHint:       string
    mobileView:        string
    mobileViewList:    string
    mobileViewMap:     string
    resetToDefaults:   string
    resetDone:         string
    internationalMode:     string
    internationalModeHint: string
    usageStats:            string
    usageStatsHint:        string
    language:              string
    languageHint:          string
    mode:                  string
    modeHint:              string
  }
  // Header control that switches between Quickstart Mode and Turbo Mode —
  // see docs/plans/quickstart-mode-default.md. Two aria-label/title strings
  // rather than one generic "switch mode" label: each always names the mode
  // a tap would switch TO, since the control shows the target mode's own
  // icon/colour, not the current mode's.
  modeSwitcher: {
    switchToQuickstart: string
    switchToTurbo:      string
    // Identity labels (not actions) — shown next to the mode's OWN icon in
    // place of the generic app subtitle, so the header/start-screen names
    // whichever mode is currently active rather than only the one a tap
    // would switch to. See ModeSwitcher.tsx's own comment for the
    // target-vs-current icon distinction this pairs with.
    quickstartLabel: string
    turboLabel:      string
  }
  // Simple View ("Variante B — Zwei Wege"): reduced mobile layout, see
  // components/simple/SimpleLayout.tsx. Plain-language sentences per
  // accessibility criterion replace the badge/score vocabulary used elsewhere.
  simple: {
    startTitle:      string
    startNearby:     string
    startNearbyHint: string
    startVenue:      string
    startVenueHint:  string
    startCity:       string
    startCityHint:   string
    showFullAppAlt:  string
    showFullApp:     string
    showFullAppSub:  string
    back:            string
    tilesTitle:      string
    tileAll:         string
    locating:        string
    locateError:     string
    resultsTitle:    (label: string, place?: string) => string
    resultsCount:    (n: number, radius: string) => string
    resizeHandle:    string
    noResultsTitle:  (radius: string, place?: string) => string
    noResultsHint:   string
    lowResultsHint:  string
    venuePlaceholder: string
    venueHint:        string
    venueNoMatches:   string
    cityPlaceholder: string
    cityHint:        string
    cityNoMatches:   string
    citySearchingIn: (city: string) => string
    cityClear:       string
    entranceGood:    string
    entranceLimited: string
    entranceBad:     string
    entranceUnknown: string
    toiletGood:      string
    toiletLimited:   string
    toiletBad:       string
    toiletUnknown:   string
    parkingGood:     string
    parkingLimited:  string
    parkingBad:      string
    parkingUnknown:  string
    call:            string
    accessibleHeadline:       string
    accessibleHeadlineCaveat: string
    // Quickstart's own fallback wording for the rare deep-linked place that
    // fails the fixed preset — deliberately NOT results.judgmentFail/
    // judgmentUnverified, which say "deine Kriterien": Quickstart's criteria
    // aren't user-chosen, so that possessive phrasing would be misleading here.
    notAccessibleHeadline:    string
    unverifiedHeadline:       string
  }
}
