"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";

import { MapControls } from "../components/MapControls";
import { type MapAdapterProps, type MapBounds } from "../types";
import { markerClassName, markerState, markerZIndex } from "../view";

import { fitPadding } from "./fit";

// The real map (D3, PR 3.4): mapbox-gl v3 driven directly (no React wrapper; the MapAdapter interface
// already hides it). The only module that imports mapbox-gl, and it's loaded with next/dynamic
// (ssr: false) on the search page, so it never runs on the server or ships in other routes.
//
// - The public token (NEXT_PUBLIC_MAPBOX_TOKEN, `pk.` only) is URL-restricted in Mapbox's console.
// - Markers are real <button>s, added in list order, so Tab reaches them in the same order as the cards.
// - The view is fitted when the map starts and whenever `viewKey` changes, never on other renders, so
//   "Show more" and highlighting don't move the map.
// - Mapbox's attribution and logo stay on (its terms require them); rotation and pitch are off.
// - After each move it reports the viewport (3.6). A move is the person's when Mapbox saw an input
//   event (drag, scroll, pinch, keyboard) or it came from our zoom buttons (tagged `byUser`); fitting
//   a view and keeping a chosen marker clear of its preview are not.

const STYLE = "mapbox://styles/mapbox/streets-v12";
const FIT_MAX_ZOOM = 15;

/**
 * A search's area, fitted with room around it and clear of whatever covers the map, always leaving
 * some of the map to fit into (fit.ts).
 */
function padded(obscured: MapAdapterProps["obscured"], element: Pick<HTMLElement, "clientWidth" | "clientHeight">) {
  return { padding: fitPadding(obscured, element.clientWidth, element.clientHeight), maxZoom: FIT_MAX_ZOOM };
}
/** A restored viewport: exactly the saved box, no padding, no animation. */
const EXACT = { padding: 0, duration: 0 } as const;
/** Room kept between a chosen marker and the edge of the preview covering the map's top. */
const CHOSEN_MARGIN_PX = 48;
/** Tags our own zoom-button moves, so they count as the person's (eventData is merged into events). */
const BY_USER = { byUser: true } as const;

const toLngLatBounds = (b: MapBounds): [[number, number], [number, number]] => [
  [b.west, b.south],
  [b.east, b.north],
];

interface MarkerEntry {
  marker: mapboxgl.Marker;
  wrapper: HTMLDivElement;
  button: HTMLButtonElement;
}

function styleMarkers(entries: Map<string, MarkerEntry>, highlightedId: string | null, selectedId: string | null) {
  for (const [id, { wrapper, button }] of entries) {
    const state = markerState(id, highlightedId, selectedId);
    button.className = markerClassName(state);
    button.setAttribute("aria-expanded", String(state === "selected"));
    button.dataset.markerState = state;
    wrapper.style.zIndex = String(markerZIndex(state));
  }
}

export function MapboxMap({
  token,
  markers,
  bounds,
  fit,
  viewKey,
  highlightedId,
  selectedId,
  onMarkerClick,
  onRecentre,
  onUnavailable,
  onViewportChange,
  obscured,
}: MapAdapterProps & { token: string }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const entries = useRef(new Map<string, MarkerEntry>());
  // Latest props for long-lived listeners and the one-time setup, updated after each render.
  const latest = useRef({ bounds, fit, markers, onMarkerClick, onUnavailable, onViewportChange, obscured });
  useEffect(() => {
    latest.current = { bounds, fit, markers, onMarkerClick, onUnavailable, onViewportChange, obscured };
  });

  // Create the map once.
  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    const markersOnMap = entries.current;
    let instance: mapboxgl.Map;
    try {
      instance = new mapboxgl.Map({
        container: element,
        accessToken: token,
        style: STYLE,
        bounds: toLngLatBounds(latest.current.bounds),
        fitBoundsOptions: latest.current.fit === "exact" ? EXACT : padded(latest.current.obscured, element),
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
    } catch {
      // No WebGL, or the browser is too old.
      latest.current.onUnavailable();
      return;
    }
    instance.touchZoomRotate.disableRotation();
    instance.keyboard.disableRotation();
    let loaded = false;
    instance.on("load", () => {
      loaded = true;
    });
    // A bad or restricted token, or an unreachable style, fails before "load". Later errors (a
    // missing tile) leave a usable map.
    instance.on("error", () => {
      if (!loaded) latest.current.onUnavailable();
    });
    instance.on("moveend", (event: { originalEvent?: unknown; byUser?: boolean }) => {
      const b = instance.getBounds();
      latest.current.onViewportChange(
        { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
        event.originalEvent !== undefined || event.byUser === true,
      );
    });
    map.current = instance;
    return () => {
      markersOnMap.clear();
      instance.remove();
      map.current = null;
    };
  }, [token]);

  // Show the search's area for each new view (new search, Recentre).
  const fittedKey = useRef(viewKey);
  useEffect(() => {
    if (fittedKey.current === viewKey) return;
    fittedKey.current = viewKey;
    const instance = map.current;
    if (instance === null) return;
    instance.fitBounds(
      toLngLatBounds(bounds),
      fit === "exact" ? EXACT : padded(latest.current.obscured, instance.getContainer()),
    );
  }, [viewKey, bounds, fit]);

  // A chosen marker under the preview card or the mobile sheet is panned into view (3.6, 3.8). Not
  // the person's move. Only when a marker is chosen: dragging the sheet never moves the map.
  useEffect(() => {
    const instance = map.current;
    const chosen = selectedId === null ? undefined : latest.current.markers.find((m) => m.id === selectedId);
    if (instance === null || chosen === undefined) return;
    const { top, bottom } = latest.current.obscured;
    const { y } = instance.project([chosen.position.lng, chosen.position.lat]);
    const highest = top + CHOSEN_MARGIN_PX;
    const lowest = instance.getContainer().clientHeight - bottom - CHOSEN_MARGIN_PX;
    if (y < highest) instance.panBy([0, y - highest]);
    else if (y > lowest && lowest > highest) instance.panBy([0, y - lowest]);
  }, [selectedId]);

  // Keep the markers in step with the loaded venues, in list order.
  useEffect(() => {
    const instance = map.current;
    if (instance === null) return;
    const wanted = new Set(markers.map((m) => m.id));
    for (const [id, entry] of entries.current) {
      if (!wanted.has(id)) {
        entry.marker.remove();
        entries.current.delete(id);
      }
    }
    for (const m of markers) {
      const existing = entries.current.get(m.id);
      if (existing !== undefined) {
        existing.marker.setLngLat([m.position.lng, m.position.lat]);
        existing.button.textContent = String(m.count);
        existing.button.setAttribute("aria-label", m.label);
        continue;
      }
      // The wrapper is what Mapbox positions (it owns the wrapper's transform), so the button can scale.
      const wrapper = document.createElement("div");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(m.count);
      button.setAttribute("aria-label", m.label);
      button.setAttribute("aria-haspopup", "dialog");
      button.dataset.markerId = m.id;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        latest.current.onMarkerClick(m.id);
      });
      wrapper.append(button);
      const marker = new mapboxgl.Marker({ element: wrapper })
        .setLngLat([m.position.lng, m.position.lat])
        .addTo(instance);
      entries.current.set(m.id, { marker, wrapper, button });
    }
  }, [markers]);

  // Highlight and selection: restyle only, never move the map.
  useEffect(() => {
    styleMarkers(entries.current, highlightedId, selectedId);
  }, [markers, highlightedId, selectedId]);

  return (
    // Below lg the results sheet covers the map's bottom (--sheet-h, SearchLayout), so Mapbox's logo
    // and attribution sit just above it: its terms require them to stay visible.
    <div className="relative size-full [&_.mapboxgl-ctrl-bottom-left]:bottom-(--sheet-h) lg:[&_.mapboxgl-ctrl-bottom-left]:bottom-0 [&_.mapboxgl-ctrl-bottom-right]:bottom-(--sheet-h) lg:[&_.mapboxgl-ctrl-bottom-right]:bottom-0">
      <div ref={container} className="size-full" />
      <MapControls
        onRecentre={onRecentre}
        onZoomIn={() => map.current?.zoomIn(undefined, BY_USER)}
        onZoomOut={() => map.current?.zoomOut(undefined, BY_USER)}
      />
    </div>
  );
}
