"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Component, useMemo, useRef, useState, type ReactNode } from "react";

import { saveSearchView, type SavedSearchView } from "@/features/search/history-state";
import { MAX_RADIUS_KM, MIN_RADIUS_KM } from "@/features/search/query";
import { useSearchResults } from "@/features/search/components/SearchResultsContext";
import { MapPlaceholder } from "@/features/search/components/SearchLayout";
import { placeLocation, serializeSearchState } from "@/features/search/state";

import { type MapAdapterProps, type MapBounds } from "../types";
import { areaSearch, DEFAULT_CENTRE, mapAdapterKind, searchBounds, toMapMarker } from "../view";

import { FakeMap } from "./FakeMap";
import { MarkerPreview } from "./MarkerPreview";

// The search page's map (spec §3, PR 3.4): one marker per loaded venue (D7), the list's hover/focus
// highlighting its marker, a chosen marker drawn larger and darker, and Recentre/zoom buttons. It
// shows the searched place and its venues, re-fitting for each new search and on Recentre only.
// Choosing a marker opens its preview (3.5): the first step never navigates, the preview does.
//
// "Search this area" (3.6, T5): once the person moves the map, a button offers to search what's on
// screen: its centre, with the radius covering it (1–50 km), keeping the other filters. Moving the
// map never searches by itself. Coming back to this search via back/forward or reload puts the map
// where the person left it.
//
// If the map can't be shown (no public token configured, no WebGL, the map code or style failed to
// load) it says so in place; the list still works.

const MapboxMap = dynamic(() => import("../mapbox/MapboxMap").then((m) => m.MapboxMap), {
  ssr: false,
  loading: () => <MapPlaceholder />,
});

/** The preview card's footprint at the top of the map (top-4 plus the card), kept clear of its marker. */
const PREVIEW_INSET_PX = 128;

export function SearchMap() {
  const { state, search, saved, results, highlightedId, selectedId, toggleSelected } = useSearchResults();
  const router = useRouter();
  /** How many times Recentre was pressed, and the history entry's saved view it was last pressed on. */
  const [recentred, setRecentred] = useState<{ count: number; on: SavedSearchView | null }>({ count: 0, on: null });
  const [unavailable, setUnavailable] = useState(false);
  /** Where the person moved the map to, for the view it was moved from. */
  const [moved, setMoved] = useState<{ viewKey: string; bounds: MapBounds } | null>(null);
  const region = useRef<HTMLElement>(null);

  const items = results.status === "ready" ? results.items : null;
  const markers = useMemo(() => (items ?? []).map(toMapMarker), [items]);
  const centre = state.location ?? DEFAULT_CENTRE;
  const searched = useMemo(
    () =>
      searchBounds(
        centre,
        state.filters.radiusKm,
        markers.map((m) => m.position),
      ),
    [centre, state.filters.radiusKm, markers],
  );
  // Coming back to this search: the saved viewport, until Recentre (on this history entry: `saved` is
  // read afresh for each entry) asks for the search's own area.
  const restored = saved !== null && recentred.on !== saved ? (saved.bounds ?? null) : null;
  const bounds = restored ?? searched;
  // A new view for each search (first the radius while loading, then its venues) and each Recentre.
  const viewKey = `${search ?? "none"}|${results.status}|${String(recentred.count)}`;

  const chosen = items?.find((item) => item.id === selectedId) ?? null;
  const area = moved?.viewKey === viewKey ? areaSearch(moved.bounds, MIN_RADIUS_KM, MAX_RADIUS_KM) : null;

  /** Close the preview and put focus back on its marker (both adapters mark buttons with data-marker-id). */
  function closePreview(id: string) {
    toggleSelected(id);
    const markerButtons = region.current?.querySelectorAll<HTMLButtonElement>("button[data-marker-id]") ?? [];
    [...markerButtons].find((button) => button.dataset.markerId === id)?.focus();
  }

  function searchArea() {
    if (area?.kind !== "search") return;
    const location = placeLocation(area.centre.lat, area.centre.lng, null);
    if (location === null) return;
    router.push(`/?${serializeSearchState({ location, filters: { ...state.filters, radiusKm: area.radiusKm } })}`);
  }

  const kind = mapAdapterKind(process.env.NEXT_PUBLIC_MAP_ADAPTER, process.env.NEXT_PUBLIC_MAPBOX_TOKEN);
  if (kind === "unavailable" || unavailable) return <MapUnavailable />;

  const props: MapAdapterProps = {
    markers,
    bounds,
    fit: restored === null ? "padded" : "exact",
    viewKey,
    highlightedId,
    selectedId,
    onMarkerClick: toggleSelected,
    onRecentre: () => {
      setRecentred(({ count }) => ({ count: count + 1, on: saved }));
    },
    onUnavailable: () => {
      setUnavailable(true);
    },
    onViewportChange: (next, byUser) => {
      if (search !== null) saveSearchView(search, { bounds: next });
      if (byUser) setMoved({ viewKey, bounds: next });
    },
    chosenTopInset: chosen === null ? 0 : PREVIEW_INSET_PX,
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
      {/* Polite, so a keyboard or screen-reader user who moved the map hears the offer. */}
      <div aria-live="polite" className="absolute bottom-14 left-1/2 z-10 -translate-x-1/2 lg:bottom-10">
        {area?.kind === "search" ? (
          <button
            type="button"
            onClick={searchArea}
            className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-ink px-5 text-sm font-semibold whitespace-nowrap text-surface shadow-lg hover:bg-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Search this area
          </button>
        ) : area?.kind === "too-wide" ? (
          <p className="rounded-pill bg-surface px-4 py-2.5 text-sm font-medium whitespace-nowrap text-ink shadow-lg">
            Zoom in to search this area
          </p>
        ) : null}
      </div>
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
