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
  }
  chat: {
    locationPlaceholder: string
    send:          string
    thinking:      string
    noResults:        string
    noSearchYetTitle:      string
    noSearchYet:           string
    noSearchYetNameHint:    string
    noSearchYetPlaceHint:   string
    noSearchYetPlaceLink:   string
    noSearchYetTitlePlace:  string
    noSearchYetPlace:       string
    noSearchYetExploreHint: string
    noSearchYetExploreLink: string
    errorGeneric:  string
    errorTimeout:  string
    modeText:      string
    modeNearby:    string
    modePlace:     string
    modeTextSub:   string
    modeNearbySub: string
    modePlaceSub:  string
    locateButton:  string
    locationError: string
    nearbyIn:        (district: string) => string
    parkingModeToggle:    string
    parkingNoneFound:     string
    toiletModeToggle:     string
    toiletsNoneFound:     string
    focusChipParking:     string
    focusChipToilet:      string
    namePlaceholder:      string
    nameToggleShow:       string
    nameToggleHide:       string
    placeModePlaceholder: string
    placeSearchHint:   string
    placeNotFound:     string
    placeNoData:       (name: string) => string
    welcomeTitle:       string
    welcomeSubtitle:    string
    welcomeGpsHint:     string
    welcomeOrDivider:   string
    welcomeTextCard:     string
    welcomeTextCardHint: string
    welcomePlaceCard:    string
    welcomePlaceCardHint:string
    welcomeDismiss:      string
  }
  filters: {
    title:               string
    sources:             string
    criteria:            string
    radius:              string
    radiusLabel:         (km: number) => string
    acceptUnknown:       string
    displayOptions:      string
    alwaysShowParking:   string
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
    titleRadius:        (km: number) => string
    radiusPickerLabel:  string
    count:              (n: number) => string
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
    primarySource:     string
    noData:            string
    websiteLink:       string
    phoneLink:         string
    wheelmapLink:      string
    gintoLink:         string
    googleMapsLink:    string
    verifiedRecently:  string
    verifiedAt:        (date: string, sources: string[]) => string
    verifiedAge:       (date: string) => string
    allowsDogs:        string
    noDogs:            string
    vegetarian:        string
    vegan:             string
    showOnMap:         string
    mapHint:           string
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
    noResultsFiltered:    (n: number) => string
    filterBlockedBy:      string
    sortByConfidence:     string
    sortByDistance:       string
    adjustFilters:        string
    adjustFiltersHint:    string
    distanceFromHere:     (m: number) => string
    showNearbyParking:    string
    copyLink:             string
    linkCopied:           string
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
    fullscreen:             string
    exitFullscreen:         string
    source:                 string
    confidence:             string
    showInResults:          string
    parkingSpot:            string
    parkingSpots:           (n: number) => string
    parkingAccessible:      string
    parkingAccessibleHint:  string
    toggleParking:          string
    nearbyParking:          string
    layerNone:              string
    layerBoth:              string
    parkingFree:            string
    parkingPaid:            string
    parkingMaxstay:         string
    parkingPrivate:         string
    parkingCustomers:       string
    legend:                 string
    legendDisabled:         string
    legendAccessible:       string
    legendToilet:           string
    parkingDistanceTo:      (dist: string, name: string) => string
    parkingReportButton:    string
    parkingReportDone:      string
    parkingReportError:     string
    toiletDesignated:       string
    toiletAccessible:       string
    toiletEuroKey:          string
    toiletChangingTable:    string
    toiletCustomers:        string
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
    ice_cream:   string
  }
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
    searchModePlace:   string
    defaultCategory:   string
    categoryNone:      string
    sortOrder:         string
    sortConfidence:    string
    sortDistance:      string
    autoZoom:          string
    autoZoomHint:      string
    alwaysShowParking: string
    showWeakParking:     string
    showWeakParkingHint: string
    publicToiletsOnly:     string
    publicToiletsOnlyHint: string
    mobileView:        string
    mobileViewList:    string
    mobileViewMap:     string
    resetToDefaults:   string
    resetDone:         string
    parkingRadius:     string
  }
}
