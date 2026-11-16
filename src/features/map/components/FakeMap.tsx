"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

import { type MapAdapterProps, type MapBounds } from "../types";
import { markerClassName, markerState, markerZIndex } from "../view";

import { MapControls } from "./MapControls";

// A deterministic stand-in for the Mapbox map (D3, PR 3.4), used by component tests, E2E
// (NEXT_PUBLIC_MAP_ADAPTER=fake) and screenshots: no WebGL, no network, no token. It draws the same
// marker buttons and controls as MapboxMap on a flat background, placing each marker by a straight
// projection of the current view. The view is exposed as data attributes for tests.
//
// Like the real map (3.6) it can be dragged to pan, the zoom buttons zoom the current view, and it
// reports its viewport after each move: the person's own moves as byUser, fitting a view as not.
// The reported bounds are the box the markers are laid out in (the middle 80%), so restoring them
// puts every marker back exactly where it was.

const ZOOM_FACTOR = 2;
/** A drag shorter than this (px) is a click, not a pan. */
const PAN_THRESHOLD_PX = 3;

function scaled(view: MapBounds, factor: number): MapBounds {
  const midLat = (view.south + view.north) / 2;
  const midLng = (view.west + view.east) / 2;
  const halfLat = ((view.north - view.south) / 2) * factor;
  const halfLng = ((view.east - view.west) / 2) * factor;
  return { south: midLat - halfLat, west: midLng - halfLng, north: midLat + halfLat, east: midLng + halfLng };
}

function shifted(view: MapBounds, dLat: number, dLng: number): MapBounds {
  return { south: view.south + dLat, west: view.west + dLng, north: view.north + dLat, east: view.east + dLng };
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
  onViewportChange,
}: MapAdapterProps) {
  // The view fitted for `viewKey`, then moved by the person. Only a new viewKey re-fits: new bounds
  // under the same key (e.g. "Show more" adding a far venue) leave the view alone, as on the real map.
  const [applied, setApplied] = useState({ viewKey, view: bounds, steps: 0 });
  if (applied.viewKey !== viewKey) setApplied({ viewKey, view: bounds, steps: 0 });
  const current = applied.viewKey === viewKey ? applied : { viewKey, view: bounds, steps: 0 };

  const layer = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ dLat: number; dLng: number } | null>(null);
  const view = dragOffset === null ? current.view : shifted(current.view, dragOffset.dLat, dragOffset.dLng);

  const latest = useRef({ onViewportChange, fitted: current.view });
  useEffect(() => {
    latest.current = { onViewportChange, fitted: current.view };
  });
  // A fitted view is reported once per new key, as not the person's move.
  useEffect(() => {
    latest.current.onViewportChange(latest.current.fitted, false);
  }, [current.viewKey]);

  function moveTo(next: MapBounds, steps = current.steps) {
    setApplied({ viewKey, view: next, steps });
    onViewportChange(next, true);
  }

  /** Turns a drag into a pan: the content follows the pointer. */
  function offsetFor(event: PointerEvent<HTMLDivElement>, start: { x: number; y: number }) {
    const box = layer.current?.getBoundingClientRect();
    const width = box !== undefined && box.width > 0 ? box.width : 1;
    const height = box !== undefined && box.height > 0 ? box.height : 1;
    return {
      dLat: ((event.clientY - start.y) / height) * (current.view.north - current.view.south),
      dLng: (-(event.clientX - start.x) / width) * (current.view.east - current.view.west),
    };
  }

  return (
    // Test stand-in only: dragging pans like the real map (which also pans by touch and keyboard).
    <div
      className="relative size-full touch-none overflow-hidden bg-subtle select-none"
      data-testid="fake-map"
      data-zoom-steps={current.steps}
      data-view-key={viewKey}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget && event.target !== layer.current) return;
        drag.current = { x: event.clientX, y: event.clientY, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start === null) return;
        if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < PAN_THRESHOLD_PX) return;
        start.moved = true;
        setDragOffset(offsetFor(event, start));
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        drag.current = null;
        setDragOffset(null);
        if (start?.moved !== true) return;
        const { dLat, dLng } = offsetFor(event, start);
        moveTo(shifted(current.view, dLat, dLng));
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragOffset(null);
      }}
    >
      {/* Markers sit in the middle 80% so none straddles the edge at the fitted view. */}
      <div ref={layer} className="absolute inset-[10%]">
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
          moveTo(scaled(current.view, 1 / ZOOM_FACTOR), current.steps + 1);
        }}
        onZoomOut={() => {
          moveTo(scaled(current.view, ZOOM_FACTOR), current.steps - 1);
        }}
      />
    </div>
  );
}
