import type { Place } from "./types"

// Canonical in-app deep link to a place: opening it re-runs the search around
// the coordinates and auto-selects the place (handled in HomeClient). Used by
// the share button and as the `deeplink` hidden field in data-error reports —
// keep both in sync by building the URL only here. Client-side only (reads
// window.location).
export function buildPlaceDeepLink(place: Place): string {
  const homePath = window.location.pathname.startsWith("/en") ? "/en/" : "/"
  const params = new URLSearchParams({
    selectLat:  String(place.coordinates.lat),
    selectLon:  String(place.coordinates.lon),
    selectName: place.name,
    cat:        place.category,
  })
  return `${window.location.origin}${homePath}?${params}`
}
