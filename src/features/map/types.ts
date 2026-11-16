// The map behind an interface (D3, PR 3.4). The search page talks to a `MapAdapter`, never to Mapbox:
// `MapboxMap` (src/features/map/mapbox/, the only place mapbox-gl is imported) draws the real map,
// and `FakeMap` draws the same markers as plain DOM buttons for tests and screenshots, so CI never
// needs WebGL or a Mapbox token.

import { type ComponentType } from "react";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** One marker per venue (spec §1), showing its published pitch count (spec §3: never a price). */
export interface MapMarker {
  id: string;
  position: LatLng;
  /** The marker's text: the venue's published pitch count. */
  count: number;
  /** Accessible name, e.g. "Royal Park Sports Complex, 4 pitches". */
  label: string;
}

export interface MapAdapterProps {
  /** In list order, so keyboard focus moves through the markers in the same order as the cards. */
  markers: readonly MapMarker[];
  /** The area to show. Applied when the map starts and whenever `viewKey` changes, not on every render. */
  bounds: MapBounds;
  /** Changes for a new search (once its first page arrives) and on Recentre; not on "Show more". */
  viewKey: string;
  /** The marker for the card under the pointer or keyboard focus in the list. */
  highlightedId: string | null;
  /** The marker the person chose on the map: drawn larger and darker. */
  selectedId: string | null;
  onMarkerClick: (id: string) => void;
  /** Recentre button: show `bounds` again. */
  onRecentre: () => void;
  /** The map can't be shown (no WebGL, bad token, style failed to load). */
  onUnavailable: () => void;
}

export type MapAdapter = ComponentType<MapAdapterProps>;
