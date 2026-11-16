import type { VenueSearchResultDto } from "@/features/search/search";

import { type LatLng, type MapBounds, type MapMarker } from "./types";

// What the map shows for a search (PR 3.4): the loaded venues and the searched place together, or,
// with no venues yet, the search radius around the place.

/** Melbourne CBD: where the map starts before any search (FieldFinder is Melbourne-first). */
export const DEFAULT_CENTRE: LatLng = { lat: -37.8136, lng: 144.9631 };

const KM_PER_DEGREE_LATITUDE = 111.32;

/** The box around `centre` that holds a circle of `radiusKm`. */
export function radiusBounds(centre: LatLng, radiusKm: number): MapBounds {
  const dLat = radiusKm / KM_PER_DEGREE_LATITUDE;
  const dLng = radiusKm / (KM_PER_DEGREE_LATITUDE * Math.cos((centre.lat * Math.PI) / 180));
  return { south: centre.lat - dLat, west: centre.lng - dLng, north: centre.lat + dLat, east: centre.lng + dLng };
}

/** The box holding `centre` and every point, or the radius box if there are no points. */
export function searchBounds(centre: LatLng, radiusKm: number, points: readonly LatLng[]): MapBounds {
  if (points.length === 0) return radiusBounds(centre, radiusKm);
  const lats = [centre.lat, ...points.map((p) => p.lat)];
  const lngs = [centre.lng, ...points.map((p) => p.lng)];
  return { south: Math.min(...lats), west: Math.min(...lngs), north: Math.max(...lats), east: Math.max(...lngs) };
}

export function markerLabel(name: string, publishedPitchCount: number): string {
  return `${name}, ${String(publishedPitchCount)} ${publishedPitchCount === 1 ? "pitch" : "pitches"}`;
}

export function toMapMarker(venue: VenueSearchResultDto): MapMarker {
  return {
    id: venue.id,
    position: { lat: venue.location.latitude, lng: venue.location.longitude },
    count: venue.publishedPitchCount,
    label: markerLabel(venue.name, venue.publishedPitchCount),
  };
}

export type MarkerState = "default" | "highlighted" | "selected";

export function markerState(id: string, highlightedId: string | null, selectedId: string | null): MarkerState {
  if (id === selectedId) return "selected";
  if (id === highlightedId) return "highlighted";
  return "default";
}

const MARKER_BASE =
  "flex size-9 cursor-pointer items-center justify-center rounded-pill border-2 border-surface text-sm font-semibold text-surface shadow-md motion-safe:transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Classes for a marker's button. Selected is larger and darker (spec §3); highlighted is darker. */
export function markerClassName(state: MarkerState): string {
  switch (state) {
    case "selected":
      return `${MARKER_BASE} scale-125 bg-primary-dark`;
    case "highlighted":
      return `${MARKER_BASE} scale-110 bg-primary-dark`;
    default:
      return `${MARKER_BASE} bg-primary`;
  }
}

/** Stacking order: a highlighted or selected marker sits above its neighbours. */
export function markerZIndex(state: MarkerState): number {
  return state === "selected" ? 2 : state === "highlighted" ? 1 : 0;
}

/** Which map to draw: the fake for tests (NEXT_PUBLIC_MAP_ADAPTER=fake), Mapbox with a public token, else none. */
export type MapAdapterKind = "fake" | "mapbox" | "unavailable";

export function mapAdapterKind(adapter: string | undefined, token: string | undefined): MapAdapterKind {
  if (adapter === "fake") return "fake";
  return isPublicMapboxToken(token) ? "mapbox" : "unavailable";
}

/**
 * Only a public (`pk.`) token may reach the browser. A secret (`sk.`) token, or anything else, is
 * refused, so a mis-set variable can't hand out a secret.
 */
export function isPublicMapboxToken(token: string | undefined): token is string {
  return token !== undefined && /^pk\.[\w.-]+$/.test(token.trim());
}
