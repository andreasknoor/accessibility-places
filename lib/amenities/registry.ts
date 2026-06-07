import type { AmenityType } from "../types"

export interface AmenityTypeConfig {
  // When true, a nearby strong-tier feature upgrades a venue's own attribute
  // from "unknown" to "yes" with nearbyOnly=true (parking does this; toilet doesn't).
  enrichesVenue: boolean
  // Short label displayed on the map marker.
  markerLabel: string
  // i18n key prefix used for legends, badges, and layer chips.
  i18nKey: string
}

export const AMENITY_REGISTRY: Record<AmenityType, AmenityTypeConfig> = {
  parking: {
    enrichesVenue: true,
    markerLabel:   "P",
    i18nKey:       "parking",
  },
  toilet: {
    enrichesVenue: false,
    markerLabel:   "WC",
    i18nKey:       "toilet",
  },
}
