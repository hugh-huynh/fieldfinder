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
  // Each marker is a <button data-marker-id={id} aria-haspopup="dialog" aria-expanded={chosen}>, so
  // SearchMap can return focus to it when its preview closes.
  /** The area to show. Applied when the map starts and whenever `viewKey` changes, not on every render. */
  bounds: MapBounds;
  /**
   * "padded": fit a search's area with room around it. "exact": show exactly `bounds`, no animation
   * (a viewport restored from history, PR 3.6).
   */
  fit: "padded" | "exact";
  /** Changes for a new search (once its first page arrives) and on Recentre; not on "Show more". */
  viewKey: string;
  /** The marker for the card under the pointer or keyboard focus in the list. */
  highlightedId: string | null;
  /** The marker the person chose on the map: drawn larger and darker, its preview open (3.5). */
  selectedId: string | null;
  onMarkerClick: (id: string) => void;
  /** Recentre button: show `bounds` again. */
  onRecentre: () => void;
  /** The map can't be shown (no WebGL, bad token, style failed to load). */
  onUnavailable: () => void;
  /**
   * The visible area after each move settles (3.6). `byUser` is true for the person's own moves
   * (drag, scroll, pinch, keyboard, the zoom buttons) and false for fitting a view, so only those
   * offer "Search this area".
   */
  onViewportChange: (bounds: MapBounds, byUser: boolean) => void;
  /**
   * Pixels of the map covered on each side: the preview card while a marker is chosen, the mobile
   * results sheet (3.8) and the map's own controls. Fitted views leave room for them, and the real
   * map pans a chosen marker out from under the top and bottom (3.6). Read when needed, so dragging
   * the sheet never moves the map.
   */
  obscured: { top: number; bottom: number; left: number; right: number };
}

export type MapAdapter = ComponentType<MapAdapterProps>;
