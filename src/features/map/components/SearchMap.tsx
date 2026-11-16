"use client";

import dynamic from "next/dynamic";
import { Component, useMemo, useRef, useState, type ReactNode } from "react";

import { useSearchResults } from "@/features/search/components/SearchResultsContext";
import { MapPlaceholder } from "@/features/search/components/SearchLayout";
import { apiQueryString } from "@/features/search/state";

import { type MapAdapterProps } from "../types";
import { DEFAULT_CENTRE, mapAdapterKind, searchBounds, toMapMarker } from "../view";

import { FakeMap } from "./FakeMap";
import { MarkerPreview } from "./MarkerPreview";

// The search page's map (spec §3, PR 3.4): one marker per loaded venue (D7), the list's hover/focus
// highlighting its marker, a chosen marker drawn larger and darker, and Recentre/zoom buttons. It
// shows the searched place and its venues, re-fitting for each new search and on Recentre only.
// Choosing a marker opens its preview (3.5): the first step never navigates, the preview does.
//
// If the map can't be shown (no public token configured, no WebGL, the map code or style failed to
// load) it says so in place; the list still works.

const MapboxMap = dynamic(() => import("../mapbox/MapboxMap").then((m) => m.MapboxMap), {
  ssr: false,
  loading: () => <MapPlaceholder />,
});

export function SearchMap() {
  const { state, results, highlightedId, selectedId, toggleSelected } = useSearchResults();
  const [recentred, setRecentred] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const region = useRef<HTMLElement>(null);

  const items = results.status === "ready" ? results.items : null;
  const markers = useMemo(() => (items ?? []).map(toMapMarker), [items]);
  const centre = state.location ?? DEFAULT_CENTRE;
  const bounds = useMemo(
    () =>
      searchBounds(
        centre,
        state.filters.radiusKm,
        markers.map((m) => m.position),
      ),
    [centre, state.filters.radiusKm, markers],
  );
  // A new view for each search (first the radius while loading, then its venues) and each Recentre.
  const viewKey = `${apiQueryString(state) ?? "none"}|${results.status}|${String(recentred)}`;

  const chosen = items?.find((item) => item.id === selectedId) ?? null;

  /** Close the preview and put focus back on its marker (both adapters mark buttons with data-marker-id). */
  function closePreview(id: string) {
    toggleSelected(id);
    const markerButtons = region.current?.querySelectorAll<HTMLButtonElement>("button[data-marker-id]") ?? [];
    [...markerButtons].find((button) => button.dataset.markerId === id)?.focus();
  }

  const kind = mapAdapterKind(process.env.NEXT_PUBLIC_MAP_ADAPTER, process.env.NEXT_PUBLIC_MAPBOX_TOKEN);
  if (kind === "unavailable" || unavailable) return <MapUnavailable />;

  const props: MapAdapterProps = {
    markers,
    bounds,
    viewKey,
    highlightedId,
    selectedId,
    onMarkerClick: toggleSelected,
    onRecentre: () => {
      setRecentred((n) => n + 1);
    },
    onUnavailable: () => {
      setUnavailable(true);
    },
  };

  return (
    <section ref={region} aria-label="Map of venues" className="relative size-full">
      <MapErrorBoundary fallback={<MapUnavailable />}>
        {kind === "fake" ? (
          <FakeMap {...props} />
        ) : (
          <MapboxMap {...props} token={(process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "").trim()} />
        )}
      </MapErrorBoundary>
      {chosen !== null ? (
        <MarkerPreview
          key={chosen.id}
          venue={chosen}
          onClose={() => {
            closePreview(chosen.id);
          }}
        />
      ) : null}
    </section>
  );
}

function MapUnavailable() {
  return (
    <div className="flex size-full items-center justify-center bg-subtle p-6 text-center">
      <p className="max-w-xs text-sm text-muted">
        The map isn&apos;t available right now. You can still browse the venue list.
      </p>
    </div>
  );
}

/** The map's code failing to load or throwing shouldn't take the list down with it. */
class MapErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
