import type { Translations } from "./types"

const de: Translations = {
  app: {
    title: "Accessible Spaces",
    subtitle: "Barrierefreie Orte finden",
  },
  chat: {
    placeholder: 'z.B. "Restaurants in Berlin Mitte"',
    send: "Suchen",
    thinking: "Suche läuft …",
    noResults: "Keine passenden Orte gefunden.",
    errorGeneric:  "Ein Fehler ist aufgetreten. Bitte erneut versuchen.",
    modeText:      "Suche",
    modeNearby:    "In der Nähe",
    locateButton:  "Standort ermitteln",
    locationError: "Standort konnte nicht ermittelt werden.",
    nearbyIn:      (d: string) => `In der Nähe von ${d}`,
  },
  filters: {
    title: "Filter",
    sources: "Datenquellen",
    criteria: "Barrierefreiheits-Kriterien",
    radius: "Suchradius",
    radiusLabel: (km: number) => `${km} km`,
    acceptUnknown: "Orte mit unklaren Informationen anzeigen",
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
    count: (n: number) => `${n} Ort${n !== 1 ? "e" : ""} gefunden`,
    showMap: "Karte anzeigen",
    hideMap: "Karte ausblenden",
    confidence: {
      high:    "Verlässlich",
      medium:  "Mittel",
      low:     "Unsicher",
    },
    rerun:    "Erneut suchen",
    conflict: "Quellen widersprechen sich",
    primarySource: "Beste Quelle",
    noData: "Keine Daten",
    wheelmapLink: "Auf Wheelmap.org prüfen",
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
    vegan: "Vegan",
  },
  a11y: {
    yes:     "Ja",
    limited: "Eingeschränkt",
    no:      "Nein",
    unknown: "Unbekannt",
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
}

export default de
