export interface Translations {
  app: {
    title:    string
    subtitle: string
  }
  chat: {
    locationPlaceholder: string
    send:          string
    thinking:      string
    noResults:     string
    noSearchYet:   string
    errorGeneric:  string
    modeText:      string
    modeNearby:    string
    locateButton:  string
    locationError: string
    nearbyIn:      (district: string) => string
  }
  filters: {
    title:         string
    sources:       string
    criteria:      string
    radius:        string
    radiusLabel:   (km: number) => string
    acceptUnknown: string
    criteriaItems: {
      entrance:     string
      toilet:       string
      parking:      string
      seating:      string
      onlyVerified: string
    }
  }
  results: {
    title:       string
    count:       (n: number, radiusKm?: number) => string
    showMap:     string
    hideMap:     string
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
    wheelmapLink:      string
    verifiedRecently:  string
    verifiedAt:        (date: string) => string
    verifiedAge:       (date: string) => string
    allowsDogs:        string
    noDogs:            string
    vegetarian:        string
    vegan:             string
  }
  a11y: {
    yes:     string
    limited: string
    no:      string
    unknown: string
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
    fullscreen:     string
    exitFullscreen: string
    source:         string
    confidence:     string
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
}
