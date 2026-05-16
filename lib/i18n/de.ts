import type { Translations } from "./types"

const de: Translations = {
  app: {
    title:     "Accessible Places",
    subtitle:  "Barrierefreie Orte finden",
    srHeading: "Barrierefreie Orte finden in Deutschland, Österreich und der Schweiz",
  },
  metadata: {
    title:               "Barrierefreie Orte finden | Accessible Places",
    titleTemplate:       "%s | Accessible Places",
    description:
      "Barrierefreie Orte in Deutschland, Österreich und der Schweiz — " +
      "verlässlicher als Google Maps. Kostenlose Suche nach Restaurants, Cafés, Hotels und mehr.",
    manifestDescription: "Rollstuhlgerechte Orte in der DACH-Region finden",
  },
  common: {
    close:       "Schließen",
    loading:     "Lädt …",
    dismissHint: "Hinweis schließen",
  },
  chat: {
    locationPlaceholder: "Ort eingeben, z. B. Berlin Mitte",
    send: "Suchen",
    thinking: "Suche läuft …",
    noResults:        "Keine passenden Orte gefunden.",
    noSearchYetTitle: "Wo suchst du?",
    noSearchYet:      "Gib oben einen Ort ein – z. B. Berlin Mitte",
    errorGeneric:  "Ein Fehler ist aufgetreten. Bitte erneut versuchen.",
    modeText:      "Suche",
    modeNearby:    "In der Nähe",
    locateButton:  "Standort ermitteln",
    locationError: "Standort konnte nicht ermittelt werden.",
    nearbyIn:        (d: string) => `In der Nähe von ${d}`,
    namePlaceholder: 'z. B. „Zur Linde" oder „Hilton"',
    nameToggleShow:  "+ Ergebnisse nach Name eingrenzen",
    nameToggleHide:  "Namensfilter entfernen",
  },
  filters: {
    title: "Filter",
    sources: "Datenquellen",
    criteria: "Barrierefreiheits-Kriterien",
    radius: "Suchradius",
    radiusLabel: (km: number) => `${km} km`,
    acceptUnknown: "Orte mit unklaren Informationen anzeigen",
    sourceCountTooltip: (raw: number, final: number) => `Rohtreffer: ${raw} → nach Filter: ${final}`,
    criteriaItems: {
      entrance:     "Rollstuhlgerechter Eingang",
      toilet:       "Rollstuhlgerechte Toilette",
      parking:      "Rollstuhlgerechter Parkplatz",
      seating:      "Rollstuhlgerechte Sitzplätze",
      onlyVerified: "Nur manuell verifizierte Orte",
    },
  },
  results: {
    title: "Ergebnisse",
    titleRadius: (km: number) => `(${km} km Radius)`,
    radiusPickerLabel: "Suchradius ändern",
    count: (n: number) => `${n} Ort${n !== 1 ? "e" : ""} gefunden`,
    showMap: "Karte anzeigen",
    confidence: {
      high:    "Verlässlich",
      medium:  "Mittel",
      low:     "Unsicher",
    },
    rerun:           "Erneut suchen",
    expandRadius:    "Suchradius vergrößern?",
    expandRadiusYes: "Ja",
    conflict: "Quellen widersprechen sich",
    primarySource: "Beste Quelle",
    noData: "Keine Daten",
    websiteLink:    "Website besuchen",
    phoneLink:      "Anrufen",
    wheelmapLink:   "Auf Wheelmap.org prüfen",
    gintoLink:      "Auf Ginto prüfen",
    googleMapsLink: "In Google Maps öffnen",
    verifiedRecently: "Vor Ort verifiziert (Wheelmap/OSM, ≤ 2 Jahre)",
    verifiedAt: (date: string) => {
      const d = new Date(date)
      if (Number.isNaN(d.getTime())) return "Manuell verifiziert"
      const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
      if (days === 0)   return "Heute manuell verifiziert"
      if (days === 1)   return "Manuell verifiziert vor 1 Tag"
      if (days < 30)    return `Manuell verifiziert vor ${days} Tagen`
      if (days < 365) {
        const months = Math.floor(days / 30)
        return months === 1 ? "Manuell verifiziert vor 1 Monat" : `Manuell verifiziert vor ${months} Monaten`
      }
      const years = Math.floor(days / 365)
      return years === 1 ? "Manuell verifiziert vor 1 Jahr" : `Manuell verifiziert vor ${years} Jahren`
    },
    verifiedAge: (date: string) => {
      const d = new Date(date)
      if (Number.isNaN(d.getTime())) return ""
      const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
      if (days < 7)   return `(${days === 0 ? "heute" : `${days}T`})`
      if (days < 28)  return `(${Math.floor(days / 7)}W)`
      if (days < 365) return `(${Math.floor(days / 30)}M)`
      return `(${Math.floor(days / 365)}J)`
    },
    allowsDogs: "Hunde willkommen",
    noDogs: "Keine Hunde",
    vegetarian: "Vegetarisch",
    vegan:      "Vegan",
    showOnMap:  "Auf Karte zeigen",
    mapHint:    "Tipp: Eintrag antippen → auf Karte anzeigen",
    scoreCalculation:      "Score-Berechnung",
    scoreDataQualityNote:  "Der Prozentwert beschreibt die Verlässlichkeit der Quelldaten, nicht den Grad der Barrierefreiheit des Ortes.",
    scoreCriterion:        "Kriterium",
    scoreValueWeight:      "Wert · Gewicht",
    showRawData:           "Rohdaten anzeigen",
    detailsExpand:         "Details",
    detailsCollapse:       "Weniger",
    noResultsArea:         "Keine Orte in diesem Bereich gefunden.",
    networkError:          "Netzwerkfehler",
    noResultsFiltered:     (n: number) => `${n} Ort${n !== 1 ? "e" : ""} gefunden – keiner erfüllt alle aktiven Filter.`,
    filterBlockedBy:       "Hauptausschlussgrund:",
    sortByConfidence:      "Verlässlichkeit",
    sortByDistance:        "Entfernung",
    adjustFilters:         "Filter anpassen",
    adjustFiltersHint:     "Passe die Filterkriterien links an, um mehr Ergebnisse zu sehen.",
    distanceFromHere:      (m: number) => m < 1000 ? `${m} m entfernt` : `${(m / 1000).toFixed(1).replace(".", ",")} km entfernt`,
  },
  a11y: {
    yes:       "Ja",
    yesNearby: "Ja, in der Nähe",
    limited:   "Eingeschränkt",
    no:        "Nein",
    unknown:   "Unbekannt",
  },
  criteria: {
    entrance: "Eingang",
    toilet:   "Toilette",
    parking:  "Parkplatz",
    seating:  "Sitzplätze",
  },
  details: {
    entrance: {
      isLevel:          "Stufenlos",
      hasRamp:          "Rampe vorhanden",
      rampSlopePercent: "Rampenneigung",
      doorWidthCm:      "Türbreite",
      stepCount:        "Stufenanzahl",
      stepHeightCm:     "Stufenhöhe",
      hasAutomaticDoor: "Automatiktür",
      hasHoist:         "Hublift vorhanden",
      description:      "Beschreibung",
    },
    toilet: {
      isDesignated:          "Ausgewiesene Rollstuhl-Toilette",
      hasGrabBars:           "Haltegriffe",
      grabBarsOnBothSides:   "Beidseitige Haltegriffe",
      grabBarsFoldable:      "Klappbare Haltegriffe",
      turningRadiusCm:       "Bewegungsfläche",
      doorWidthCm:           "Türbreite",
      hasEmergencyPullstring:"Notrufkette",
      isInside:              "WC im Betrieb vorhanden",
    },
    parking: {
      hasWheelchairSpaces:   "Behindertenparkplätze vorhanden",
      spaceCount:            "Anzahl Plätze",
      distanceToEntranceM:   "Abstand zum Eingang",
    },
    seating: {
      isAccessible: "Rollstuhlgerechte Sitzplätze",
    },
    units: {
      cm: "cm",
      m:  "m",
      percent: "%",
    },
  },
  map: {
    fullscreen:    "Vollbild",
    exitFullscreen:"Vollbild beenden",
    source:        "Quelle",
    confidence:    "Verlässlichkeit",
    showInResults: "Zeige in Ergebnissen",
    parkingSpot:   "Barrierefreier Parkplatz",
    parkingSpots:  (n: number) => `${n} barrierefreie Parkplätze`,
  },
  categories: {
    cafe:        "Café",
    restaurant:  "Restaurant",
    bar:         "Bar",
    pub:         "Kneipe / Pub",
    biergarten:  "Biergarten",
    fast_food:   "Imbiss / Fast Food",
    hotel:       "Hotel",
    hostel:      "Hostel",
    apartment:   "Ferienwohnung",
    museum:      "Museum",
    theater:     "Theater",
    cinema:      "Kino",
    library:     "Bibliothek",
    gallery:     "Galerie",
    attraction:  "Sehenswürdigkeit",
  },
  faq: {
    title:         "Häufige Fragen",
    back:          "Zurück",
    linkLabel:     "FAQ",
    feedbackLabel: "Feedback",
  },
  impressum: {
    title:      "Impressum",
    back:       "Zurück",
    operator:   "Betreiber",
    contact:    "Kontakt",
    version:    "Version",
    disclaimer: "Dieses Projekt ist ein privates, nicht-kommerzielles Hobby-Projekt. Für die Vollständigkeit, Richtigkeit und Aktualität der angezeigten Barrierefreiheitsinformationen wird keine Haftung übernommen.",
    linkLabel:  "Impressum",
  },
}

export default de
