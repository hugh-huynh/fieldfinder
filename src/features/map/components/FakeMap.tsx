"use client";

import { useState } from "react";

import { type MapAdapterProps, type MapBounds } from "../types";
import { markerClassName, markerState, markerZIndex } from "../view";

import { MapControls } from "./MapControls";

// A deterministic stand-in for the Mapbox map (D3, PR 3.4), used by component tests, E2E
// (NEXT_PUBLIC_MAP_ADAPTER=fake) and screenshots: no WebGL, no network, no token. It draws the same
// marker buttons and controls as MapboxMap on a flat background, placing each marker by a straight
// projection of the current view. The view is exposed as data attributes for tests.

const ZOOM_FACTOR = 2;

function zoomed(bounds: MapBounds, steps: number): MapBounds {
  const scale = ZOOM_FACTOR ** -steps;
  const midLat = (bounds.south + bounds.north) / 2;
  const midLng = (bounds.west + bounds.east) / 2;
  const halfLat = ((bounds.north - bounds.south) / 2) * scale;
  const halfLng = ((bounds.east - bounds.west) / 2) * scale;
  return { south: midLat - halfLat, west: midLng - halfLng, north: midLat + halfLat, east: midLng + halfLng };
}

/** 0..1 across the span, with a degenerate (single-point) span drawn in the middle. */
function fraction(value: number, from: number, to: number): number {
  return to === from ? 0.5 : (value - from) / (to - from);
}

export function FakeMap({
  markers,
  bounds,
  viewKey,
  highlightedId,
  selectedId,
  onMarkerClick,
  onRecentre,
}: MapAdapterProps) {
  // The bounds last fitted and the zoom steps since. Like fitBounds on the real map, only a new viewKey
  // re-fits: new bounds under the same key (e.g. "Show more" adding a far venue) leave the view alone.
  const [applied, setApplied] = useState({ viewKey, bounds, steps: 0 });
  if (applied.viewKey !== viewKey) setApplied({ viewKey, bounds, steps: 0 });
  const current = applied.viewKey === viewKey ? applied : { viewKey, bounds, steps: 0 };
  const steps = current.steps;
  const view = zoomed(current.bounds, steps);

  return (
    <div
      className="relative size-full overflow-hidden bg-subtle"
      data-testid="fake-map"
      data-zoom-steps={steps}
      data-view-key={viewKey}
    >
      {/* Markers sit in the middle 80% so none straddles the edge at the fitted view. */}
      <div className="absolute inset-[10%]">
        {markers.map((marker) => {
          const state = markerState(marker.id, highlightedId, selectedId);
          const x = fraction(marker.position.lng, view.west, view.east);
          const y = 1 - fraction(marker.position.lat, view.south, view.north);
          return (
            <div
              key={marker.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${String(x * 100)}%`, top: `${String(y * 100)}%`, zIndex: markerZIndex(state) }}
            >
              <button
                type="button"
                aria-label={marker.label}
                aria-haspopup="dialog"
                aria-expanded={state === "selected"}
                data-marker-id={marker.id}
                data-marker-state={state}
                className={markerClassName(state)}
                onClick={() => {
                  onMarkerClick(marker.id);
                }}
              >
                {marker.count}
              </button>
            </div>
          );
        })}
      </div>
      <p aria-hidden="true" className="absolute bottom-1 left-2 text-xs text-muted">
        Test map
      </p>
      <MapControls
        onRecentre={onRecentre}
        onZoomIn={() => {
          setApplied({ ...current, steps: steps + 1 });
        }}
        onZoomOut={() => {
          setApplied({ ...current, steps: steps - 1 });
        }}
      />
    </div>
  );
}
