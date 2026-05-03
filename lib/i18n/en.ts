import type { Translations } from "./types"

const en: Translations = {
  app: {
    title: "Accessible Spaces",
    subtitle: "Find wheelchair-accessible places",
  },
  chat: {
    locationPlaceholder: "Enter a city, e.g. Berlin Mitte",
    send: "Search",
    thinking: "Searching …",
    noResults:        "No matching places found.",
    noSearchYetTitle: "Where are you looking?",
    noSearchYet:      "Enter a city above – e.g. Berlin Mitte",
    errorGeneric:  "An error occurred. Please try again.",
    modeText:      "Search",
    modeNearby:    "Nearby",
    locateButton:  "Detect location",
    locationError: "Location could not be determined.",
    nearbyIn:      (d: string) => `Near ${d}`,
  },
  filters: {
    title: "Filters",
    sources: "Data Sources",
    criteria: "Accessibility Criteria",
    radius: "Search Radius",
    radiusLabel: (km: number) => `${km} km`,
    acceptUnknown: "Show places with unclear information",
    criteriaItems: {
      entrance:     "Wheelchair-accessible entrance",
      toilet:       "Wheelchair-accessible toilet",
      parking:      "Wheelchair-accessible parking",
      seating:      "Wheelchair-accessible seating",
      onlyVerified: "Only manually verified places",
    },
  },
  results: {
    title: "Results",
    titleRadius: (km: number) => `(${km} km radius)`,
    count: (n: number) => `${n} place${n !== 1 ? "s" : ""} found`,
    showMap: "Show map",
    hideMap: "Hide map",
    confidence: {
      high:   "Reliable",
      medium: "Moderate",
      low:    "Uncertain",
    },
    rerun:           "Search again",
    expandRadius:    "Expand search radius?",
    expandRadiusYes: "Yes",
    conflict: "Sources disagree",
    primarySource: "Best source",
    noData: "No data",
    wheelmapLink: "Check on Wheelmap.org",
    verifiedRecently: "Recently user-verified (Wheelmap/OSM, ≤ 2 years)",
    verifiedAt: (date: string) => {
      const d = new Date(date)
      if (Number.isNaN(d.getTime())) return "Manually verified"
      const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
      if (days === 0)   return "Manually verified today"
      if (days === 1)   return "Manually verified 1 day ago"
      if (days < 30)    return `Manually verified ${days} days ago`
      if (days < 365) {
        const months = Math.floor(days / 30)
        return months === 1 ? "Manually verified 1 month ago" : `Manually verified ${months} months ago`
      }
      const years = Math.floor(days / 365)
      return years === 1 ? "Manually verified 1 year ago" : `Manually verified ${years} years ago`
    },
    verifiedAge: (date: string) => {
      const d = new Date(date)
      if (Number.isNaN(d.getTime())) return ""
      const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
      if (days < 7)   return `(${days === 0 ? "today" : `${days}d`})`
      if (days < 28)  return `(${Math.floor(days / 7)}w)`
      if (days < 365) return `(${Math.floor(days / 30)}m)`
      return `(${Math.floor(days / 365)}y)`
    },
    allowsDogs: "Dogs welcome",
    noDogs: "No dogs",
    vegetarian: "Vegetarian",
    vegan:      "Vegan",
    showOnMap:  "Show on map",
    mapHint:    "Tip: tap an entry to show it on the map",
  },
  a11y: {
    yes:     "Yes",
    limited: "Limited",
    no:      "No",
    unknown: "Unknown",
  },
  criteria: {
    entrance: "Entrance",
    toilet:   "Toilet",
    parking:  "Parking",
    seating:  "Seating",
  },
  details: {
    entrance: {
      isLevel:          "Step-free",
      hasRamp:          "Ramp available",
      rampSlopePercent: "Ramp slope",
      doorWidthCm:      "Door width",
      stepCount:        "Number of steps",
      stepHeightCm:     "Step height",
      hasAutomaticDoor: "Automatic door",
      hasHoist:         "Wheelchair lift",
      description:      "Description",
    },
    toilet: {
      isDesignated:          "Designated wheelchair toilet",
      hasGrabBars:           "Grab bars",
      grabBarsOnBothSides:   "Grab bars on both sides",
      grabBarsFoldable:      "Foldable grab bars",
      turningRadiusCm:       "Turning space",
      doorWidthCm:           "Door width",
      hasEmergencyPullstring:"Emergency pull cord",
      isInside:              "On-site accessible toilet",
    },
    parking: {
      hasWheelchairSpaces:   "Disabled parking available",
      spaceCount:            "Number of spaces",
      distanceToEntranceM:   "Distance to entrance",
    },
    seating: {
      isAccessible: "Wheelchair-accessible seating",
    },
    units: {
      cm:      "cm",
      m:       "m",
      percent: "%",
    },
  },
  map: {
    fullscreen:    "Fullscreen",
    exitFullscreen:"Exit fullscreen",
    source:        "Source",
    confidence:    "Reliability",
  },
  categories: {
    cafe:        "Café",
    restaurant:  "Restaurant",
    bar:         "Bar",
    pub:         "Pub",
    biergarten:  "Beer Garden",
    fast_food:   "Fast Food",
    hotel:       "Hotel",
    hostel:      "Hostel",
    apartment:   "Apartment",
    museum:      "Museum",
    theater:     "Theater",
    cinema:      "Cinema",
    library:     "Library",
    gallery:     "Gallery",
    attraction:  "Attraction",
  },
} as const

export default en
export type { Translations }
