export interface Translations {
  app: {
    title:    string
    subtitle: string
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
  }
  chat: {
    locationPlaceholder: string
    send:          string
    thinking:      string
    noResults:        string
    noSearchYetTitle: string
    noSearchYet:      string
    errorGeneric:  string
    modeText:      string
    modeNearby:    string
    locateButton:  string
    locationError: string
    nearbyIn:        (district: string) => string
    namePlaceholder: string
    nameToggleShow:  string
    nameToggleHide:  string
  }
  filters: {
    title:               string
    sources:             string
    criteria:            string
    radius:              string
    radiusLabel:         (km: number) => string
    acceptUnknown:       string
    sourceCountTooltip:  (raw: number, final: number) => string
    criteriaItems: {
      entrance:     string
      toilet:       string
      parking:      string
      seating:      string
      onlyVerified: string
    }
  }
  results: {
    title:              string
    titleRadius:        (km: number) => string
    radiusPickerLabel:  string
    count:              (n: number) => string
    showMap:     string
    confidence: {
      high:   string
      medium: string
      low:    string
    }
    rerun:             string
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
    verifiedAt:        (date: string) => string
    verifiedAge:       (date: string) => string
    allowsDogs:        string
    noDogs:            string
    vegetarian:        string
    vegan:             string
    showOnMap:         string
    mapHint:           string
    scoreCalculation:     string
    scoreDataQualityNote: string
    scoreCriterion:       string
    scoreValueWeight:     string
    scoreNoActiveCriteria: string
    showRawData:          string
    detailsExpand:        string
    detailsCollapse:      string
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
      hasWheelchairSpaces:  string
      spaceCount:           string
      distanceToEntranceM:  string
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
    fullscreen:      string
    exitFullscreen:  string
    source:          string
    confidence:      string
    showInResults:   string
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
}
