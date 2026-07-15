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
    displayOptions:      string
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
    confidence: {
      high:   string
      medium: string
      low:    string
    }
    rerun:             string
    retry:             string
    expandRadius:      string
    expandRadiusYes:   string
    conflict:          string
    lowConfidenceHint: string
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
    scoreCalculation:     string
    scorePrefix:          string
    scoreDataQualityNote: string
    scoreCriterion:       string
    scoreValueWeight:     string
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
    confidence:             string
    confidenceShort: {
      high:   string
      medium: string
      low:    string
    }
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
    mobileView:        string
    mobileViewList:    string
    mobileViewMap:     string
    resetToDefaults:   string
    resetDone:         string
    internationalMode:     string
    internationalModeHint: string
    usageStats:            string
    usageStatsHint:        string
  }
}
